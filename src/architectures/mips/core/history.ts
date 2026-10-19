/**
 * The MIPS execution history: one entry per instruction or edit, held in the
 * shared log's typed columns as `mipsHistorySchema` declares them.
 *
 * Entries keep the control state they exchange (pc, delay state and target) and,
 * only for the rare instruction that needs one, a payload with copies of the
 * file table and random streams. `at` decodes an entry into an object for the
 * panels; recording and stepping read and write the columns directly.
 */

import { HistoryBufferLayout, type HistoryBufferSchema } from '../../../core/historyBuffers'
import { HistoryLog } from '../../../core/historyLog'
import type { HistoryRecords } from '../../../core/historyRecords'
import type { DelayState, FilesSnapshot, HistoryEntry, RandomSnapshot } from '../../../core/types'
import type { MachineHistory } from '../../contracts'
import { DELAY_STATES, EffectStore } from './effectStore'

/** Entry flags: an edit rather than an instruction. */
const FLAG_EDIT = 1
/** The entry has a word; an edit or a fetch fault has none. */
const FLAG_WORD = 2
/**
 * The pc or delayed target was held unsigned. Both are 32-bit but may be held
 * either way, and the exchange must hand back exactly what it took.
 */
const FLAG_PC_UNSIGNED = 4
const FLAG_TARGET_UNSIGNED = 8
/** Bits 4-5: the delay state's index in `DELAY_STATES`. */
const DELAY_SHIFT = 4
const KIND_FLAGS = FLAG_EDIT | FLAG_WORD

/** The flags that say how control state was held. */
function controlFlags(pc: number, delayState: DelayState, delayedTarget: number): number {
	const delay = delayState === 'none' ? 0 : delayState === 'registered' ? 1 : 2
	return (pc > 0x7fffffff ? FLAG_PC_UNSIGNED : 0) | (delayedTarget > 0x7fffffff ? FLAG_TARGET_UNSIGNED : 0) | (delay << DELAY_SHIFT)
}

/** What an entry copies of the subsystems that do not invert from effects. */
export interface SubsystemCopies {
	files?: FilesSnapshot
	random?: RandomSnapshot
}

export class MipsHistory implements MachineHistory {
	readonly log: HistoryLog
	readonly effects: EffectStore
	private readonly entries: HistoryRecords
	private readonly capacity: number
	// Column ordinals, bound once.
	private readonly address: number
	private readonly word: number
	private readonly count: number
	private readonly pc: number
	private readonly target: number
	private readonly flags: number

	constructor(schema: HistoryBufferSchema) {
		const layout = new HistoryBufferLayout(schema)
		this.log = new HistoryLog(layout)
		this.effects = new EffectStore(this.log)
		this.entries = this.log.entries
		this.capacity = this.entries.capacity
		this.address = layout.column('entry', 'address', 'u32')
		this.word = layout.column('entry', 'word', 'i32')
		this.count = layout.column('entry', 'instructionCount', 'f64')
		this.pc = layout.column('entry', 'pc', 'i32')
		this.target = layout.column('entry', 'delayedTarget', 'i32')
		this.flags = layout.column('entry', 'flags', 'u8')
		if (!layout.payloads.entry) throw new Error('History codec requires entry payloads')
	}

	get length(): number {
		return this.entries.end - this.entries.first
	}

	/** Absolute position of entry 0, and of the next entry. */
	get first(): number {
		return this.entries.first
	}

	get end(): number {
		return this.entries.end
	}

	get recording(): boolean {
		return this.log.openEntry >= 0
	}

	/** Entries kept at least; the backstep limit. */
	get limit(): number {
		return this.log.limit
	}

	set limit(value: number) {
		this.log.limit = Math.max(1, value)
	}

	/** Entry blocks held, which is what the log costs beyond the effects. */
	get blockCount(): number {
		return this.entries.blockCount
	}

	get allocatedBufferBytes(): number {
		return this.log.allocatedBufferBytes
	}

	get payloadCount(): number {
		return this.log.payloadCount
	}

	/** Starts recording an entry; effects pushed until `close` belong to it. */
	open(id: number, instructionCount: number, address: number, word: number | null, edit: boolean, pc: number, delayState: DelayState, delayedTarget: number) {
		const slot = this.log.openEntryWith(id)
		const columns = this.entries.tail!.arrays
		columns[this.address][slot] = address
		columns[this.word][slot] = word ?? 0
		columns[this.count][slot] = instructionCount
		columns[this.pc][slot] = pc
		columns[this.target][slot] = delayedTarget
		columns[this.flags][slot] = (edit ? FLAG_EDIT : 0) | (word === null ? 0 : FLAG_WORD) | controlFlags(pc, delayState, delayedTarget)
	}

	close() {
		this.log.close()
	}

	/** Forgets entry `index` and every later one. */
	truncate(index: number) {
		this.log.truncate(index)
	}

	clear() {
		this.log.clear()
	}

	id(index: number): number {
		return this.log.id(index)
	}

	effectStartAt(index: number): number {
		return this.log.effectStart(index)
	}

	effectCountAt(index: number): number {
		return this.log.effectCount(index)
	}

	instructionCountAt(index: number): number {
		return this.column(index, this.count)
	}

	isEdit(index: number): boolean {
		return (this.column(index, this.flags) & FLAG_EDIT) !== 0
	}

	pcAt(index: number): number {
		const value = this.column(index, this.pc)
		return (this.column(index, this.flags) & FLAG_PC_UNSIGNED) !== 0 ? value >>> 0 : value
	}

	delayStateAt(index: number): DelayState {
		return DELAY_STATES[this.column(index, this.flags) >> DELAY_SHIFT]
	}

	delayedTargetAt(index: number): number {
		const value = this.column(index, this.target)
		return (this.column(index, this.flags) & FLAG_TARGET_UNSIGNED) !== 0 ? value >>> 0 : value
	}

	/** Puts control state in the entry, for the exchange a step makes. */
	setControl(index: number, pc: number, delayState: DelayState, delayedTarget: number) {
		const position = this.entries.first + index
		const columns = this.entries.block(position).arrays
		const slot = position % this.capacity
		columns[this.pc][slot] = pc
		columns[this.target][slot] = delayedTarget
		columns[this.flags][slot] = (columns[this.flags][slot] & KIND_FLAGS) | controlFlags(pc, delayState, delayedTarget)
	}

	/** The entry's subsystem copies, if it took any. */
	subsystemsAt(index: number): SubsystemCopies | undefined {
		return this.entries.payload(this.entries.first + index) as SubsystemCopies | undefined
	}

	/** The open entry's copies, created on first use; null when nothing is recording. */
	openSubsystems(): SubsystemCopies | null {
		const position = this.log.openEntry
		if (position < 0) return null
		let held = this.entries.payload(position) as SubsystemCopies | undefined
		if (!held) this.entries.setPayload(position, held = {})
		return held
	}

	at(index: number): HistoryEntry | undefined {
		if (!(index >= 0 && index < this.length)) return undefined
		const position = this.entries.first + index
		const columns = this.entries.block(position).arrays
		const slot = position % this.capacity
		const flags = columns[this.flags][slot]
		const entry: HistoryEntry = {
			id: this.log.id(index),
			instructionCount: columns[this.count][slot],
			address: columns[this.address][slot],
			word: (flags & FLAG_WORD) !== 0 ? columns[this.word][slot] : null,
			kind: (flags & FLAG_EDIT) !== 0 ? 'edit' : 'instruction',
			pc: this.pcAt(index),
			delayState: DELAY_STATES[flags >> DELAY_SHIFT],
			delayedTarget: this.delayedTargetAt(index),
			effectStart: this.log.effectStart(index),
			effectCount: this.log.effectCount(index),
		}
		const copies = this.subsystemsAt(index)
		if (copies?.files) entry.files = copies.files
		if (copies?.random) entry.random = copies.random
		return entry
	}

	/** A window of entries, which is what a virtualized panel draws. */
	slice(from: number, to: number): HistoryEntry[] {
		const window: HistoryEntry[] = []
		for (let index = Math.max(0, from); index < Math.min(this.length, to); index++) window.push(this.at(index)!)
		return window
	}

	indexOfId(id: number): number {
		return this.log.indexOfId(id)
	}

	*[Symbol.iterator](): Iterator<HistoryEntry> {
		for (let index = 0; index < this.length; index++) yield this.at(index)!
	}

	private column(index: number, column: number): number {
		const position = this.entries.first + index
		return this.entries.block(position).arrays[column][position % this.capacity]
	}
}
