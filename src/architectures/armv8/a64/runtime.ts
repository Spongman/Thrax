/**
 * An A64Machine behind the neutral machine contract: the run loop,
 * breakpoints, pacing, observers and user edits the debugger drives.
 */

import type { ExecutionObserver, MachineConfig } from '../../../core/observer'
import { yieldToHost } from '../../../core/yieldToHost'
import type { CallFrame, HistoryFormatter, KeyboardDisplayDevice, Machine, MemoryInspector, PendingInput, Registers, RegisterValue } from '../../contracts'
import { A64InstructionInfo, classifyA64, INSN_BRANCH, INSN_LOAD, INSN_STORE, INSN_TAKEN } from './classify'
import { faultMessage, STEP_FAULT, STEP_OK, STEP_WAIT } from './cpu'
import { decode, Op } from './decode'
import { a64HistoryFormatter, A64HistoryView } from './historyView'
import { a64InstructionSet } from './instructions'
import { MASK32 } from './isa'
import { A64Machine } from './machine'
import type { A64Assembly } from './program'
import { a64RegisterValues, editTarget } from './registers'

/** Instructions run between yields to the browser. */
const DEFAULT_BATCH_SIZE = 20_000
/** Redraws per second when execution is paced, which sets the batch size. */
const ANIMATION_FRAMES_PER_SECOND = 30
/** Longest a paced run sleeps without looking at the speed control again. */
const FRAME_SLICE_MS = 50
/** How much of a stalled run a paced run will make up once it resumes. */
const MAX_CATCH_UP_SECONDS = 0.25

const READ_INPUT: PendingInput = Object.freeze({ type: 'string', prompt: 'read() is waiting for input' })

/** Debugger reads of memory; nothing here can fault, record or reach a device. */
class A64Memory implements MemoryInspector {
	readonly wordBytes = 4
	readonly littleEndian = true

	constructor(private readonly bytes: Uint8Array, private readonly base: number) {}

	byte(address: number): number | undefined {
		const offset = address - this.base
		return offset >= 0 && offset < this.bytes.length ? this.bytes[offset] : undefined
	}

	word(address: number): number | undefined {
		const at = (address - this.base) & ~3
		const bytes = this.bytes
		if (address < this.base || at > bytes.length - 4) return undefined
		return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0
	}
}

export interface A64RuntimeOptions {
	memoryBytes: number
	historyLimit: number
	speed: number | null
}

export class A64Runtime implements Machine {
	readonly machine: A64Machine
	readonly history: A64HistoryView
	readonly historyFormat: HistoryFormatter
	readonly observers: ExecutionObserver[] = []
	readonly breakpoints = new Set<number>()
	readonly keyboardDisplay: KeyboardDisplayDevice
	onProgress: (() => void) | null = null
	paused = false
	private running = false
	/** Ended by the user; only a fresh run carries on. */
	private stopped = false
	/** Why the CPU refused the last instruction, which ends the run. */
	private fault: string | null = null
	private speed: number | null
	private pacedAddresses: ReadonlySet<number> | null = null
	/** The instruction about to run, classified for the observers. */
	private readonly info = new A64InstructionInfo()

	constructor(readonly program: A64Assembly, options: A64RuntimeOptions) {
		this.machine = new A64Machine({ memoryBytes: options.memoryBytes, historyLimit: options.historyLimit })
		this.machine.load(program.image())
		this.speed = options.speed
		this.history = new A64HistoryView(this.machine.history)
		this.historyFormat = a64HistoryFormatter(this.machine.history, this.machine.linux, this.machine.keyboard)
		this.keyboardDisplay = this.machine.keyboard.device()
	}

	get pc() { return this.machine.cpu.pc }
	get halted() { return this.machine.halted || this.stopped || this.fault !== null }
	get pendingInput() { return !this.halted && this.machine.linux.waiting ? READ_INPUT : null }
	get instructionCount() { return this.machine.instructionCount }
	get historyCursor() { return this.history.length }

	get console() {
		const output = this.machine.linux.output
		return this.fault === null ? output : `${output}\nError: ${this.fault}\n`
	}

	get callStack(): CallFrame[] {
		return this.machine.callStack.frames().map((frame) => ({
			callAddress: frame.callSite,
			returnAddress: frame.returnAddress,
			targetAddress: frame.callee,
		}))
	}

	step() {
		if (this.halted) return
		if (this.advance() === STEP_FAULT) throw new Error(this.fault!)
	}

	/** The word at the PC, or -1 where it cannot be fetched. */
	private fetch(): number {
		const cpu = this.machine.cpu
		const offset = cpu.offsetOf(cpu.pc, 4)
		return offset < 0 || cpu.pc % 4 ? -1 : new DataView(cpu.memory.buffer).getUint32(offset, true)
	}

	/** One instruction, told to the observers when they are listening; returns the STEP_* code. */
	private advance(): number {
		const machine = this.machine
		const cpu = machine.cpu
		const observers = this.observers
		let address = -1
		let word = 0
		if (observers.length > 0) {
			word = this.fetch()
			if (word >= 0) {
				address = cpu.pc
				classifyA64(decode(word), cpu, this.info)
			}
		}
		const count = machine.instructionCount
		const status = machine.step()
		if (status === STEP_FAULT) {
			this.fault = faultMessage(cpu.fault, cpu.faultAddress, cpu.faultDetail)
			return status
		}
		if (address >= 0 && status !== STEP_WAIT) this.notify(address, word, count, status)
		return status
	}

	private notify(address: number, word: number, count: number, status: number) {
		const observers = this.observers
		for (const observer of observers) observer.onInstruction?.(address, word, count)
		if (status !== STEP_OK) return
		const { flags, memoryAddress, memorySize, target } = this.info
		if (flags & INSN_LOAD) for (const observer of observers) observer.onMemoryRead?.(memoryAddress, memorySize)
		if (flags & INSN_STORE) {
			// The stored register, which the store itself leaves as it was.
			const value = Number(this.machine.cpu.read(word & 31) & MASK32)
			for (const observer of observers) observer.onMemoryWrite?.(memoryAddress, memorySize, value)
		}
		if (flags & INSN_BRANCH) {
			const taken = (flags & INSN_TAKEN) !== 0
			for (const observer of observers) observer.onBranch?.(address, taken, target)
		}
	}

	private seekObservers() {
		for (const observer of this.observers) observer.onSeek?.(this.machine.instructionCount)
	}

	run() {
		return this.runUntil(() => false)
	}

	/** Input typed while running continues too; the run already going carries on. */
	async continue() {
		if (this.running) return
		this.paused = false
		await this.run()
	}

	async runTo(address: number) {
		this.paused = false
		await this.runToTemporaryBreakpoint(address, false)
	}

	async stepOver() {
		const word = this.halted ? -1 : this.fetch()
		if (word >= 0) {
			const d = decode(word)
			// A call runs to completion: back at the word after it.
			if (d.op === Op.BL || d.op === Op.BLR) {
				await this.runToTemporaryBreakpoint(this.pc + 4, true)
				return
			}
		}
		this.step()
	}

	/** Runs until the frame the PC is in returns. */
	async stepToReturn() {
		const stack = this.machine.callStack
		const depth = stack.depth
		if (depth === 0) {
			await this.run()
			return
		}
		await this.runUntil(() => stack.depth < depth)
	}

	pause() {
		this.paused = true
		this.running = false
	}

	stop() {
		this.running = false
		this.paused = false
		this.stopped = true
	}

	stepBack(): boolean {
		const log = this.machine.history
		if (!log || !log.stepBack()) return false
		this.resumed()
		return true
	}

	rewindTo(id: number): boolean {
		const log = this.machine.history
		const index = this.history.indexOfId(id)
		if (!log || index < 0) return false
		log.rewindTo(index)
		this.resumed()
		return true
	}

	/** Back from a rewind: whatever ended the run is undone with it. */
	private resumed() {
		this.fault = null
		this.stopped = false
		this.paused = true
		this.running = false
		this.seekObservers()
	}

	setProgramCounter(address: number) {
		this.machine.editPc(address)
		this.fault = null
		this.stopped = false
	}

	configure(options: { speed?: number | null, pacedAddresses?: ReadonlySet<number> | null }) {
		if (options.speed !== undefined) this.speed = options.speed
		if (options.pacedAddresses !== undefined) this.pacedAddresses = options.pacedAddresses
	}

	addBreakpoint(address: number) { this.breakpoints.add(address) }
	removeBreakpoint(address: number) { this.breakpoints.delete(address) }
	getBreakpoints() { return Array.from(this.breakpoints) }

	/** A submitted line goes to read() with its newline. */
	provideInput(input: string, cancelled = false): boolean {
		if (cancelled || !this.pendingInput) return false
		this.machine.linux.feed(`${input}\n`)
		return true
	}

	registerValues(): Registers {
		return a64RegisterValues(this.machine.cpu)
	}

	writeRegister(id: string, value: RegisterValue): boolean {
		const target = editTarget(id)
		if (!target) return false
		const machine = this.machine
		switch (target.kind) {
			case 'x': return machine.editRegister(target.index, BigInt(value))
			case 'w': return machine.editW(target.index, Number(value))
			case 'nzcv': return machine.editFlags(Number(BigInt(value) >> 28n) & 15)
		}
		const changed = machine.editPc(Number(BigInt.asUintN(64, BigInt(value))))
		this.fault = null
		this.stopped = false
		return changed
	}

	inspectMemory(): MemoryInspector {
		const cpu = this.machine.cpu
		return new A64Memory(cpu.memory, cpu.base)
	}

	writeByte(address: number, value: number) {
		return this.machine.editBytes(address, [value])
	}

	/** Shifts `[address, limit]` up a byte; what is past the last non-zero byte stays. */
	insertByte(address: number, limit: number, value: number): boolean {
		const { memory, base } = this.machine.cpu
		const end = Math.min(limit, base + memory.length - 1)
		if (address < base || end < address) return false
		const top = Math.min(end, this.lastNonZero(address, end) + 1)
		const bytes = new Uint8Array(top - address + 1)
		bytes[0] = value
		bytes.set(memory.subarray(address - base, top - base), 1)
		return this.machine.editBytes(address, bytes)
	}

	deleteByte(address: number, limit: number): boolean {
		const { memory, base } = this.machine.cpu
		const end = Math.min(limit, base + memory.length - 1)
		if (address < base || end < address) return false
		const top = Math.max(address, this.lastNonZero(address, end))
		const bytes = new Uint8Array(top - address + 1)
		bytes.set(memory.subarray(address + 1 - base, top + 1 - base))
		return this.machine.editBytes(address, bytes)
	}

	private lastNonZero(from: number, to: number): number {
		const { memory, base } = this.machine.cpu
		for (let at = to; at >= from; at--) if (memory[at - base] !== 0) return at
		return from - 1
	}

	toolConfig(): MachineConfig {
		return { delayedBranching: false, instructions: a64InstructionSet, history: this.history }
	}

	dispose() {
		this.onProgress = null
		this.stop()
	}

	/** Runs to `address`; a step over lifts the breakpoint it stands on. */
	private async runToTemporaryBreakpoint(address: number, liftCurrent: boolean) {
		const current = this.pc
		const restore = liftCurrent && this.breakpoints.delete(current)
		const wanted = this.breakpoints.has(address)
		this.breakpoints.add(address)
		try {
			await this.run()
		} finally {
			if (restore) this.breakpoints.add(current)
			if (!wanted) this.breakpoints.delete(address)
		}
	}

	private batchSize(): number {
		if (this.speed === null) return DEFAULT_BATCH_SIZE
		return Math.max(1, Math.round(this.speed / ANIMATION_FRAMES_PER_SECOND))
	}

	/** Waits out a frame in slices, so the speed control and Pause are felt promptly. */
	private async waitFrame(ms: number) {
		if (ms <= 0) return yieldToHost()
		const deadline = performance.now() + ms
		const speed = this.speed
		while (this.running && !this.halted && this.speed === speed) {
			const remaining = deadline - performance.now()
			if (remaining <= 0) return
			await new Promise((resolve) => setTimeout(resolve, Math.min(remaining, FRAME_SLICE_MS)))
		}
	}

	/** Runs until `shouldStop()` holds after an instruction, a breakpoint, input, or the end. */
	private async runUntil(shouldStop: () => boolean) {
		this.running = true
		this.paused = false
		// Continuing from a breakpoint has to make progress.
		let first = true
		let lastTick = performance.now()
		let owed = 0
		while (this.running && !this.halted) {
			const started = performance.now()
			const batch = this.batchSize()
			const frameMs = this.speed === null ? 0 : (batch / this.speed) * 1000
			let allowance = batch
			if (this.speed === null) {
				owed = 0
				lastTick = started
			} else {
				owed = Math.min(owed + ((started - lastTick) * this.speed) / 1000, this.speed * MAX_CATCH_UP_SECONDS)
				lastTick = started
				allowance = Math.max(1, Math.floor(owed))
			}
			let executed = 0
			while (this.running && !this.halted && executed < allowance) {
				if (!first && this.breakpoints.has(this.pc)) {
					this.pause()
					break
				}
				first = false
				// A fault ends the run through `halted`; the console says why.
				if (this.advance() === STEP_WAIT || shouldStop()) {
					this.pause()
					break
				}
				// Words the editor cannot point at get no frame of their own.
				if (this.speed !== null && this.pacedAddresses && !this.halted && !this.pacedAddresses.has(this.pc)) continue
				executed++
			}
			owed -= executed
			this.onProgress?.()
			if (this.running && !this.halted) await this.waitFrame(Math.max(0, frameMs - (performance.now() - started)))
		}
		this.running = false
	}
}

