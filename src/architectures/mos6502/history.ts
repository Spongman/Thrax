/**
 * 6502 execution history: one entry per state-changing step, each holding the
 * registers, cycle count and timer before it, and owning a run of effects that
 * hold the memory and device state the step replaced.
 *
 * Entries and effects live in the shared HistoryLog, which owns the blocks,
 * eviction and truncation; an entry's id is its absolute position. Rewinding
 * to entry `index` undoes it and everything after it, leaving the machine
 * about to run that entry's instruction again.
 */

import { HistoryBufferLayout, type HistoryBufferSchema } from '../../core/historyBuffers'
import { HistoryLog } from '../../core/historyLog'
import type { Mos6502CallStack, Mos6502CallStackSink } from './callStack'
import { FAULT_NONE, type Mos6502Cpu, type Mos6502EffectSink } from './cpu'
import type { Mos6502Device } from './device'

const column = (name: string, type: 'u8' | 'i32' | 'u32' | 'f64') => Object.freeze({ name, type, elements: 1 })

/**
 * Entry: the instruction's address and opcode (the vector, for an interrupt),
 * its kind, the instruction and cycle counts, A X Y SP packed, P, and the
 * timer's countdown, all as they were before it. Effect: a kind and two values.
 */
export const mos6502HistorySchema: HistoryBufferSchema = Object.freeze({
	entry: Object.freeze([
		column('pc', 'u32'), column('opcode', 'i32'), column('kind', 'u8'), column('count', 'f64'), column('cycles', 'f64'),
		column('registers', 'u32'), column('p', 'u8'), column('timer', 'i32'),
	]),
	effect: Object.freeze([column('kind', 'u8'), column('a', 'i32'), column('b', 'i32')]),
})

/** Effect kinds; `b` is always the old value. `a` is the address. */
export const EFFECT_MEMORY = 0
/** Console output length. */
export const EFFECT_OUTPUT = 1
/** Input position. */
export const EFFECT_INPUT = 2
export const EFFECT_HALTED = 3
export const EFFECT_EXIT = 4
/** `a` is the index of a call-stack frame word. */
export const EFFECT_FRAME_WORD = 5
export const EFFECT_FRAME_DEPTH = 6
/** The interrupt enable register. */
export const EFFECT_CONTROL = 7
export const EFFECT_PERIOD = 8
export const EFFECT_TIMER_FLAG = 9
export const EFFECT_NMI = 10

export const DEFAULT_HISTORY_LIMIT = 100_000

/** Entry kinds: a step the CPU ran, a change the user made, or an interrupt taken. */
export const ENTRY_INSTRUCTION = 0
export const ENTRY_EDIT = 1
export const ENTRY_INTERRUPT = 2

/** What the history records and restores; Mos6502Machine is one. */
export interface Mos6502HistoryTarget {
	readonly cpu: Mos6502Cpu
	readonly device: Mos6502Device
	readonly callStack: Mos6502CallStack
	halted: boolean
	/** Set when the program halted through the I/O page. */
	exitCode: number
	/** An NMI is waiting to be taken. */
	nmiPending: boolean
	instructionCount: number
}

const layout = new HistoryBufferLayout(mos6502HistorySchema)
const PC = layout.column('entry', 'pc', 'u32')
const OPCODE = layout.column('entry', 'opcode', 'i32')
const KIND = layout.column('entry', 'kind', 'u8')
const COUNT = layout.column('entry', 'count', 'f64')
const CYCLES = layout.column('entry', 'cycles', 'f64')
const REGISTERS = layout.column('entry', 'registers', 'u32')
const P = layout.column('entry', 'p', 'u8')
const TIMER = layout.column('entry', 'timer', 'i32')
const EFFECT_KIND = layout.column('effect', 'kind', 'u8')
const EFFECT_A = layout.column('effect', 'a', 'i32')
const EFFECT_B = layout.column('effect', 'b', 'i32')

const packRegisters = (cpu: Mos6502Cpu) => (cpu.a | (cpu.x << 8) | (cpu.y << 16) | (cpu.sp << 24)) >>> 0

export class Mos6502History implements Mos6502EffectSink, Mos6502CallStackSink {
	private readonly log = new HistoryLog(layout)
	// The open entry's starting state.
	private start = 0
	private kind = ENTRY_INSTRUCTION
	private vector = 0
	private pcBefore = 0
	private registersBefore = 0
	private pBefore = 0
	private cyclesBefore = 0
	private countBefore = 0
	private timerBefore = 0
	private outputLength = 0
	private inputIndex = 0
	private halted = false
	private exitCode = -1
	private control = 0
	private period = 0
	private timerFlag = false
	private nmi = false

	constructor(private readonly target: Mos6502HistoryTarget, limit = DEFAULT_HISTORY_LIMIT) {
		this.log.limit = limit
	}

	get limit(): number {
		return this.log.limit
	}

	set limit(value: number) {
		this.log.limit = value
	}

	get length(): number {
		return this.log.length
	}

	/** Id of the oldest entry held; ids count entries since the program loaded. */
	get firstId(): number {
		return this.log.first
	}

	/** Opens an entry; call before the CPU steps, or before an edit with ENTRY_EDIT. */
	begin(kind = ENTRY_INSTRUCTION) {
		const { cpu, device } = this.target
		this.kind = kind
		this.log.openEntryWith(this.log.end)
		this.start = this.log.openEffectStart
		this.pcBefore = cpu.pc
		this.registersBefore = packRegisters(cpu)
		this.pBefore = cpu.p
		this.cyclesBefore = cpu.cycles
		this.countBefore = this.target.instructionCount
		this.timerBefore = device.timer
		this.outputLength = device.output.length
		this.inputIndex = device.inputIndex
		this.halted = this.target.halted
		this.exitCode = this.target.exitCode
		this.control = device.control
		this.period = device.period
		this.timerFlag = device.timerFlag
		this.nmi = this.target.nmiPending
	}

	/** Marks the open entry as taking the interrupt through `vector`. */
	interrupted(vector: number) {
		this.kind = ENTRY_INTERRUPT
		this.vector = vector
	}

	/** Closes the entry; returns whether the step changed anything and so was kept. */
	end(): boolean {
		const { cpu, device } = this.target
		if (device.output.length !== this.outputLength) this.push(EFFECT_OUTPUT, 0, this.outputLength)
		if (device.inputIndex !== this.inputIndex) this.push(EFFECT_INPUT, 0, this.inputIndex)
		if (device.control !== this.control) this.push(EFFECT_CONTROL, 0, this.control)
		if (device.period !== this.period) this.push(EFFECT_PERIOD, 0, this.period)
		if (device.timerFlag !== this.timerFlag) this.push(EFFECT_TIMER_FLAG, 0, this.timerFlag ? 1 : 0)
		if (this.target.nmiPending !== this.nmi) this.push(EFFECT_NMI, 0, this.nmi ? 1 : 0)
		if (this.target.exitCode !== this.exitCode) this.push(EFFECT_EXIT, 0, this.exitCode)
		if (this.target.halted !== this.halted) this.push(EFFECT_HALTED, 0, this.halted ? 1 : 0)
		const log = this.log
		const position = log.openEntry
		// None open: the entry outgrew the byte limit and the log let it go.
		if (position < 0) return false
		const unchanged = log.effects.end === this.start && cpu.pc === this.pcBefore && packRegisters(cpu) === this.registersBefore
			&& cpu.p === this.pBefore && cpu.cycles === this.cyclesBefore && device.timer === this.timerBefore
		if (unchanged) {
			log.discard()
			return false
		}
		const columns = log.entries.block(position).arrays
		const slot = position % log.entries.capacity
		columns[PC][slot] = this.pcBefore
		columns[OPCODE][slot] = this.kind === ENTRY_INTERRUPT ? this.vector : cpu.opcode
		columns[KIND][slot] = this.kind
		columns[COUNT][slot] = this.countBefore
		columns[CYCLES][slot] = this.cyclesBefore
		columns[REGISTERS][slot] = this.registersBefore
		columns[P][slot] = this.pBefore
		columns[TIMER][slot] = this.timerBefore
		log.close()
		return true
	}

	memory(address: number, old: number) {
		this.push(EFFECT_MEMORY, address, old)
	}

	frameWord(index: number, old: number) {
		this.push(EFFECT_FRAME_WORD, index, old)
	}

	depth(old: number) {
		this.push(EFFECT_FRAME_DEPTH, 0, old)
	}

	idAt(index: number): number {
		return this.log.id(index)
	}

	pcAt(index: number): number {
		return this.column(index, PC)
	}

	/** The opcode the entry ran, or the vector of an interrupt. */
	opcodeAt(index: number): number {
		return this.column(index, OPCODE)
	}

	kindAt(index: number): number {
		return this.column(index, KIND)
	}

	/** Instructions retired before entry `index`. */
	countAt(index: number): number {
		return this.column(index, COUNT)
	}

	/** A X Y SP before entry `index`, a byte each from the low end. */
	registersAt(index: number): number {
		return this.column(index, REGISTERS)
	}

	pAt(index: number): number {
		return this.column(index, P)
	}

	effectStartAt(index: number): number {
		return this.log.effectStart(index)
	}

	effectCountAt(index: number): number {
		return this.log.effectCount(index)
	}

	effectKind(position: number): number {
		return this.effect(position, EFFECT_KIND)
	}

	effectA(position: number): number {
		return this.effect(position, EFFECT_A)
	}

	effectB(position: number): number {
		return this.effect(position, EFFECT_B)
	}

	/** Undoes the last entry; false when none is held. */
	stepBack(): boolean {
		if (this.log.length === 0) return false
		this.rewindTo(this.log.length - 1)
		return true
	}

	/** Undoes entry `index` and every later one, then forgets them. */
	rewindTo(index: number) {
		const log = this.log
		if (!Number.isInteger(index) || index < 0 || index > log.length) throw new RangeError(`No history entry ${index}`)
		if (index === log.length) return
		const target = this.target
		const { cpu, device, callStack } = target
		const stop = this.effectStartAt(index)
		const capacity = log.effects.capacity
		for (let position = log.effects.end - 1; position >= stop; position--) {
			const columns = log.effects.block(position).arrays
			const slot = position % capacity
			const a = columns[EFFECT_A][slot]
			const b = columns[EFFECT_B][slot]
			switch (columns[EFFECT_KIND][slot]) {
				case EFFECT_MEMORY: cpu.memory[a] = b; break
				case EFFECT_OUTPUT: device.output = device.output.slice(0, b); break
				case EFFECT_INPUT: device.inputIndex = b; break
				case EFFECT_HALTED: target.halted = b !== 0; break
				case EFFECT_EXIT: target.exitCode = b; break
				case EFFECT_FRAME_WORD: callStack.setFrameWord(a, b); break
				case EFFECT_FRAME_DEPTH: callStack.setDepth(b); break
				case EFFECT_CONTROL: device.control = b; break
				case EFFECT_PERIOD: device.period = b; break
				case EFFECT_TIMER_FLAG: device.timerFlag = b !== 0; break
				case EFFECT_NMI: target.nmiPending = b !== 0; break
			}
		}
		const registers = this.column(index, REGISTERS)
		cpu.a = registers & 0xFF
		cpu.x = (registers >>> 8) & 0xFF
		cpu.y = (registers >>> 16) & 0xFF
		cpu.sp = registers >>> 24
		cpu.p = this.column(index, P)
		cpu.pc = this.column(index, PC)
		cpu.cycles = this.column(index, CYCLES)
		cpu.fault = FAULT_NONE
		cpu.waiting = false
		device.timer = this.column(index, TIMER)
		device.waiting = false
		device.polled = false
		target.instructionCount = this.countAt(index)
		log.truncate(index)
	}

	/** Forgets everything; the machine is left as it is. */
	clear() {
		this.log.clear()
	}

	private push(kind: number, a: number, b: number) {
		const slot = this.log.pushEffect()
		if (slot < 0) return
		const columns = this.log.effects.tail!.arrays
		columns[EFFECT_KIND][slot] = kind
		columns[EFFECT_A][slot] = a
		columns[EFFECT_B][slot] = b
	}

	private column(index: number, column: number): number {
		if (!(index >= 0 && index < this.log.length)) throw new RangeError(`No history entry ${index}`)
		const position = this.log.first + index
		return this.log.entries.block(position).arrays[column][position % this.log.entries.capacity]
	}

	private effect(position: number, column: number): number {
		return this.log.effects.block(position).arrays[column][position % this.log.effects.capacity]
	}
}
