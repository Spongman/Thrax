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
import { ReversibleHistory } from '../../core/reversibleHistory'
import { HistoryText } from '../../core/historyCursor'
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
		column('pc', 'u32'), column('opcode', 'i32'), column('kind', 'u8'), column('count', 'f64'), column('controlCount', 'f64'), column('cycles', 'f64'),
		column('registers', 'u32'), column('p', 'u8'), column('timer', 'i32'),
		column('controlPc', 'u32'), column('controlRegisters', 'u32'), column('controlP', 'u8'),
	]),
	effect: Object.freeze([column('kind', 'u8'), column('a', 'i32'), column('b', 'i32')]),
})

/** Effect kinds; `b` holds the value exchanged with live state when navigating. `a` is the address. */
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
export const EFFECT_SLEEPING = 11
export const EFFECT_STOPPED = 12

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
const CONTROL_COUNT = layout.column('entry', 'controlCount', 'f64')
const CYCLES = layout.column('entry', 'cycles', 'f64')
const REGISTERS = layout.column('entry', 'registers', 'u32')
const P = layout.column('entry', 'p', 'u8')
const TIMER = layout.column('entry', 'timer', 'i32')
const CONTROL_PC = layout.column('entry', 'controlPc', 'u32')
const CONTROL_REGISTERS = layout.column('entry', 'controlRegisters', 'u32')
const CONTROL_P = layout.column('entry', 'controlP', 'u8')
const EFFECT_KIND = layout.column('effect', 'kind', 'u8')
const EFFECT_A = layout.column('effect', 'a', 'i32')
const EFFECT_B = layout.column('effect', 'b', 'i32')

const packRegisters = (cpu: Mos6502Cpu) => (cpu.a | (cpu.x << 8) | (cpu.y << 16) | (cpu.sp << 24)) >>> 0

export class Mos6502History extends ReversibleHistory implements Mos6502EffectSink, Mos6502CallStackSink {
	readonly outputText = new HistoryText()
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
	private sleeping = false
	private stopped = false

	constructor(private readonly target: Mos6502HistoryTarget, limit = DEFAULT_HISTORY_LIMIT) {
		super(layout, limit)
	}

	get limit(): number {
		return this.log.limit
	}

	set limit(value: number) {
		this.log.limit = value
	}

	/** Opens an entry; call before the CPU steps, or before an edit with ENTRY_EDIT. */
	begin(kind = ENTRY_INSTRUCTION) {
		this.timeline.branch()
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
		this.sleeping = cpu.sleeping
		this.stopped = cpu.stopped
	}

	/** Marks the open entry as taking the interrupt through `vector`. */
	interrupted(vector: number) {
		this.kind = ENTRY_INTERRUPT
		this.vector = vector
	}

	/** Closes the entry; returns whether the step changed anything and so was kept. */
	end(): boolean {
		const { cpu, device } = this.target
		if (device.output.length !== this.outputLength) this.push(EFFECT_OUTPUT, device.output.length, this.outputLength)
		if (device.inputIndex !== this.inputIndex) this.push(EFFECT_INPUT, 0, this.inputIndex)
		if (device.control !== this.control) this.push(EFFECT_CONTROL, 0, this.control)
		if (device.period !== this.period) this.push(EFFECT_PERIOD, 0, this.period)
		if (device.timerFlag !== this.timerFlag) this.push(EFFECT_TIMER_FLAG, 0, this.timerFlag ? 1 : 0)
		if (this.target.nmiPending !== this.nmi) this.push(EFFECT_NMI, 0, this.nmi ? 1 : 0)
		if (this.target.exitCode !== this.exitCode) this.push(EFFECT_EXIT, 0, this.exitCode)
		if (this.target.halted !== this.halted) this.push(EFFECT_HALTED, 0, this.halted ? 1 : 0)
		if (cpu.sleeping !== this.sleeping) this.push(EFFECT_SLEEPING, 0, Number(this.sleeping))
		if (cpu.stopped !== this.stopped) this.push(EFFECT_STOPPED, 0, Number(this.stopped))
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
		columns[CONTROL_COUNT][slot] = this.countBefore
		columns[CYCLES][slot] = this.cyclesBefore
		columns[REGISTERS][slot] = this.registersBefore
		columns[P][slot] = this.pBefore
		columns[TIMER][slot] = this.timerBefore
		columns[CONTROL_PC][slot] = this.pcBefore
		columns[CONTROL_REGISTERS][slot] = this.registersBefore
		columns[CONTROL_P][slot] = this.pBefore
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
	controlRegistersAt(index: number): number { return this.column(index, CONTROL_REGISTERS) }
	controlPAt(index: number): number { return this.column(index, CONTROL_P) }

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
	protected exchange = (index: number, forward: boolean) => {
		const log = this.log
		const { cpu, device, callStack } = this.target
		const start = log.effectStart(index), count = log.effectCount(index)
		for (let offset = 0; offset < count; offset++) {
			const position = start + (forward ? offset : count - offset - 1)
			const columns = log.effects.block(position).arrays, slot = position % log.effects.capacity
			const a = columns[EFFECT_A][slot], b = columns[EFFECT_B][slot]
			switch (columns[EFFECT_KIND][slot]) {
				case EFFECT_MEMORY: columns[EFFECT_B][slot] = cpu.memory[a]; cpu.memory[a] = b; break
				case EFFECT_OUTPUT: columns[EFFECT_B][slot] = device.output.length; columns[EFFECT_A][slot] = b; device.output = this.outputText.exchange(device.output, b); break
				case EFFECT_INPUT: columns[EFFECT_B][slot] = device.inputIndex; device.inputIndex = b; break
				case EFFECT_HALTED: columns[EFFECT_B][slot] = +this.target.halted; this.target.halted = b !== 0; break
				case EFFECT_EXIT: columns[EFFECT_B][slot] = this.target.exitCode; this.target.exitCode = b; break
				case EFFECT_FRAME_WORD: columns[EFFECT_B][slot] = callStack.frameWordAt(a); callStack.setFrameWord(a, b); break
				case EFFECT_FRAME_DEPTH: columns[EFFECT_B][slot] = callStack.depth; callStack.setDepth(b); break
				case EFFECT_CONTROL: columns[EFFECT_B][slot] = device.control; device.control = b; break
				case EFFECT_PERIOD: columns[EFFECT_B][slot] = device.period; device.period = b; break
				case EFFECT_TIMER_FLAG: columns[EFFECT_B][slot] = +device.timerFlag; device.timerFlag = b !== 0; break
				case EFFECT_NMI: columns[EFFECT_B][slot] = +this.target.nmiPending; this.target.nmiPending = b !== 0; break
				case EFFECT_SLEEPING: columns[EFFECT_B][slot] = +cpu.sleeping; cpu.sleeping = b !== 0; break
				case EFFECT_STOPPED: columns[EFFECT_B][slot] = +cpu.stopped; cpu.stopped = b !== 0; break
			}
		}
		const entrySlot = (log.first + index) % log.entries.capacity
		const entries = log.entries.block(log.first + index).arrays
		{ const held = cpu.cycles; cpu.cycles = this.column(index, CYCLES); entries[CYCLES][entrySlot] = held }
		{ const held = device.timer; device.timer = this.column(index, TIMER); entries[TIMER][entrySlot] = held }
		const registers = entries[CONTROL_REGISTERS][entrySlot], oldRegisters = packRegisters(cpu)
		cpu.a = registers & 255; cpu.x = (registers >>> 8) & 255; cpu.y = (registers >>> 16) & 255; cpu.sp = registers >>> 24
		entries[CONTROL_REGISTERS][entrySlot] = oldRegisters
		{ const held = cpu.pc; cpu.pc = entries[CONTROL_PC][entrySlot]; entries[CONTROL_PC][entrySlot] = held }
		{ const held = cpu.p; cpu.p = entries[CONTROL_P][entrySlot]; entries[CONTROL_P][entrySlot] = held }
		cpu.fault = FAULT_NONE
		cpu.waiting = device.waiting = device.polled = false
		{ const held = this.target.instructionCount; this.target.instructionCount = entries[CONTROL_COUNT][entrySlot]; entries[CONTROL_COUNT][entrySlot] = held }
	}

	private push(kind: number, a: number, b: number) {
		const slot = this.log.pushEffect()
		if (slot < 0) return
		const columns = this.log.effects.tail!.arrays
		columns[EFFECT_KIND][slot] = kind
		columns[EFFECT_A][slot] = a
		columns[EFFECT_B][slot] = b
	}

}
