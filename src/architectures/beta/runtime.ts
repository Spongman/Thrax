import { RamInspector } from '../../core/ramInspector'
import { notifyHistorySeek } from '../../core/observer'
/**
 * A BetaMachine behind the neutral machine contract: the run loop, breakpoints,
 * pacing, observers and user edits the debugger drives.
 *
 * The contract's addresses carry no supervisor bit, so the editor, breakpoints
 * and history name the same address in either mode; the PC register shows the
 * bit. With segmentation they are physical: a user-mode PC is shown through
 * the MMU, as BSim's breakpoints and disassembly do.
 */

import { MemoryEdits } from '../../core/memoryEdits'
import type { ExecutionObserver, MachineConfig } from '../../core/observer'
import type { CallFrame, HistoryFormatter, Machine, MemoryInspector, PendingInput, Registers } from '../contracts'
import { BetaInstructionInfo, classifyBeta, INSN_BRANCH, INSN_CALL, INSN_LOAD, INSN_STORE, INSN_TAKEN } from './classify'
import { faultMessage, STEP_FAULT, STEP_INTERRUPT, STEP_OK, STEP_WAIT, SUPERVISOR } from './cpu'
import { betaHistoryFormatter, BetaHistoryView } from './historyView'
import { betaInstructionSet } from './instructions'
import { BetaMachine } from './machine'
import type { BetaAssembly } from './program'
import { ExecutionController, ExecutionStep } from '../../core/executionController'

const ADDRESS_MASK = 0x7FFFFFFF
const REGISTER_ID = /^R(\d+)$/

/** RDCHAR reads a character at a time; a submitted line arrives with its newline. */
const RDCHAR_INPUT: PendingInput = Object.freeze({ type: 'string', prompt: 'RDCHAR is waiting for input' })
/** A program taking keyboard interrupts can be typed to while it runs. */
const KEYBOARD_INPUT: PendingInput = Object.freeze({ type: 'string', prompt: 'Type to raise keyboard interrupts' })

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
	/** Why the CPU refused the last instruction, which ends the run. */
	private fault: string | null = null
	private speed: number | null
	private pacedAddresses: ReadonlySet<number> | null = null
	/** The instruction about to run, classified for the observers. */
	private readonly info = new BetaInstructionInfo()

	private readonly execution = new ExecutionController(this, {
		speed: () => this.speed,
		pacedAddresses: () => this.pacedAddresses,
		depth: () => this.machine.callStack.depth,
		step: () => this.advance() === STEP_WAIT ? ExecutionStep.WAIT : ExecutionStep.ADVANCED,
	})
	private readonly historyCommands = this.execution.historyCommands({
		history: () => this.history, cursor: () => this.historyCursor,
		undo: () => this.machine.history?.stepBack() ?? false,
		after: () => this.resumed(),
	})

	private readonly memoryEdits = new MemoryEdits({
		region: () => ({ start: 0, end: this.machine.cpu.memory.length - 1 }),
		read: (address) => this.machine.cpu.memory[address],
		commit: (address, bytes) => this.machine.editBytes(address, bytes),
		clampLimit: true,
	})

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
	get stopReason() { return this.execution.reason(this.machine.halted, this.fault, this.machine.cpu.faultAddress) }
	get halted() { return this.machine.halted || this.execution.stopped || this.fault !== null }

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
	get historyCursor() { return this.machine.history?.timeline.index ?? 0 }

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
		if (this.machine.history?.stepForward()) {
			this.seekObservers()
			return STEP_OK
		}
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
		notifyHistorySeek(this.observers, this.machine.instructionCount)
	}

	run() {
		return this.runUntil(() => false)
	}

	/** Input typed while running continues too; the run already going carries on. */
	async continue() {
		if (this.execution.running) return
		this.paused = false
		await this.run()
	}

	runTo(address: number) {
		return this.execution.runTo(address)
	}
	async stepOver() {
		const cpu = this.machine.cpu
		const fetch = cpu.fetchAddress()
		if (!this.halted && fetch <= cpu.memory.length - 4) {
			// A call runs to completion: back at the word after it.
			const { flags } = classifyBeta(cpu.readWord(fetch), cpu.pc, cpu.registers, this.info)
			if (flags & INSN_CALL) {
				await this.execution.stepOver((this.pc + 4) >>> 0)
				return
			}
		}
		this.step()
	}

	/** Runs until the frame the PC is in returns. */
	stepToReturn() {
		return this.execution.stepToReturn()
	}
	pause() { this.execution.pause() }
	stop() { this.execution.stop() }
	stepBack(): boolean {
		return this.historyCommands.stepBack()
	}

	rewindTo(id: number): boolean {
		return this.historyCommands.rewindTo(id)
	}

	/** Back from a rewind: whatever ended the run is undone with it. */
	private resumed() {
		this.fault = null
		this.seekObservers()
	}

	/** Keeps the mode the PC is in; only the address moves, back through the MMU in user mode. */
	setProgramCounter(address: number) {
		if (!this.execution.canEdit(address)) return
		const { pc, segmentation, segBase } = this.machine.cpu
		const user = !(pc & SUPERVISOR)
		const target = segmentation && user ? (address - segBase) & ADDRESS_MASK : address & ADDRESS_MASK
		this.machine.editPc(((pc & SUPERVISOR) | target) >>> 0)
		this.fault = null
		this.execution.stopped = false
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
		if (typeof value !== 'number' || !this.execution.canEdit(value)) return false
		if (id === 'PC') {
			const changed = this.machine.editPc(value)
			this.fault = null
			this.execution.stopped = false
			return changed
		}
		const match = REGISTER_ID.exec(id)
		return match !== null && this.machine.editRegister(Number(match[1]), value)
	}

	inspectMemory(): MemoryInspector {
		return new RamInspector(this.machine.cpu.memory, { wordBytes: 4, littleEndian: true })
	}

	writeByte(address: number, value: number) {
		if (!this.execution.canEdit(value) || !Number.isSafeInteger(address) || address < 0) return false
		return this.machine.editBytes(address, [value])
	}

	/** Shifts `[address, limit]` up a byte; what is past the last non-zero byte stays. */
	insertByte(address: number, limit: number, value: number): boolean {
		if (!this.execution.canEdit(value)) return false
		return this.memoryEdits.insert(address, limit, value)
	}

	deleteByte(address: number, limit: number): boolean {
		if (!this.execution.canEdit(address)) return false
		return this.memoryEdits.delete(address, limit)
	}

	toolConfig(): MachineConfig {
		return { addressing: { instructionBytes: 4, memoryWordBytes: 4 }, delayedBranching: false, instructions: betaInstructionSet, history: this.history }
	}

	dispose() {
		this.stop()
		this.execution.dispose()
	}

	private runUntil(shouldStop: () => boolean) {
		return this.execution.runUntil(shouldStop)
	}
}
