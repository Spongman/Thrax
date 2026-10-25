import { RamInspector } from '../../core/ramInspector'
import { notifyHistorySeek } from '../../core/observer'
/**
 * A Z80Machine behind the neutral machine contract: the run loop, breakpoints,
 * pacing, observers and user edits the debugger drives.
 */

import { MemoryEdits } from '../../core/memoryEdits'
import type { ExecutionObserver, MachineConfig } from '../../core/observer'
import { ExecutionController, ExecutionStep } from '../../core/executionController'
import type { CallFrame, HistoryFormatter, KeyboardDisplayDevice, Machine, MemoryInspector, PendingInput, Registers } from '../contracts'
import { instructionLength } from './disassemble'
import { z80HistoryFormatter, Z80HistoryView } from './historyView'
import { classify, packInstruction, Z80_CALL, Z80_CONDITIONAL, Z80_RETURN, z80InstructionSet } from './instructions'
import { IRQ_KEYBOARD, STEP_INTERRUPT, STEP_OK, STEP_WAIT, Z80Machine } from './machine'
import type { Z80Assembly } from './program'
import { REGISTER_FIELDS, T_STATES } from './registers'

/** A read of the waiting input register; a submitted line arrives with its newline. */
const READ_INPUT: PendingInput = Object.freeze({ type: 'string', prompt: 'The program is waiting for input' })
/** A program polling the keyboard, or taking its interrupts, can be typed to while it runs. */
const KEYBOARD_INPUT: PendingInput = Object.freeze({ type: 'string', prompt: 'Type to send the program characters' })

/** The Z80 debugger reads RAM directly, without accessing devices. */
export class Z80Memory extends RamInspector {
	constructor(bytes: Uint8Array) {
		super(bytes, { wordBytes: 1, littleEndian: true })
	}
}

export interface Z80RuntimeOptions {
	historyLimit: number
	speed: number | null
}

export class Z80Runtime implements Machine {
	readonly machine: Z80Machine
	readonly history: Z80HistoryView
	readonly historyFormat: HistoryFormatter
	readonly keyboardDisplay: KeyboardDisplayDevice
	readonly observers: ExecutionObserver[] = []
	readonly breakpoints = new Set<number>()
	onProgress: (() => void) | null = null
	paused = false
	private speed: number | null
	private pacedAddresses: ReadonlySet<number> | null = null

	private readonly execution = new ExecutionController(this, {
		speed: () => this.speed,
		pacedAddresses: () => this.pacedAddresses,
		depth: () => this.machine.callStack.depth,
		step: () => (() => { const status = this.advance(); return status === STEP_WAIT ? ExecutionStep.WAIT : status === STEP_INTERRUPT ? ExecutionStep.HIDDEN : ExecutionStep.ADVANCED })(),
		breakpointEnabled: () => !this.machine.cpu.halted,
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

	constructor(readonly program: Z80Assembly, options: Z80RuntimeOptions) {
		this.machine = new Z80Machine({ historyLimit: options.historyLimit })
		this.machine.load(program.image())
		this.speed = options.speed
		this.history = new Z80HistoryView(this.machine.history)
		this.historyFormat = z80HistoryFormatter(this.machine.history, this.machine.console)
		const device = this.machine.console
		this.keyboardDisplay = {
			state: () => ({
				queuedInput: (device.key < 0 ? '' : String.fromCharCode(device.key)) + device.input.slice(device.inputIndex),
				displayOutput: device.output,
			}),
			queue: (input) => device.feed(input),
		}
	}

	get pc() { return this.machine.cpu.pc }
	get stopReason() { return this.execution.reason(this.machine.halted) }
	get halted() { return this.machine.halted || this.execution.stopped }
	get instructionCount() { return this.machine.instructionCount }
	get historyCursor() { return this.machine.history?.timeline.index ?? 0 }

	get pendingInput(): PendingInput | null {
		const { console, sleeping } = this.machine
		if (this.halted) return null
		if (console.waiting) return READ_INPUT
		const listening = sleeping || console.listening || (console.control & IRQ_KEYBOARD) !== 0
		return listening && !console.typed ? KEYBOARD_INPUT : null
	}

	get console() {
		const { output, exitCode } = this.machine.console
		return exitCode > 0 ? `${output}\nExit code ${exitCode}\n` : output
	}

	get callStack(): CallFrame[] {
		return this.machine.callStack.frames().map((frame) => ({
			callAddress: frame.callSite,
			returnAddress: frame.returnAddress,
			targetAddress: frame.callee,
		}))
	}

	/** Reads the byte `offset` past the PC, without reaching a device. */
	private readonly atPc = (offset: number) => this.machine.cpu.memory[(this.machine.cpu.pc + offset) & 0xFFFF]

	step() {
		if (this.halted) return
		this.advance()
	}

	/** One step, told to the observers when they are listening; returns the STEP_* code. */
	private advance(): number {
		try {
			if (this.machine.history?.stepForward()) {
				this.seekObservers()
				return STEP_OK
			}
			const machine = this.machine
			const cpu = machine.cpu
			const observers = this.observers
			if (observers.length === 0 || cpu.halted) return machine.step()
			const address = cpu.pc
			const packed = packInstruction(this.atPc, instructionLength(this.atPc))
			const flags = classify(this.atPc)
			const fallThrough = (address + instructionLength(this.atPc)) & 0xFFFF
			const target = flags & Z80_CONDITIONAL ? branchTarget(this.atPc, fallThrough, cpu.memory, cpu.sp) : 0
			const count = machine.instructionCount
			cpu.observer = {
				read: (at) => { for (const observer of observers) observer.onMemoryRead?.(at, 1) },
				write: (at, value) => { for (const observer of observers) observer.onMemoryWrite?.(at, 1, value) },
			}
			let status: number
			try {
				// The instruction is announced first; an interrupt in its place is not.
				if (!machine.nmiPending && !(cpu.interruptible && (machine.console.pending & machine.console.control))) {
					for (const observer of observers) observer.onInstruction?.(address, packed, count)
				}
				status = machine.step()
			} finally {
				cpu.observer = null
			}
			if (status === STEP_OK && (flags & Z80_CONDITIONAL)) {
				const taken = cpu.pc !== fallThrough
				for (const observer of observers) observer.onBranch?.(address, taken, target)
			}
			return status
		} catch (error) {
			this.execution.recordFault(error)
			throw error
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
		if (!this.halted && !cpu.halted) {
			// A call runs to completion: back at the instruction after it.
			const flags = classify(this.atPc)
			if ((flags & Z80_CALL) && !(flags & Z80_RETURN)) {
				await this.execution.stepOver((cpu.pc + instructionLength(this.atPc)) & 0xFFFF)
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

	private resumed() {
		this.seekObservers()
	}

	setProgramCounter(address: number) {
		if (!this.execution.canEdit(address)) return
		this.writeRegister('PC', address)
	}

	configure(options: { speed?: number | null, pacedAddresses?: ReadonlySet<number> | null }) {
		if (options.speed !== undefined) this.speed = options.speed
		if (options.pacedAddresses !== undefined) this.pacedAddresses = options.pacedAddresses
	}

	addBreakpoint(address: number) { this.breakpoints.add(address & 0xFFFF) }
	removeBreakpoint(address: number) { this.breakpoints.delete(address & 0xFFFF) }
	getBreakpoints() { return Array.from(this.breakpoints) }

	provideInput(input: string, cancelled = false): boolean {
		if (cancelled || !this.pendingInput) return false
		this.machine.console.feed(`${input}\n`)
		return true
	}

	registerValues(): Registers {
		const cpu = this.machine.cpu
		const values: Registers = {}
		for (const [id, { slot, shift, mask }] of Object.entries(REGISTER_FIELDS)) values[id] = (cpu.slot(slot) >> shift) & mask
		values[T_STATES] = cpu.cycles
		return values
	}

	writeRegister(id: string, value: number): boolean {
		if (typeof value !== 'number' || !this.execution.canEdit(value)) return false
		const field = REGISTER_FIELDS[id]
		if (!field) return false
		const { slot, shift, mask } = field
		const old = this.machine.cpu.slot(slot)
		const changed = this.machine.editSlot(slot, (old & ~(mask << shift)) | ((value & mask) << shift))
		if (id === 'PC') this.execution.stopped = false
		return changed
	}

	inspectMemory(): MemoryInspector {
		return new Z80Memory(this.machine.cpu.memory)
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
		return { addressing: { instructionBytes: 1, memoryWordBytes: 1 }, delayedBranching: false, instructions: z80InstructionSet, history: this.history }
	}

	dispose() {
		this.stop()
		this.execution.dispose()
	}

	private runUntil(shouldStop: () => boolean) {
		return this.execution.runUntil(shouldStop)
	}
}

/** Where a conditional transfer goes when taken, read before it runs. */
function branchTarget(read: (offset: number) => number, fallThrough: number, memory: Uint8Array, sp: number): number {
	let at = 0
	while (read(at) === 0xDD || read(at) === 0xFD) at++
	const opcode = read(at)
	// JR cc and DJNZ are relative; JP cc and CALL cc absolute; RET cc goes where the stack says.
	if (opcode === 0x10 || (opcode & 0xE7) === 0x20) return (fallThrough + ((read(at + 1) << 24) >> 24)) & 0xFFFF
	if ((opcode & 0xC7) === 0xC2 || (opcode & 0xC7) === 0xC4) return read(at + 1) | (read(at + 2) << 8)
	return memory[sp] | (memory[(sp + 1) & 0xFFFF] << 8)
}
