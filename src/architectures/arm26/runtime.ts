import { notifyHistorySeek } from '../../core/observer'
import { rewindHistoryTo } from '../../core/historyCursor'
/**
 * An Arm26Machine behind the neutral machine contract: the run loop,
 * breakpoints, pacing, observers and user edits the debugger drives.
 */

import { MemoryEdits } from '../../core/memoryEdits'
import type { ExecutionObserver, MachineConfig } from '../../core/observer'
import { ExecutionController, ExecutionStep } from '../../core/executionController'
import { conditionPassed, shiftByImmediate } from '../arm/a32/alu'
import { FLAG_C, FORMAT_BLOCK, FORMAT_BRANCH, FORMAT_SWAP, FORMAT_TRANSFER, branchOffset, formatOf, popCount } from '../arm/a32/isa'
import type { ArmAssembly } from '../arm/program'
import type { CallFrame, HistoryFormatter, KeyboardDisplayDevice, Machine, MemoryInspector, PendingInput, Registers } from '../contracts'
import { BANKS, PC_MASK, PSR_MASK, STEP_FAULT, STEP_INTERRUPT, STEP_OK, STEP_WAIT, faultMessage } from './cpu'
import { arm26HistoryFormatter, Arm26HistoryView } from './historyView'
import { arm26InstructionSet, isCall } from './instructions'
import { Arm26Machine } from './machine'
import { FLAG_BITS, PHYSICAL_IDS } from './registers'
import type { Arm26Model } from './arm3'
import type { Arm26BusTiming } from './busTiming'

const REGISTER_ID = /^R(\d+)$/

const READC_INPUT: PendingInput = Object.freeze({ type: 'string', prompt: 'OS_ReadC is waiting for input' })

/** Debugger reads of RAM; nothing here can fault or record. */
class Arm26Memory implements MemoryInspector {
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

/** What an instruction about to run will touch, worked out before it runs. */
class Access {
	/** Whether its condition passes. */
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

export interface Arm26RuntimeOptions {
	memoryBytes: number
	cpuModel?: Arm26Model
	timing?: Readonly<Arm26BusTiming>
	historyLimit: number
	speed: number | null
}

export class Arm26Runtime implements Machine {
	readonly machine: Arm26Machine
	readonly history: Arm26HistoryView
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
	private readonly access = new Access()

	private readonly execution = new ExecutionController(this, {
		speed: () => this.speed,
		pacedAddresses: () => this.pacedAddresses,
		depth: () => this.machine.callStack.depth,
		step: () => this.advance() === STEP_WAIT ? ExecutionStep.WAIT : ExecutionStep.ADVANCED,
	})

	private readonly memoryEdits = new MemoryEdits({
		region: () => ({ start: 0, end: this.machine.cpu.memory.length - 1 }),
		read: (address) => this.machine.cpu.memory[address],
		commit: (address, bytes) => this.machine.editBytes(address, bytes),
		clampLimit: true,
	})

	constructor(readonly program: ArmAssembly, options: Arm26RuntimeOptions) {
		this.machine = new Arm26Machine({ memoryBytes: options.memoryBytes, cpuModel: options.cpuModel, timing: options.timing, historyLimit: options.historyLimit })
		this.machine.load(program.image())
		this.speed = options.speed
		this.history = new Arm26HistoryView(this.machine.history)
		this.historyFormat = arm26HistoryFormatter(this.machine.history, this.machine.os, this.machine.keyboard, () => this.machine.cpu.mode)
		this.keyboardDisplay = this.machine.keyboard
	}

	get pc() { return this.machine.cpu.pc }
	get halted() { return this.machine.halted || this.execution.stopped || this.fault !== null }
	get pendingInput() { return !this.halted && this.machine.os.waiting ? READC_INPUT : null }
	get instructionCount() { return this.machine.instructionCount }
	get historyCursor() { return this.machine.history?.timeline.index ?? 0 }

	get console() {
		const output = this.machine.os.output
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
		const { machine, observers } = this
		const cpu = machine.cpu
		const address = cpu.pc
		let word = 0
		const listening = observers.length > 0 && address <= cpu.memory.length - 4
		if (listening) {
			word = cpu.peekInstruction()
			this.inspect(word)
		}
		const count = machine.instructionCount
		const status = machine.step()
		if (status === STEP_FAULT) {
			this.fault = faultMessage(cpu.fault, cpu.faultAddress)
			return status
		}
		if (listening && status !== STEP_WAIT && status !== STEP_INTERRUPT) this.notify(address, word, count, status)
		return status
	}

	/** Fills `access` for `word` about to run, from the registers as they stand. */
	private inspect(word: number) {
		const cpu = this.machine.cpu
		const access = this.access
		const pc = cpu.pc
		const read = (index: number) => index === 15 ? (pc + 8) & PC_MASK : cpu.register(index)
		access.passes = conditionPassed(word >>> 28, cpu.psr)
		access.address = -1
		access.words = 1
		access.bytes = 4
		access.load = access.store = access.branch = false
		switch (formatOf(word)) {
			case FORMAT_TRANSFER: {
				const base = read((word >>> 16) & 15)
				let offset = word & 0xFFF
				if (word & 0x02000000) offset = shiftByImmediate(read(word & 15), (word >>> 5) & 3, (word >>> 7) & 31, cpu.psr & FLAG_C ? 1 : 0)
				const indexed = word & 0x00800000 ? base + offset : base - offset
				access.address = (word & 0x01000000 ? indexed : base) >>> 0
				access.bytes = word & 0x00400000 ? 1 : 4
				access.load = (word & 0x00100000) !== 0
				access.store = !access.load
				break
			}
			case FORMAT_SWAP:
				access.address = read((word >>> 16) & 15) >>> 0
				access.bytes = word & 0x00400000 ? 1 : 4
				access.load = access.store = true
				break
			case FORMAT_BLOCK: {
				const base = read((word >>> 16) & 15)
				const count = popCount(word)
				const up = (word & 0x00800000) !== 0
				const before = (word & 0x01000000) !== 0
				access.address = ((up ? base + (before ? 4 : 0) : base - 4 * count + (before ? 0 : 4)) >>> 0) & ~3
				access.words = count
				access.load = (word & 0x00100000) !== 0
				access.store = !access.load
				break
			}
			case FORMAT_BRANCH:
				access.branch = word >>> 28 !== 14
				access.target = (pc + 8 + branchOffset(word)) & PC_MASK
				break
		}
	}

	private notify(address: number, word: number, count: number, status: number) {
		const { observers, access } = this
		const cpu = this.machine.cpu
		const instruction = { word, executeCycles: cpu.executeCycles, passed: cpu.passed, redirected: cpu.redirected, timing: Array.from(cpu.timing) }
		for (const observer of observers) observer.onInstruction?.(address, instruction, count)
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
		notifyHistorySeek(this.observers, this.machine.instructionCount)
	}

	run() {
		return this.runUntil(() => false)
	}

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
		if (!this.halted && cpu.pc <= cpu.memory.length - 4) {
			const word = cpu.peekInstruction()
			// A BL that will run is a call: run back to the word after it.
			if (isCall(word) && conditionPassed(word >>> 28, cpu.psr)) {
				await this.execution.stepOver((cpu.pc + 4) & PC_MASK)
				return
			}
		}
		this.step()
	}

	stepToReturn() {
		return this.execution.stepToReturn()
	}
	pause() { this.execution.pause() }
	stop() { this.execution.stop() }
	stepBack(): boolean {
		const log = this.machine.history
		if (!log || !log.stepBack()) return false
		this.resumed()
		return true
	}

	rewindTo(id: number): boolean {
		const log = this.machine.history
		return !!log && rewindHistoryTo(this.history, () => this.historyCursor, id, () => log.stepBack(), () => this.resumed())
	}

	private resumed() {
		this.fault = null
		this.execution.stopped = false
		this.paused = true
		this.execution.running = false
		this.seekObservers()
	}

	setProgramCounter(address: number) {
		this.machine.editPc(address)
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

	/** A submitted line goes to OS_ReadC a character at a time, newline included. */
	provideInput(input: string, cancelled = false): boolean {
		if (cancelled || !this.pendingInput) return false
		this.machine.os.feed(`${input}\n`)
		return true
	}

	registerValues(): Registers {
		const cpu = this.machine.cpu
		const values: Registers = {}
		for (let index = 0; index < 15; index++) values[`R${index}`] = cpu.register(index)
		values.PC = cpu.pc
		values.CYCLES = BigInt(cpu.cycles)
		if (cpu.cache) for (const index of [0, 2, 3, 4, 5]) values[`CP15_${index}`] = cpu.cache.readRegister(index) >>> 0
		for (const [name, bit] of Object.entries(FLAG_BITS)) values[name] = (cpu.psr >>> bit) & 1
		values.PSR = cpu.r15
		for (let index = 8; index < PHYSICAL_IDS.length; index++) values[PHYSICAL_IDS[index]] = cpu.registers[index]
		return values
	}

	writeRegister(id: string, value: number): boolean {
		const machine = this.machine
		const cpu = machine.cpu
		if (id === 'PC') {
			this.setProgramCounter(value)
			return true
		}
		if (id === 'PSR') {
			machine.editPsr(value)
			this.setProgramCounter(value & PC_MASK)
			return true
		}
		const bit = FLAG_BITS[id]
		if (bit !== undefined) return machine.editPsr(((cpu.psr & ~(1 << bit)) | ((value & 1) << bit)) & PSR_MASK)
		const match = REGISTER_ID.exec(id)
		if (match && Number(match[1]) < 15) return machine.editRegister(BANKS[cpu.mode][Number(match[1])], value)
		const physical = PHYSICAL_IDS.indexOf(id)
		return physical >= 0 && machine.editRegister(physical, value)
	}

	inspectMemory(): MemoryInspector {
		return new Arm26Memory(this.machine.cpu.memory)
	}

	writeByte(address: number, value: number) {
		return this.machine.editBytes(address, [value])
	}

	/** Shifts `[address, limit]` up a byte; what is past the last non-zero byte stays. */
	insertByte(address: number, limit: number, value: number): boolean {
		return this.memoryEdits.insert(address, limit, value)
	}

	deleteByte(address: number, limit: number): boolean {
		return this.memoryEdits.delete(address, limit)
	}

	toolConfig(): MachineConfig {
		return { addressing: { instructionBytes: 4, memoryWordBytes: 4 }, delayedBranching: false, instructions: arm26InstructionSet, history: this.history }
	}

	dispose() {
		this.onProgress = null
		this.stop()
		this.execution.dispose()
	}

	private runUntil(shouldStop: () => boolean) {
		return this.execution.runUntil(shouldStop)
	}
}
