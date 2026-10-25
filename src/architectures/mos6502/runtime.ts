import { RamInspector } from '../../core/ramInspector'
import { notifyHistorySeek } from '../../core/observer'
/**
 * A Mos6502Machine behind the neutral machine contract: the run loop,
 * breakpoints, pacing, observers and user edits the debugger drives.
 */

import { MemoryEdits } from '../../core/memoryEdits'
import type { ExecutionObserver, MachineConfig } from '../../core/observer'
import { ExecutionController, ExecutionStep } from '../../core/executionController'
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

/** A read of $F001 takes a character at a time; a submitted line arrives with its newline. */
const READ_INPUT: PendingInput = Object.freeze({ type: 'string', prompt: 'The program is waiting to read $F001' })
/** A program polling the keyboard, or taking its interrupts, can be typed to while it runs. */
const KEYBOARD_INPUT: PendingInput = Object.freeze({ type: 'string', prompt: 'Type to queue keyboard input' })

const FLAG_BITS: ReadonlyMap<string, number> = new Map(FLAGS.map(({ id, bit }) => [id, bit]))

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
	/** Why the CPU refused the last instruction, which ends the run. */
	private fault: string | null = null
	private speed: number | null
	private pacedAddresses: ReadonlySet<number> | null = null
	/** The instruction about to run, classified for the observers. */
	private readonly access = new Mos6502Access()

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
	get stopReason() { return this.execution.reason(this.machine.halted, this.fault, this.machine.cpu.faultAddress) }
	get halted() { return this.machine.halted || this.execution.stopped || this.fault !== null }

	/** A read of $F001 waiting, or a program that looks for keys, with none queued. */
	get pendingInput() {
		const { device } = this.machine
		if (this.halted) return null
		if (device.waiting) return READ_INPUT
		return !device.keyReady && (this.machine.cpu.sleeping || device.polled || (device.control & ENABLE_KEYBOARD) !== 0) ? KEYBOARD_INPUT : null
	}
	get instructionCount() { return this.machine.instructionCount }
	get historyCursor() { return this.machine.history?.timeline.index ?? 0 }

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
		if (this.machine.history?.stepForward()) {
			this.seekObservers()
			return STEP_OK
		}
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
	/** A JSR runs to completion: back at the instruction after it. */
	async stepOver() {
		if (!this.halted && classifyAt(this.machine.cpu, this.access).flags & ACCESS_CALL) {
			await this.execution.stepOver((this.pc + 3) & 0xFFFF)
			return
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

	setProgramCounter(address: number) {
		if (!this.execution.canEdit(address)) return
		this.machine.editPc(address)
		this.fault = null
		this.execution.stopped = false
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
		if (typeof value !== 'number' || !this.execution.canEdit(value)) return false
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
		return new RamInspector(this.machine.cpu.memory, { wordBytes: 1, littleEndian: true })
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
		return { addressing: { instructionBytes: 1, memoryWordBytes: 1 }, delayedBranching: false, instructions: instructionSetFor(this.machine.cpu.model), history: this.history }
	}

	dispose() {
		this.stop()
		this.execution.dispose()
	}

	private runUntil(shouldStop: () => boolean) {
		return this.execution.runUntil(shouldStop)
	}
}
