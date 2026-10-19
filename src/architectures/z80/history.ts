/**
 * Z80 execution history: one entry per state-changing step, each owning a run
 * of effects that hold the values the step replaced.
 *
 * The CPU state is compared slot by slot before and after a step, as are the
 * machine's small fields; memory writes and call-stack changes report their
 * old values as they happen. Entries and effects live in the shared
 * HistoryLog. Rewinding to entry `index` undoes it and everything after it.
 */

import { HistoryBufferLayout, type HistoryBufferSchema } from '../../core/historyBuffers'
import { HistoryLog } from '../../core/historyLog'
import { SLOT_COUNT, type Z80MemorySink } from './cpu'
import type { Z80CallStackSink } from './callStack'
import { FIELD_COUNT, type Z80Machine } from './machine'

const column = (name: string, type: 'u8' | 'i32' | 'u32' | 'f64') => Object.freeze({ name, type, elements: 1 })

/**
 * Entry: the PC and the four bytes there (the bus data, for an interrupt), its
 * kind, and the instruction count, T-states and device deadlines before it.
 * Effect: a kind and two values.
 */
export const z80HistorySchema: HistoryBufferSchema = Object.freeze({
	entry: Object.freeze([
		column('pc', 'u32'), column('bytes', 'u32'), column('kind', 'u8'), column('count', 'f64'),
		column('cycles', 'f64'), column('timerDue', 'f64'), column('keyDue', 'f64'),
	]),
	effect: Object.freeze([column('kind', 'u8'), column('a', 'i32'), column('b', 'i32')]),
})

/** Effect kinds; `b` is always the old value. */
export const EFFECT_SLOT = 0
/** `a` is the address. */
export const EFFECT_MEMORY = 1
/** `a` is a FIELD_* of the machine. */
export const EFFECT_FIELD = 2
/** Console output length. */
export const EFFECT_OUTPUT = 3
/** `a` is the index of a call-stack frame number. */
export const EFFECT_FRAME_WORD = 4
export const EFFECT_FRAME_DEPTH = 5

export const ENTRY_INSTRUCTION = 0
export const ENTRY_EDIT = 1
export const ENTRY_INTERRUPT = 2

/** The bus data an NMI records, which no byte can be. */
export const NMI_DATA = 0x100

const layout = new HistoryBufferLayout(z80HistorySchema)
const PC = layout.column('entry', 'pc', 'u32')
const BYTES = layout.column('entry', 'bytes', 'u32')
const KIND = layout.column('entry', 'kind', 'u8')
const COUNT = layout.column('entry', 'count', 'f64')
const CYCLES = layout.column('entry', 'cycles', 'f64')
const TIMER_DUE = layout.column('entry', 'timerDue', 'f64')
const KEY_DUE = layout.column('entry', 'keyDue', 'f64')
const EFFECT_KIND = layout.column('effect', 'kind', 'u8')
const EFFECT_A = layout.column('effect', 'a', 'i32')
const EFFECT_B = layout.column('effect', 'b', 'i32')

export const DEFAULT_HISTORY_LIMIT = 100_000

export class Z80History implements Z80MemorySink, Z80CallStackSink {
	private readonly log = new HistoryLog(layout)
	private readonly slots = new Int32Array(SLOT_COUNT)
	private readonly fields = new Int32Array(FIELD_COUNT)
	private start = 0
	private pc = 0
	private bytes = 0
	private kind = ENTRY_INSTRUCTION
	private data = 0
	private count = 0
	private cycles = 0
	private timerDue = 0
	private keyDue = 0
	private outputLength = 0

	constructor(private readonly target: Z80Machine, limit = DEFAULT_HISTORY_LIMIT) {
		this.log.limit = limit
	}

	get length(): number {
		return this.log.length
	}

	/** Id of the oldest entry held; ids count entries since the program loaded. */
	get firstId(): number {
		return this.log.first
	}

	/** Opens an entry; call before a step. */
	begin(kind = ENTRY_INSTRUCTION) {
		const { cpu, console } = this.target
		this.kind = kind
		this.log.openEntryWith(this.log.end)
		this.start = this.log.openEffectStart
		cpu.snapshot(this.slots)
		for (let field = 0; field < FIELD_COUNT; field++) this.fields[field] = this.target.field(field)
		const memory = cpu.memory
		const pc = cpu.pc
		this.pc = pc
		this.bytes = (memory[pc] | (memory[(pc + 1) & 0xFFFF] << 8) | (memory[(pc + 2) & 0xFFFF] << 16) | (memory[(pc + 3) & 0xFFFF] << 24)) >>> 0
		this.count = this.target.instructionCount
		this.cycles = cpu.cycles
		this.timerDue = console.timerDue
		this.keyDue = console.keyDue
		this.outputLength = console.output.length
	}

	/** Opens an entry for a change the user makes. */
	beginEdit() {
		this.begin(ENTRY_EDIT)
	}

	/** Marks the open entry as an interrupt with `data` on the bus, or -1 for NMI. */
	interrupted(data: number) {
		this.kind = ENTRY_INTERRUPT
		this.data = data < 0 ? NMI_DATA : data
	}

	/** Closes the entry; returns whether the step changed anything and so was kept. */
	end(): boolean {
		const { cpu, console } = this.target
		for (let slot = 0; slot < SLOT_COUNT; slot++) {
			const old = this.slots[slot]
			if (cpu.slot(slot) !== old) this.push(EFFECT_SLOT, slot, old)
		}
		for (let field = 0; field < FIELD_COUNT; field++) {
			const old = this.fields[field]
			if (this.target.field(field) !== old) this.push(EFFECT_FIELD, field, old)
		}
		if (console.output.length !== this.outputLength) this.push(EFFECT_OUTPUT, 0, this.outputLength)
		const log = this.log
		const position = log.openEntry
		if (position < 0) return false
		// T-states move on every step that runs anything, so only they changing is still a change.
		if (log.effects.end === this.start && cpu.cycles === this.cycles && console.timerDue === this.timerDue && console.keyDue === this.keyDue) {
			log.discard()
			return false
		}
		const columns = log.entries.block(position).arrays
		const slot = position % log.entries.capacity
		columns[PC][slot] = this.pc
		columns[BYTES][slot] = this.kind === ENTRY_INTERRUPT ? this.data : this.bytes
		columns[KIND][slot] = this.kind
		columns[COUNT][slot] = this.count
		columns[CYCLES][slot] = this.cycles
		columns[TIMER_DUE][slot] = this.timerDue
		columns[KEY_DUE][slot] = this.keyDue
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

	bytesAt(index: number): number {
		return this.column(index, BYTES)
	}

	kindAt(index: number): number {
		return this.column(index, KIND)
	}

	countAt(index: number): number {
		return this.column(index, COUNT)
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
		const { cpu, console, callStack } = target
		const stop = this.effectStartAt(index)
		const capacity = log.effects.capacity
		for (let position = log.effects.end - 1; position >= stop; position--) {
			const columns = log.effects.block(position).arrays
			const slot = position % capacity
			const a = columns[EFFECT_A][slot]
			const b = columns[EFFECT_B][slot]
			switch (columns[EFFECT_KIND][slot]) {
				case EFFECT_SLOT: cpu.setSlot(a, b); break
				case EFFECT_MEMORY: cpu.memory[a] = b; break
				case EFFECT_FIELD: target.setField(a, b); break
				case EFFECT_OUTPUT: console.output = console.output.slice(0, b); break
				case EFFECT_FRAME_WORD: callStack.setFrameWord(a, b); break
				case EFFECT_FRAME_DEPTH: callStack.setDepth(b); break
			}
		}
		cpu.cycles = this.column(index, CYCLES)
		console.timerDue = this.column(index, TIMER_DUE)
		console.keyDue = this.column(index, KEY_DUE)
		target.instructionCount = this.countAt(index)
		log.truncate(index)
	}

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
