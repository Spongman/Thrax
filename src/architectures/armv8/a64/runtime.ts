import { RamInspector } from '../../../core/ramInspector'
import { notifyHistorySeek } from '../../../core/observer'
/**
 * An A64Machine behind the neutral machine contract: the run loop,
 * breakpoints, pacing, observers and user edits the debugger drives.
 */

import { MemoryEdits } from '../../../core/memoryEdits'
import type { ExecutionObserver, MachineConfig } from '../../../core/observer'
import { ExecutionController, ExecutionStep } from '../../../core/executionController'
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

const READ_INPUT: PendingInput = Object.freeze({ type: 'string', prompt: 'read() is waiting for input' })

export interface A64RuntimeOptions {
	memoryBytes: number
	historyLimit: number
	speed: number | null
	/** SIMD&FP instructions run; on unless false. */
	floatingPoint?: boolean
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
	/** Why the CPU refused the last instruction, which ends the run. */
	private fault: string | null = null
	private speed: number | null
	private pacedAddresses: ReadonlySet<number> | null = null
	/** The instruction about to run, classified for the observers. */
	private readonly info = new A64InstructionInfo()

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
		region: () => ({ start: this.machine.cpu.base, end: this.machine.cpu.base + this.machine.cpu.memory.length - 1 }),
		read: (address) => this.machine.cpu.memory[address - this.machine.cpu.base],
		commit: (address, bytes) => this.machine.editBytes(address, bytes),
		clampLimit: true,
	})

	constructor(readonly program: A64Assembly, options: A64RuntimeOptions) {
		this.machine = new A64Machine({ memoryBytes: options.memoryBytes, historyLimit: options.historyLimit, floatingPoint: options.floatingPoint })
		this.machine.load(program.image())
		this.speed = options.speed
		this.history = new A64HistoryView(this.machine.history)
		this.historyFormat = a64HistoryFormatter(this.machine.history, this.machine.linux, this.machine.keyboard)
		this.keyboardDisplay = this.machine.keyboard.device()
	}

	get pc() { return this.machine.cpu.pc }
	get stopReason() { return this.execution.reason(this.machine.halted, this.fault, this.machine.cpu.faultAddress) }
	get halted() { return this.machine.halted || this.execution.stopped || this.fault !== null }
	get pendingInput() { return !this.halted && this.machine.linux.waiting ? READ_INPUT : null }
	get instructionCount() { return this.machine.instructionCount }
	get historyCursor() { return this.machine.history?.timeline.index ?? 0 }

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
			const cpu = this.machine.cpu
			const value = Number((decode(word).fp ? cpu.v[2 * (word & 31)] : cpu.read(word & 31)) & MASK32)
			for (const observer of observers) observer.onMemoryWrite?.(memoryAddress, memorySize, value)
		}
		if (flags & INSN_BRANCH) {
			const taken = (flags & INSN_TAKEN) !== 0
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
	async stepOver() {
		const word = this.halted ? -1 : this.fetch()
		if (word >= 0) {
			const d = decode(word)
			// A call runs to completion: back at the word after it.
			if (d.op === Op.BL || d.op === Op.BLR) {
				await this.execution.stepOver(this.pc + 4)
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
		if (!this.execution.canEdit(value)) return false
		const target = editTarget(id)
		if (!target) return false
		const machine = this.machine
		switch (target.kind) {
			case 'x': return machine.editRegister(target.index, BigInt(value))
			case 'w': return machine.editW(target.index, Number(BigInt.asUintN(32, BigInt(value))))
			case 'nzcv': return machine.editFlags(Number(BigInt(value) >> 28n) & 15)
			case 'vlow': case 'vhigh': return machine.editVector(target.index, Number(BigInt.asUintN(32, BigInt(value))), target.kind === 'vhigh')
			case 'fpcr': return machine.editFpcr(Number(BigInt.asUintN(32, BigInt(value))))
			case 'fpsr': return machine.editFpsr(Number(BigInt.asUintN(32, BigInt(value))))
		}
		const changed = machine.editPc(Number(BigInt.asUintN(64, BigInt(value))))
		this.fault = null
		this.execution.stopped = false
		return changed
	}

	inspectMemory(): MemoryInspector {
		const cpu = this.machine.cpu
		return new RamInspector(cpu.memory, { wordBytes: 4, littleEndian: true, base: cpu.base })
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
		return { addressing: { instructionBytes: 4, memoryWordBytes: 4 }, delayedBranching: false, instructions: a64InstructionSet, history: this.history }
	}

	dispose() {
		this.stop()
		this.execution.dispose()
	}

	private runUntil(shouldStop: () => boolean) {
		return this.execution.runUntil(shouldStop)
	}
}
