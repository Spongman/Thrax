/**
 * A BetaMachine behind the neutral machine contract: the run loop, breakpoints,
 * pacing, observers and user edits the debugger drives.
 *
 * The contract's addresses carry no supervisor bit, so the editor, breakpoints
 * and history name the same address in either mode; the PC register shows the
 * bit. With segmentation they are physical: a user-mode PC is shown through
 * the MMU, as BSim's breakpoints and disassembly do.
 */

import type { ExecutionObserver, MachineConfig } from '../../core/observer'
import type { CallFrame, HistoryFormatter, Machine, MemoryInspector, PendingInput, Registers } from '../contracts'
import { BetaInstructionInfo, classifyBeta, INSN_BRANCH, INSN_CALL, INSN_LOAD, INSN_STORE, INSN_TAKEN } from './classify'
import { faultMessage, STEP_FAULT, STEP_INTERRUPT, STEP_OK, STEP_WAIT, SUPERVISOR } from './cpu'
import { betaHistoryFormatter, BetaHistoryView } from './historyView'
import { betaInstructionSet } from './instructions'
import { BetaMachine } from './machine'
import type { BetaAssembly } from './program'
import { yieldToHost } from '../../core/yieldToHost'

const ADDRESS_MASK = 0x7FFFFFFF
const REGISTER_ID = /^R(\d+)$/

/** Instructions run between yields to the browser. */
const DEFAULT_BATCH_SIZE = 20_000
/** Redraws per second when execution is paced, which sets the batch size. */
const ANIMATION_FRAMES_PER_SECOND = 30
/** Longest a paced run sleeps without looking at the speed control again. */
const FRAME_SLICE_MS = 50
/** How much of a stalled run a paced run will make up once it resumes. */
const MAX_CATCH_UP_SECONDS = 0.25

/** RDCHAR reads a character at a time; a submitted line arrives with its newline. */
const RDCHAR_INPUT: PendingInput = Object.freeze({ type: 'string', prompt: 'RDCHAR is waiting for input' })
/** A program taking keyboard interrupts can be typed to while it runs. */
const KEYBOARD_INPUT: PendingInput = Object.freeze({ type: 'string', prompt: 'Type to raise keyboard interrupts' })

/** Debugger reads of the flat memory; nothing here can fault or record. */
class BetaMemory implements MemoryInspector {
	readonly wordBytes = 4
	readonly littleEndian = true

	constructor(private readonly bytes: Uint8Array) {}

	byte(address: number): number | undefined {
		return address >= 0 && address < this.bytes.length ? this.bytes[address] : undefined
	}

	word(address: number): number | undefined {
		const at = address & ~3
		const bytes = this.bytes
		if (at < 0 || at > bytes.length - 4) return undefined
		return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0
	}
}

export interface BetaRuntimeOptions {
	memoryBytes?: number
	tty: boolean
	clock?: boolean
	segmentation?: boolean
	historyLimit: number
	speed: number | null
}

export class BetaRuntime implements Machine {
	readonly machine: BetaMachine
	readonly history: BetaHistoryView
	readonly historyFormat: HistoryFormatter
	readonly observers: ExecutionObserver[] = []
	readonly breakpoints = new Set<number>()
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
	private readonly info = new BetaInstructionInfo()

	constructor(readonly program: BetaAssembly, options: BetaRuntimeOptions) {
		this.machine = new BetaMachine({
			memoryBytes: options.memoryBytes,
			tty: options.tty,
			clock: options.clock,
			segmentation: options.segmentation,
			historyLimit: options.historyLimit,
		})
		this.machine.load(program.image())
		this.speed = options.speed
		this.history = new BetaHistoryView(this.machine.history)
		this.historyFormat = betaHistoryFormatter(this.machine.history, this.machine.console)
	}

	get pc() { return this.machine.cpu.fetchAddress() }
	get halted() { return this.machine.halted || this.stopped || this.fault !== null }

	/**
	 * RDCHAR waiting, or a tty program that has run in user mode, where typing
	 * raises keyboard interrupts, with nothing typed still to deliver.
	 */
	get pendingInput() {
		const { console, userMode } = this.machine
		if (this.halted) return null
		if (console.waiting) return RDCHAR_INPUT
		return console.tty && userMode && !console.typed ? KEYBOARD_INPUT : null
	}
	get instructionCount() { return this.machine.instructionCount }
	get historyCursor() { return this.history.length }

	get console() {
		const output = this.machine.console.output
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
		let address = -1
		let word = 0
		if (observers.length > 0) {
			const fetch = cpu.fetchAddress()
			if (fetch <= cpu.memory.length - 4) {
				address = fetch
				word = cpu.readWord(fetch)
				classifyBeta(word, cpu.pc, cpu.registers, this.info)
			}
		}
		const count = machine.instructionCount
		const status = machine.step()
		if (status === STEP_FAULT) {
			this.fault = faultMessage(cpu.fault, cpu.faultAddress)
			return status
		}
		if (address >= 0 && status !== STEP_WAIT && status !== STEP_INTERRUPT) this.notify(address, word, count, status)
		return status
	}

	private notify(address: number, word: number, count: number, status: number) {
		const observers = this.observers
		for (const observer of observers) observer.onInstruction?.(address, word, count)
		// A trap or a halt touched no data.
		if (status !== STEP_OK) return
		const { flags, memoryAddress, target } = this.info
		if (flags & INSN_LOAD) for (const observer of observers) observer.onMemoryRead?.(memoryAddress, 4)
		if (flags & INSN_STORE) {
			// ST writes Rc, which the store itself leaves as it was.
			const value = this.machine.cpu.registers[(word >>> 21) & 31]
			for (const observer of observers) observer.onMemoryWrite?.(memoryAddress, 4, value)
		}
		if (flags & INSN_BRANCH) {
			const taken = (flags & INSN_TAKEN) !== 0
			for (const observer of observers) observer.onBranch?.(address, taken, (target & ADDRESS_MASK) >>> 0)
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
		const cpu = this.machine.cpu
		const fetch = cpu.fetchAddress()
		if (!this.halted && fetch <= cpu.memory.length - 4) {
			// A call runs to completion: back at the word after it.
			const { flags } = classifyBeta(cpu.readWord(fetch), cpu.pc, cpu.registers, this.info)
			if (flags & INSN_CALL) {
				await this.runToTemporaryBreakpoint((this.pc + 4) >>> 0, true)
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

	/** Keeps the mode the PC is in; only the address moves, back through the MMU in user mode. */
	setProgramCounter(address: number) {
		const { pc, segmentation, segBase } = this.machine.cpu
		const user = !(pc & SUPERVISOR)
		const target = segmentation && user ? (address - segBase) & ADDRESS_MASK : address & ADDRESS_MASK
		this.machine.editPc(((pc & SUPERVISOR) | target) >>> 0)
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

	/** A submitted line goes to RDCHAR a character at a time, newline included. */
	provideInput(input: string, cancelled = false): boolean {
		if (cancelled || !this.pendingInput) return false
		this.machine.console.feed(`${input}\n`)
		return true
	}

	registerValues(): Registers {
		const { registers, pc } = this.machine.cpu
		const values: Registers = {}
		for (let index = 0; index < registers.length; index++) values[`R${index}`] = registers[index]
		values.PC = pc >>> 0
		return values
	}

	writeRegister(id: string, value: number): boolean {
		if (id === 'PC') {
			const changed = this.machine.editPc(value)
			this.fault = null
			this.stopped = false
			return changed
		}
		const match = REGISTER_ID.exec(id)
		return match !== null && this.machine.editRegister(Number(match[1]), value)
	}

	inspectMemory(): MemoryInspector {
		return new BetaMemory(this.machine.cpu.memory)
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
		return { delayedBranching: false, instructions: betaInstructionSet, history: this.history }
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
		// An unlimited run still gives the page a turn between batches.
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
