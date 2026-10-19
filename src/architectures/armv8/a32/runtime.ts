/**
 * An A32Machine behind the neutral machine contract: the run loop,
 * breakpoints, pacing, observers and user edits the debugger drives.
 */

import type { ExecutionObserver, MachineConfig } from '../../../core/observer'
import { yieldToHost } from '../../../core/yieldToHost'
import { conditionPassed, shiftByImmediate } from '../../arm/a32/alu'
import {
	ARCH_V8, FLAG_C, FORMAT_BLOCK, FORMAT_BRANCH, FORMAT_EXCHANGE, FORMAT_EXCLUSIVE, FORMAT_EXTRA_TRANSFER, FORMAT_TRANSFER, branchOffset, formatOf, popCount,
} from '../../arm/a32/isa'
import type { ArmAssembly } from '../../arm/program'
import type { CallFrame, HistoryFormatter, KeyboardDisplayDevice, Machine, MemoryInspector, PendingInput, Registers, RegisterValue } from '../../contracts'
import { faultMessage, STEP_FAULT, STEP_OK, STEP_WAIT } from './cpu'
import { a32HistoryFormatter, A32HistoryView } from './historyView'
import { a32InstructionSet } from './instructions'
import { A32Machine } from './machine'
import { a32RegisterValues, FLAG_BITS } from './registers'

const REGISTER_ID = /^R(\d+)$/

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
class A32Memory implements MemoryInspector {
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

/** What an instruction about to run will touch, worked out before it runs. */
class Access {
	passes = false
	/** First address of a load or store, or -1. */
	address = -1
	/** Words for a block transfer, else 1. */
	words = 1
	bytes = 4
	load = false
	store = false
	branch = false
	target = 0
}

export interface A32RuntimeOptions {
	memoryBytes: number
	historyLimit: number
	speed: number | null
}

export class A32Runtime implements Machine {
	readonly machine: A32Machine
	readonly history: A32HistoryView
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
	private readonly access = new Access()

	constructor(readonly program: ArmAssembly, options: A32RuntimeOptions) {
		this.machine = new A32Machine({ memoryBytes: options.memoryBytes, historyLimit: options.historyLimit })
		this.machine.load(program.image())
		this.speed = options.speed
		this.history = new A32HistoryView(this.machine.history)
		this.historyFormat = a32HistoryFormatter(this.machine.history, this.machine.linux, this.machine.keyboard)
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

	/** The word at the PC, or null where it cannot be fetched. */
	private fetch(): number | null {
		const cpu = this.machine.cpu
		const offset = cpu.offsetOf(cpu.pc, 4)
		return offset < 0 || cpu.pc & 3 ? null : new DataView(cpu.memory.buffer).getInt32(offset, true)
	}

	/** One instruction, told to the observers when they are listening; returns the STEP_* code. */
	private advance(): number {
		const { machine, observers } = this
		const cpu = machine.cpu
		const address = cpu.pc
		const word = observers.length > 0 ? this.fetch() : null
		if (word !== null) this.inspect(word)
		const count = machine.instructionCount
		const status = machine.step()
		if (status === STEP_FAULT) {
			this.fault = faultMessage(cpu.fault, cpu.faultAddress, cpu.faultDetail)
			return status
		}
		if (word !== null && status !== STEP_WAIT) this.notify(address, word, count, status)
		return status
	}

	/** Fills `access` for `word` about to run, from the registers as they stand. */
	private inspect(word: number) {
		const cpu = this.machine.cpu
		const access = this.access
		const read = (index: number) => cpu.read(index)
		access.passes = word >>> 28 === 15 || conditionPassed(word >>> 28, cpu.cpsr)
		access.address = -1
		access.words = 1
		access.bytes = 4
		access.load = access.store = access.branch = false
		const indexed = (base: number, offset: number) => {
			const moved = word & 0x00800000 ? base + offset : base - offset
			return (word & 0x01000000 ? moved : base) >>> 0
		}
		switch (formatOf(word, ARCH_V8)) {
			case FORMAT_TRANSFER: {
				let offset = word & 0xFFF
				if (word & 0x02000000) offset = shiftByImmediate(read(word & 15), (word >>> 5) & 3, (word >>> 7) & 31, cpu.cpsr & FLAG_C ? 1 : 0)
				access.address = indexed(read((word >>> 16) & 15), offset)
				access.bytes = word & 0x00400000 ? 1 : 4
				access.load = (word & 0x00100000) !== 0
				access.store = !access.load
				break
			}
			case FORMAT_EXTRA_TRANSFER: {
				const offset = word & 0x00400000 ? ((word >>> 4) & 0xF0) | (word & 15) : read(word & 15)
				const kind = (word >>> 5) & 3
				const load = (word & 0x00100000) !== 0
				const double = !load && kind >= 2
				access.address = indexed(read((word >>> 16) & 15), offset)
				access.bytes = double ? 4 : kind === 2 ? 1 : 2
				access.words = double ? 2 : 1
				access.load = load || kind === 2
				access.store = !access.load
				break
			}
			case FORMAT_EXCLUSIVE:
				access.address = read((word >>> 16) & 15) >>> 0
				access.load = (word & 0x00100000) !== 0
				access.store = !access.load
				break
			case FORMAT_BLOCK: {
				const base = read((word >>> 16) & 15)
				const count = popCount(word)
				const up = (word & 0x00800000) !== 0
				const before = (word & 0x01000000) !== 0
				access.address = (up ? base + (before ? 4 : 0) : base - 4 * count + (before ? 0 : 4)) >>> 0
				access.words = count
				access.load = (word & 0x00100000) !== 0
				access.store = !access.load
				break
			}
			case FORMAT_BRANCH:
				access.branch = word >>> 28 !== 14
				access.target = (cpu.pc + 8 + branchOffset(word)) >>> 0
				break
			case FORMAT_EXCHANGE:
				access.branch = word >>> 28 !== 14
				access.target = read(word & 15) >>> 0
				break
		}
	}

	private notify(address: number, word: number, count: number, status: number) {
		const { observers, access } = this
		for (const observer of observers) observer.onInstruction?.(address, word >>> 0, count)
		if (access.branch) for (const observer of observers) observer.onBranch?.(address, access.passes, access.target)
		if (status !== STEP_OK || !access.passes || access.address < 0) return
		const memory = this.inspectMemory()
		for (let index = 0; index < access.words; index++) {
			const at = access.address + 4 * index
			if (access.load) for (const observer of observers) observer.onMemoryRead?.(at, access.bytes)
			if (access.store) {
				// What the store left there; a device's words read as 0.
				const value = (access.bytes === 1 ? memory.byte(at) : memory.word(at)) ?? 0
				for (const observer of observers) observer.onMemoryWrite?.(at, access.bytes, value)
			}
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
		const word = this.halted ? null : this.fetch()
		const cpu = this.machine.cpu
		// A BL or BLX that will run is a call: run back to the word after it.
		const call = word !== null && word >>> 28 !== 15 && ((word & 0x0F000000) === 0x0B000000 || (word & 0x0FFFFFF0) === 0x012FFF30)
		if (call && conditionPassed(word >>> 28, cpu.cpsr)) {
			await this.runToTemporaryBreakpoint(cpu.pc + 4, true)
			return
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

	addBreakpoint(address: number) { this.breakpoints.add(address >>> 0) }
	removeBreakpoint(address: number) { this.breakpoints.delete(address >>> 0) }
	getBreakpoints() { return Array.from(this.breakpoints) }

	/** A submitted line goes to read() with its newline. */
	provideInput(input: string, cancelled = false): boolean {
		if (cancelled || !this.pendingInput) return false
		this.machine.linux.feed(`${input}\n`)
		return true
	}

	registerValues(): Registers {
		return a32RegisterValues(this.machine.cpu)
	}

	writeRegister(id: string, value: RegisterValue): boolean {
		const machine = this.machine
		const number = Number(value)
		if (id === 'PC') {
			this.setProgramCounter(number)
			return true
		}
		if (id === 'CPSR') return machine.editCpsr(number)
		if (FLAG_BITS[id] !== undefined) return false
		const match = REGISTER_ID.exec(id)
		return match !== null && machine.editRegister(Number(match[1]), number)
	}

	inspectMemory(): MemoryInspector {
		const cpu = this.machine.cpu
		return new A32Memory(cpu.memory, cpu.base)
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
		return { delayedBranching: false, instructions: a32InstructionSet, history: this.history }
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
