/**
 * The shared history engine: entries, each owning a run of effects, in typed
 * blocks laid out by an architecture's explicit schema.
 *
 * The engine knows only the base entry columns (id and effect range). A codec
 * writes its own columns into the blocks it is handed and gives them meaning.
 * Entries and effects are addressed by absolute position (`HistoryRecords`), so
 * an entry's effects may straddle blocks and nothing is copied as blocks roll.
 *
 * Policies:
 * - Entry limit: at least `limit` entries are kept. The oldest entry block goes
 *   whole once the entries after it still cover the limit, so at most one block
 *   more is held. Effect blocks go once no held entry reaches them.
 * - Byte limit: the live typed blocks of both scopes stay within `byteLimit`.
 *   Opening a block over it evicts the oldest complete entries first; payload
 *   objects are not counted, since their heap size cannot be known exactly.
 * - Oversized entry: an open entry that cannot fit even with every older entry
 *   gone empties the log rather than keep half of it. The machine is untouched;
 *   further effects of that entry are refused, and `overflows` counts it.
 * - Truncation: a divergent run truncates entries from a position, with their
 *   effects and payloads, across every declared buffer.
 */

import { ENTRY_EFFECT_START, ENTRY_ID, type HistoryBufferLayout } from './historyBuffers'
import { HistoryRecords } from './historyRecords'
import type { HistoryRetention } from '../architectures/contracts'

/** Typed bytes a log may hold unless its owner chooses otherwise. */
export const DEFAULT_HISTORY_BYTES = 256 * 1024 * 1024

export class HistoryLog {
	readonly entries: HistoryRecords
	readonly effects: HistoryRecords
	/** Entries dropped because they could not fit the byte limit on their own. */
	overflows = 0
	private entryEvictions = 0
	private byteEvictions = 0
	private lastEviction: HistoryRetention['lastEviction'] = null
	private entryLimit = Number.POSITIVE_INFINITY
	private bytes = DEFAULT_HISTORY_BYTES
	/** The open entry's position, or -1. */
	private open = -1
	private openStart = 0
	/** The entry end at which the oldest block has to go for the entry limit. */
	private evictAt = Number.POSITIVE_INFINITY

	constructor(readonly layout: HistoryBufferLayout, capacity?: number) {
		this.entries = new HistoryRecords(layout, 'entry', capacity)
		this.effects = new HistoryRecords(layout, 'effect', capacity)
	}

	/** Entries kept at least; whole blocks beyond it are dropped. */
	get limit(): number {
		return this.entryLimit
	}

	set limit(value: number) {
		if (!(value >= 1)) throw new RangeError(`Invalid history limit: ${value}`)
		this.entryLimit = value
		this.schedule()
	}

	/** Live typed-block bytes allowed across both scopes. */
	get byteLimit(): number {
		return this.bytes
	}

	set byteLimit(value: number) {
		const minimum = 2 * (this.entries.blockBytes + this.effects.blockBytes)
		if (!(value >= minimum)) throw new RangeError(`History byte limit must be at least ${minimum}`)
		this.bytes = value
	}

	get length(): number {
		return this.entries.length
	}

	/** Absolute position of entry 0. */
	get first(): number {
		return this.entries.first
	}

	/** Absolute position the next entry takes. */
	get end(): number {
		return this.entries.end
	}

	/** Position of the entry being recorded, or -1. */
	get openEntry(): number {
		return this.open
	}

	/** Where the open entry's effects begin. */
	get openEffectStart(): number {
		return this.openStart
	}

	get liveBufferBytes(): number {
		return this.entries.liveBytes + this.effects.liveBytes
	}

	/** Exact typed-array bytes, spare blocks included; payload heap is not. */
	get allocatedBufferBytes(): number {
		return this.entries.allocatedBytes + this.effects.allocatedBytes
	}

	get payloadCount(): number {
		return this.entries.payloadCount + this.effects.payloadCount
	}

	/** A cold-path snapshot for UI/benchmarks; recording allocates no status objects. */
	get retention(): HistoryRetention {
		return {
			entries: this.length, entryLimit: this.limit, byteLimit: this.byteLimit,
			liveBufferBytes: this.liveBufferBytes, allocatedBufferBytes: this.allocatedBufferBytes,
			payloadCount: this.payloadCount, entryEvictions: this.entryEvictions,
			byteEvictions: this.byteEvictions, oversizedEntries: this.overflows, lastEviction: this.lastEviction,
		}
	}

	/**
	 * Starts an entry; effects pushed until `close` are its. Returns its slot in
	 * `entries.tail`, where the codec writes its own columns.
	 */
	openEntryWith(id: number): number {
		const entries = this.entries
		if (entries.full) this.reserve(entries.blockBytes)
		const slot = entries.append()
		const arrays = entries.tail!.arrays
		const start = this.effects.end
		arrays[ENTRY_ID][slot] = id
		arrays[ENTRY_EFFECT_START][slot] = start
		this.open = entries.end - 1
		this.openStart = start
		if (entries.end >= this.evictAt) this.evict()
		return slot
	}

	/** Takes the next effect for the open entry: its slot in `effects.tail`, or -1 when none is open. */
	pushEffect(): number {
		if (this.open < 0) return -1
		if (this.effects.full) {
			this.reserve(this.effects.blockBytes)
			if (this.open < 0) return -1
		}
		return this.effects.append()
	}

	/** Ends the open entry; its run ends where the next entry's begins. */
	close() {
		this.open = -1
	}

	/** Drops the open entry, which changed nothing worth keeping. */
	discard() {
		const position = this.open
		if (position < 0) return
		this.open = -1
		this.effects.truncate(this.openStart)
		this.entries.truncate(position)
	}

	/** Forgets entry `index` and every later one, with their effects and payloads. */
	truncate(index: number) {
		const position = this.entries.first + index
		if (position >= this.entries.end) return
		if (this.open >= position) this.open = -1
		this.effects.truncate(this.effectStartAt(position))
		this.entries.truncate(position)
	}

	clear() {
		this.entryEvictions = this.byteEvictions = this.overflows = 0
		this.lastEviction = null
		this.open = -1
		this.entries.clear()
		this.effects.clear()
		this.schedule()
	}

	/** Base columns by index from the oldest held. */
	id(index: number): number {
		return this.base(index, ENTRY_ID)
	}

	effectStart(index: number): number {
		return this.base(index, ENTRY_EFFECT_START)
	}

	/** The run's length; the open entry's grows as it records. */
	effectCount(index: number): number {
		const stop = index + 1 < this.length ? this.effectStart(index + 1) : this.effects.end
		return stop - this.effectStart(index)
	}

	/** Where the entry with `id` sits, or -1; ids only increase along the log. */
	indexOfId(id: number): number {
		let low = 0
		let high = this.length - 1
		while (low <= high) {
			const middle = Math.floor((low + high) / 2)
			const found = this.id(middle)
			if (found === id) return middle
			if (found < id) low = middle + 1
			else high = middle - 1
		}
		return -1
	}

	private base(index: number, column: number): number {
		const position = this.entries.first + index
		return this.entries.block(position).arrays[column][position % this.entries.capacity]
	}

	private effectStartAt(position: number): number {
		return this.entries.block(position).arrays[ENTRY_EFFECT_START][position % this.entries.capacity]
	}

	/** Drops whole oldest blocks while the entries after them still cover the limit. */
	private evict() {
		const capacity = this.entries.capacity
		for (;;) {
			const boundary = (Math.floor(this.entries.first / capacity) + 1) * capacity
			if (this.entries.end - boundary < this.entryLimit) break
			this.entryEvictions += boundary - this.entries.first
			this.lastEviction = 'entry-limit'
			this.dropEntriesBefore(boundary)
		}
	}

	/** Makes room for one more block, evicting complete entries, else overflowing. */
	private reserve(blockBytes: number) {
		const capacity = this.entries.capacity
		while (this.liveBufferBytes + blockBytes > this.bytes) {
			const keep = this.open >= 0 ? this.open : this.entries.end
			const first = this.entries.first
			if (first >= keep) {
				this.overflow()
				return
			}
			const boundary = Math.min(keep, (Math.floor(first / capacity) + 1) * capacity)
			this.byteEvictions += boundary - first
			this.lastEviction = 'byte-limit'
			this.dropEntriesBefore(boundary)
		}
	}

	/** The open entry cannot be held whole: the log empties and refuses the rest of it. */
	private overflow() {
		this.overflows += 1
		this.lastEviction = 'oversized-entry'
		this.open = -1
		this.entries.dropBefore(this.entries.end)
		this.effects.dropBefore(this.effects.end)
		this.schedule()
	}

	private dropEntriesBefore(position: number) {
		this.entries.dropBefore(position)
		this.effects.dropBefore(this.entries.length > 0 ? this.effectStartAt(this.entries.first) : this.effects.end)
		this.schedule()
	}

	private schedule() {
		const capacity = this.entries.capacity
		this.evictAt = (Math.floor(this.entries.first / capacity) + 1) * capacity + this.entryLimit
	}
}

/**
 * What it takes to put the machine at the entry at `index`, from a cursor at
 * `from`.
 *
 * Both directions land on the same place: the cursor sits *on* the entry, whose
 * instruction is the next to run.  Landing anywhere else makes clicking one row
 * twice move the machine.
 */
export function moveToEntry(from: number, index: number): { rewind: boolean, steps: number } {
	if (index < from) return { rewind: true, steps: 0 }
	return { rewind: false, steps: index - from }
}
