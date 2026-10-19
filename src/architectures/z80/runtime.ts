/**
 * A Z80Machine behind the neutral machine contract: the run loop, breakpoints,
 * pacing, observers and user edits the debugger drives.
 */

import type { ExecutionObserver, MachineConfig } from '../../core/observer'
import { yieldToHost } from '../../core/yieldToHost'
import type { CallFrame, HistoryFormatter, Machine, MemoryInspector, PendingInput, Registers } from '../contracts'
import { instructionLength } from './disassemble'
import { z80HistoryFormatter, Z80HistoryView } from './historyView'
import { classify, packInstruction, Z80_CALL, Z80_CONDITIONAL, Z80_RETURN, z80InstructionSet } from './instructions'
import { IRQ_KEYBOARD, STEP_INTERRUPT, STEP_OK, STEP_WAIT, Z80Machine } from './machine'
import type { Z80Assembly } from './program'
import { REGISTER_FIELDS, T_STATES } from './registers'

/** Instructions run between yields to the browser. */
const DEFAULT_BATCH_SIZE = 20_000
/** Redraws per second when execution is paced, which sets the batch size. */
const ANIMATION_FRAMES_PER_SECOND = 30
/** Longest a paced run sleeps without looking at the speed control again. */
const FRAME_SLICE_MS = 50
/** How much of a stalled run a paced run will make up once it resumes. */
const MAX_CATCH_UP_SECONDS = 0.25

/** A read of the waiting input register; a submitted line arrives with its newline. */
const READ_INPUT: PendingInput = Object.freeze({ type: 'string', prompt: 'The program is waiting for input' })
/** A program polling the keyboard, or taking its interrupts, can be typed to while it runs. */
const KEYBOARD_INPUT: PendingInput = Object.freeze({ type: 'string', prompt: 'Type to send the program characters' })

/** Debugger reads of the 64 KiB memory; nothing here reaches a device or records. */
export class Z80Memory implements MemoryInspector {
	readonly wordBytes = 1
	readonly littleEndian = true

	constructor(private readonly bytes: Uint8Array) {}

	byte(address: number): number | undefined {
		return address >= 0 && address < this.bytes.length ? this.bytes[address] : undefined
	}

	word(address: number): number | undefined {
		return this.byte(address)
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
	readonly observers: ExecutionObserver[] = []
	readonly breakpoints = new Set<number>()
	onProgress: (() => void) | null = null
	paused = false
	private running = false
	/** Ended by the user; only a fresh run carries on. */
	private stopped = false
	private speed: number | null
	private pacedAddresses: ReadonlySet<number> | null = null

	constructor(readonly program: Z80Assembly, options: Z80RuntimeOptions) {
		this.machine = new Z80Machine({ historyLimit: options.historyLimit })
		this.machine.load(program.image())
		this.speed = options.speed
		this.history = new Z80HistoryView(this.machine.history)
		this.historyFormat = z80HistoryFormatter(this.machine.history, this.machine.console)
	}

	get pc() { return this.machine.cpu.pc }
	get halted() { return this.machine.halted || this.stopped }
	get instructionCount() { return this.machine.instructionCount }
	get historyCursor() { return this.history.length }

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
		if (!this.halted && !cpu.halted) {
			// A call runs to completion: back at the instruction after it.
			const flags = classify(this.atPc)
			if ((flags & Z80_CALL) && !(flags & Z80_RETURN)) {
				await this.runToTemporaryBreakpoint((cpu.pc + instructionLength(this.atPc)) & 0xFFFF, true)
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

	private resumed() {
		this.stopped = false
		this.paused = true
		this.running = false
		this.seekObservers()
	}

	setProgramCounter(address: number) {
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
		const field = REGISTER_FIELDS[id]
		if (!field) return false
		const { slot, shift, mask } = field
		const old = this.machine.cpu.slot(slot)
		const changed = this.machine.editSlot(slot, (old & ~(mask << shift)) | ((value & mask) << shift))
		if (id === 'PC') this.stopped = false
		return changed
	}

	inspectMemory(): MemoryInspector {
		return new Z80Memory(this.machine.cpu.memory)
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
		return { delayedBranching: false, instructions: z80InstructionSet, history: this.history }
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

	/** Runs until `shouldStop()` holds after a step, a breakpoint, input, or the end. */
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
				if (!first && this.breakpoints.has(this.pc) && !this.machine.cpu.halted) {
					this.pause()
					break
				}
				first = false
				const status = this.advance()
				if (status === STEP_WAIT || shouldStop()) {
					this.pause()
					break
				}
				// Interrupts and the words the editor cannot point at get no frame of their own.
				if (status === STEP_INTERRUPT) continue
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
