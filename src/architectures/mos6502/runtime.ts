/**
 * A Mos6502Machine behind the neutral machine contract: the run loop,
 * breakpoints, pacing, observers and user edits the debugger drives.
 */

import type { ExecutionObserver, MachineConfig } from '../../core/observer'
import { yieldToHost } from '../../core/yieldToHost'
import type { CallFrame, HistoryFormatter, KeyboardDisplayDevice, Machine, MemoryInspector, PendingInput, Registers } from '../contracts'
import { faultMessage, FLAG_B, STEP_FAULT, STEP_OK, STEP_WAIT } from './cpu'
import { ENABLE_KEYBOARD } from './device'
import { mos6502HistoryFormatter, Mos6502HistoryView } from './historyView'
import { ACCESS_BRANCH, ACCESS_CALL, ACCESS_READ, ACCESS_TAKEN, ACCESS_WRITE, classifyAt, Mos6502Access, mos6502InstructionSet } from './instructions'
import { Mos6502Machine } from './machine'
import type { Mos6502Assembly } from './program'
import { FLAGS } from './registers'
import type { CpuModel } from './isa'
import { instructionSetFor } from './instructions'

/** Instructions run between yields to the browser. */
const DEFAULT_BATCH_SIZE = 20_000
/** Redraws per second when execution is paced, which sets the batch size. */
const ANIMATION_FRAMES_PER_SECOND = 30
/** Longest a paced run sleeps without looking at the speed control again. */
const FRAME_SLICE_MS = 50
/** How much of a stalled run a paced run will make up once it resumes. */
const MAX_CATCH_UP_SECONDS = 0.25

/** A read of $F001 takes a character at a time; a submitted line arrives with its newline. */
const READ_INPUT: PendingInput = Object.freeze({ type: 'string', prompt: 'The program is waiting to read $F001' })
/** A program polling the keyboard, or taking its interrupts, can be typed to while it runs. */
const KEYBOARD_INPUT: PendingInput = Object.freeze({ type: 'string', prompt: 'Type to queue keyboard input' })

const FLAG_BITS: ReadonlyMap<string, number> = new Map(FLAGS.map(({ id, bit }) => [id, bit]))

/** Debugger reads of the 64 KiB; never reaches the I/O page's device. */
class Mos6502Memory implements MemoryInspector {
	readonly wordBytes = 1
	readonly littleEndian = true

	constructor(private readonly bytes: Uint8Array) {}

	byte(address: number): number | undefined {
		return address >= 0 && address <= 0xFFFF ? this.bytes[address] : undefined
	}

	word(address: number): number | undefined {
		return this.byte(address)
	}
}

export interface Mos6502RuntimeOptions {
	model?: CpuModel
	decimal: boolean
	historyLimit: number
	speed: number | null
}

export class Mos6502Runtime implements Machine {
	readonly machine: Mos6502Machine
	readonly history: Mos6502HistoryView
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
	private readonly access = new Mos6502Access()

	constructor(readonly program: Mos6502Assembly, options: Mos6502RuntimeOptions) {
		this.machine = new Mos6502Machine({ model: options.model ?? program.model, decimal: options.decimal, historyLimit: options.historyLimit })
		this.machine.load(program.image())
		this.speed = options.speed
		this.history = new Mos6502HistoryView(this.machine.history)
		const { device } = this.machine
		this.historyFormat = mos6502HistoryFormatter(this.machine.history, this.machine.cpu, device)
		this.keyboardDisplay = {
			state: () => ({ queuedInput: device.input.slice(device.inputIndex), displayOutput: device.output }),
			queue: (input) => device.feed(input),
		}
	}

	get pc() { return this.machine.cpu.pc }
	get halted() { return this.machine.halted || this.stopped || this.fault !== null }

	/** A read of $F001 waiting, or a program that looks for keys, with none queued. */
	get pendingInput() {
		const { device } = this.machine
		if (this.halted) return null
		if (device.waiting) return READ_INPUT
		return !device.keyReady && (this.machine.cpu.sleeping || device.polled || (device.control & ENABLE_KEYBOARD) !== 0) ? KEYBOARD_INPUT : null
	}
	get instructionCount() { return this.machine.instructionCount }
	get historyCursor() { return this.history.length }

	get console() {
		const output = this.machine.device.output
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

	/** One instruction, told to the observers when they are listening; returns the STEP_* code. */
	private advance(): number {
		const machine = this.machine
		const cpu = machine.cpu
		const observers = this.observers
		const address = cpu.pc
		if (observers.length > 0) classifyAt(cpu, this.access)
		const count = machine.instructionCount
		const status = machine.step()
		if (status === STEP_FAULT) {
			this.fault = faultMessage(cpu.fault, cpu.faultAddress, cpu.opcode)
			return status
		}
		// Only an instruction that ran is news: an interrupt, a wait or a halting BRK is not.
		if (observers.length > 0 && status === STEP_OK) this.notify(address, count)
		return status
	}

	private notify(address: number, count: number) {
		const observers = this.observers
		const { opcode, flags, address: data, target } = this.access
		for (const observer of observers) observer.onInstruction?.(address, opcode, count)
		if (flags & ACCESS_READ) for (const observer of observers) observer.onMemoryRead?.(data, 1)
		if (flags & ACCESS_WRITE) {
			const value = this.machine.cpu.memory[data]
			for (const observer of observers) observer.onMemoryWrite?.(data, 1, value)
		}
		if (flags & ACCESS_BRANCH) {
			const taken = (flags & ACCESS_TAKEN) !== 0
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

	/** A JSR runs to completion: back at the instruction after it. */
	async stepOver() {
		if (!this.halted && classifyAt(this.machine.cpu, this.access).flags & ACCESS_CALL) {
			await this.runToTemporaryBreakpoint((this.pc + 3) & 0xFFFF, true)
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

	addBreakpoint(address: number) { this.breakpoints.add(address & 0xFFFF) }
	removeBreakpoint(address: number) { this.breakpoints.delete(address & 0xFFFF) }
	getBreakpoints() { return Array.from(this.breakpoints) }

	/** A submitted line is read a character at a time, newline included. */
	provideInput(input: string, cancelled = false): boolean {
		if (cancelled || !this.pendingInput) return false
		this.machine.device.feed(`${input}\n`)
		return true
	}

	registerValues(): Registers {
		const { a, x, y, sp, pc, p, cycles } = this.machine.cpu
		const values: Registers = { A: a, X: x, Y: y, SP: sp, PC: pc, P: p, CYC: cycles }
		for (const [id, bit] of FLAG_BITS) values[id] = p & bit ? 1 : 0
		return values
	}

	writeRegister(id: string, value: number): boolean {
		if (id === 'PC') {
			this.setProgramCounter(value)
			return true
		}
		const byte = value & 0xFF
		const bit = FLAG_BITS.get(id)
		if (bit !== undefined) {
			if (bit === FLAG_B) return false
			return this.machine.editRegister((cpu) => { cpu.p = value ? cpu.p | bit : cpu.p & ~bit })
		}
		switch (id) {
			case 'A': return this.machine.editRegister((cpu) => { cpu.a = byte })
			case 'X': return this.machine.editRegister((cpu) => { cpu.x = byte })
			case 'Y': return this.machine.editRegister((cpu) => { cpu.y = byte })
			case 'SP': return this.machine.editRegister((cpu) => { cpu.sp = byte })
			// B and bit 5 are not stored bits of P.
			case 'P': return this.machine.editRegister((cpu) => { cpu.p = (byte & ~FLAG_B) | 0x20 })
			default: return false
		}
	}

	inspectMemory(): MemoryInspector {
		return new Mos6502Memory(this.machine.cpu.memory)
	}

	writeByte(address: number, value: number) {
		return this.machine.editBytes(address, [value])
	}

	/** Shifts `[address, limit]` up a byte; what is past the last non-zero byte stays. */
	insertByte(address: number, limit: number, value: number): boolean {
		const memory = this.machine.cpu.memory
		const end = Math.min(limit, memory.length - 1)
		if (address < 0 || end < address) return false
		const top = Math.min(end, this.lastNonZero(address, end) + 1)
		const bytes = new Uint8Array(top - address + 1)
		bytes[0] = value
		bytes.set(memory.subarray(address, top), 1)
		return this.machine.editBytes(address, bytes)
	}

	deleteByte(address: number, limit: number): boolean {
		const memory = this.machine.cpu.memory
		const end = Math.min(limit, memory.length - 1)
		if (address < 0 || end < address) return false
		const top = Math.max(address, this.lastNonZero(address, end))
		const bytes = new Uint8Array(top - address + 1)
		bytes.set(memory.subarray(address + 1, top + 1))
		return this.machine.editBytes(address, bytes)
	}

	private lastNonZero(from: number, to: number): number {
		const memory = this.machine.cpu.memory
		for (let at = to; at >= from; at--) if (memory[at] !== 0) return at
		return from - 1
	}

	toolConfig(): MachineConfig {
		return { delayedBranching: false, instructions: instructionSetFor(this.machine.cpu.model), history: this.history }
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
				// Instructions the editor cannot point at get no frame of their own.
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
