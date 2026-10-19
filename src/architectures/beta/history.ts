/**
 * Beta execution history: one entry per state-changing step, each owning a run
 * of effects that hold the values the step replaced.
 *
 * Entries and effects live in the shared HistoryLog, which owns the blocks,
 * eviction (a block more than the limit at most), the byte limit and
 * truncation. Effects are addressed by an absolute position, so a run may
 * straddle two blocks; an entry's id is its absolute position.
 *
 * A step that changes nothing (a repeated RDCHAR wait, a fault) records no
 * entry. Rewinding to entry `index` undoes it and everything after it, leaving
 * the machine about to run that entry's instruction again; the future is
 * dropped and re-running forward recreates it, input included.
 */

import { HistoryBufferLayout, type HistoryBufferSchema } from '../../core/historyBuffers'
import { HistoryLog } from '../../core/historyLog'
import { FAULT_NONE, SUPERVISOR, type BetaCpu, type BetaEffectSink } from './cpu'
import type { BetaCallStack, BetaCallStackSink } from './callStack'
import type { BetaConsole } from './machine'

const column = (name: string, type: 'u8' | 'i32' | 'u32' | 'f64') => Object.freeze({ name, type, elements: 1 })

/**
 * Entry: the instruction's address and word (the vector, for an interrupt),
 * its kind, and the instruction count, clock tick and keyboard wait before it.
 * Effect: a kind and two values.
 */
export const betaHistorySchema: HistoryBufferSchema = Object.freeze({
	entry: Object.freeze([
		column('pc', 'u32'), column('word', 'i32'), column('kind', 'u8'), column('count', 'f64'),
		column('tick', 'i32'), column('keyWait', 'i32'),
	]),
	effect: Object.freeze([column('kind', 'u8'), column('a', 'i32'), column('b', 'i32')]),
})

/** Effect kinds; `b` is always the old value. */
export const EFFECT_REGISTER = 0
/** `a` is the word address. */
export const EFFECT_MEMORY = 1
export const EFFECT_PC = 2
/** Console output length. */
export const EFFECT_OUTPUT = 3
/** Console input position. */
export const EFFECT_INPUT = 4
export const EFFECT_WAITING = 5
export const EFFECT_HALTED = 6
/** `a` is the index of a call-stack frame word. */
export const EFFECT_FRAME_WORD = 7
export const EFFECT_FRAME_DEPTH = 8
/** The arrived, unread keyboard character, or -1. */
export const EFFECT_KEY = 9
/** Interrupt request bits. */
export const EFFECT_PENDING = 10
export const EFFECT_SEG_BASE = 11
export const EFFECT_SEG_BOUNDS = 12

export const DEFAULT_HISTORY_LIMIT = 100_000

/** Entry kinds: a step the CPU ran, a change the user made, or an interrupt taken. */
export const ENTRY_INSTRUCTION = 0
export const ENTRY_EDIT = 1
export const ENTRY_INTERRUPT = 2

/** What the history records and restores; BetaMachine is one. */
export interface BetaHistoryTarget {
	readonly cpu: BetaCpu
	readonly console: BetaConsole | null
	readonly callStack: BetaCallStack | null
	halted: boolean
	/** Instructions retired; an entry keeps the count before it. */
	instructionCount: number
	/** Cycles into the clock period; kept per entry. */
	tick: number
}

const layout = new HistoryBufferLayout(betaHistorySchema)
// Column ordinals in each block's `arrays`.
const PC = layout.column('entry', 'pc', 'u32')
const WORD = layout.column('entry', 'word', 'i32')
const KIND = layout.column('entry', 'kind', 'u8')
const COUNT = layout.column('entry', 'count', 'f64')
const TICK = layout.column('entry', 'tick', 'i32')
const KEY_WAIT = layout.column('entry', 'keyWait', 'i32')
const EFFECT_KIND = layout.column('effect', 'kind', 'u8')
const EFFECT_A = layout.column('effect', 'a', 'i32')
const EFFECT_B = layout.column('effect', 'b', 'i32')

export class BetaHistory implements BetaEffectSink, BetaCallStackSink {
	private readonly log = new HistoryLog(layout)
	// The open entry's starting state.
	private start = 0
	private pcBefore = 0
	private outputLength = 0
	private inputIndex = 0
	private waiting = false
	private halted = false
	private key = -1
	private pending = 0
	private segBase = 0
	private segBounds = 0
	private tick = 0
	private keyWait = 0
	private kind = ENTRY_INSTRUCTION
	/** The interrupt vector an ENTRY_INTERRUPT records as its word. */
	private vector = 0
	private instructionCount = 0

	constructor(private readonly target: BetaHistoryTarget, limit = DEFAULT_HISTORY_LIMIT) {
		this.log.limit = limit
	}

	/** Entries held at least; up to one block more are kept. */
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

	/** Absolute position the next effect will take. */
	get effectPosition(): number {
		return this.log.effects.end
	}

	get allocatedBufferBytes(): number {
		return this.log.allocatedBufferBytes
	}

	/** Opens an entry; call before the CPU steps, or before an edit with ENTRY_EDIT. */
	begin(kind = ENTRY_INSTRUCTION) {
		const { cpu, console } = this.target
		this.kind = kind
		this.instructionCount = this.target.instructionCount
		this.tick = this.target.tick
		this.log.openEntryWith(this.log.end)
		this.start = this.log.openEffectStart
		// Where the instruction is in memory, through the MMU.
		this.pcBefore = ((cpu.pc & SUPERVISOR) | cpu.fetchAddress()) >>> 0
		this.segBase = cpu.segBase
		this.segBounds = cpu.segBounds
		this.outputLength = console ? console.output.length : 0
		this.inputIndex = console ? console.inputIndex : 0
		this.waiting = console ? console.waiting : false
		this.key = console ? console.key : -1
		this.pending = console ? console.pending : 0
		this.keyWait = console ? console.keyWait : 0
		this.halted = this.target.halted
	}

	/** Marks the open entry as taking the interrupt at `vector`. */
	interrupted(vector: number) {
		this.kind = ENTRY_INTERRUPT
		this.vector = vector
	}

	/** Closes the entry; returns whether the step changed anything and so was kept. */
	end(): boolean {
		const { cpu, console } = this.target
		if (console) {
			if (console.output.length !== this.outputLength) this.push(EFFECT_OUTPUT, 0, this.outputLength)
			if (console.inputIndex !== this.inputIndex) this.push(EFFECT_INPUT, 0, this.inputIndex)
			if (console.waiting !== this.waiting) this.push(EFFECT_WAITING, 0, this.waiting ? 1 : 0)
			if (console.key !== this.key) this.push(EFFECT_KEY, 0, this.key)
			if (console.pending !== this.pending) this.push(EFFECT_PENDING, 0, this.pending)
		}
		if (cpu.segBase !== this.segBase) this.push(EFFECT_SEG_BASE, 0, this.segBase)
		if (cpu.segBounds !== this.segBounds) this.push(EFFECT_SEG_BOUNDS, 0, this.segBounds | 0)
		if (this.target.halted !== this.halted) this.push(EFFECT_HALTED, 0, this.halted ? 1 : 0)
		const log = this.log
		const position = log.openEntry
		// None open: the entry outgrew the byte limit and the log let it go.
		if (position < 0) return false
		if (log.effects.end === this.start) {
			log.discard()
			return false
		}
		const columns = log.entries.block(position).arrays
		const slot = position % log.entries.capacity
		columns[PC][slot] = this.pcBefore
		columns[WORD][slot] = this.kind === ENTRY_INTERRUPT ? this.vector : cpu.instruction
		columns[KIND][slot] = this.kind
		columns[COUNT][slot] = this.instructionCount
		columns[TICK][slot] = this.tick
		columns[KEY_WAIT][slot] = this.keyWait
		log.close()
		return true
	}

	register(index: number, old: number) {
		this.push(EFFECT_REGISTER, index, old)
	}

	memory(address: number, oldWord: number) {
		this.push(EFFECT_MEMORY, address, oldWord)
	}

	pc(old: number) {
		this.push(EFFECT_PC, 0, old)
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

	wordAt(index: number): number {
		return this.column(index, WORD)
	}

	effectStartAt(index: number): number {
		return this.log.effectStart(index)
	}

	kindAt(index: number): number {
		return this.column(index, KIND)
	}

	/** Instructions retired before entry `index`. */
	countAt(index: number): number {
		return this.column(index, COUNT)
	}

	/** Runs are contiguous: an entry's effects end where the next entry's begin. */
	effectCountAt(index: number): number {
		return this.log.effectCount(index)
	}

	/** Effect columns by absolute position, for views. */
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
		const { cpu, console, callStack } = this.target
		const stop = this.effectStartAt(index)
		const count = this.countAt(index)
		const capacity = log.effects.capacity
		for (let position = log.effects.end - 1; position >= stop; position--) {
			const columns = log.effects.block(position).arrays
			const slot = position % capacity
			const a = columns[EFFECT_A][slot]
			const b = columns[EFFECT_B][slot]
			switch (columns[EFFECT_KIND][slot]) {
				case EFFECT_REGISTER: cpu.setRegister(a, b); break
				case EFFECT_MEMORY: cpu.writeWord(a, b); break
				case EFFECT_PC: cpu.pc = b >>> 0; break
				case EFFECT_OUTPUT: console!.output = console!.output.slice(0, b); break
				case EFFECT_INPUT: console!.inputIndex = b; break
				case EFFECT_WAITING: console!.waiting = b !== 0; break
				case EFFECT_HALTED: this.target.halted = b !== 0; break
				case EFFECT_FRAME_WORD: callStack!.setFrameWord(a, b); break
				case EFFECT_FRAME_DEPTH: callStack!.setDepth(b); break
				case EFFECT_KEY: console!.key = b; break
				case EFFECT_PENDING: console!.pending = b; break
				case EFFECT_SEG_BASE: cpu.segBase = b; break
				case EFFECT_SEG_BOUNDS: cpu.segBounds = b >>> 0; break
			}
		}
		cpu.fault = FAULT_NONE
		cpu.faultAddress = 0
		this.target.tick = this.column(index, TICK)
		if (console) console.keyWait = this.column(index, KEY_WAIT)
		this.target.instructionCount = count
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
