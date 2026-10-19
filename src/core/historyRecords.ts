/**
 * One scope's history records (entries or effects) in fixed-size typed blocks,
 * addressed by an absolute position that never wraps or shifts.
 *
 * Block `n` holds positions `[n * capacity, (n + 1) * capacity)`, so a record is
 * found by division and nothing moves when the oldest go. Records are given up
 * from the front (`dropBefore`) or the back (`truncate`); a block leaves once no
 * held position is in it, taking its payloads with it. A position is held while
 * it lies in `[first, end)`.
 */

import { HISTORY_BLOCK_SIZE, type HistoryBuffer, type HistoryBufferBlock, type HistoryBufferLayout, type HistoryScope } from './historyBuffers'

/** Released blocks kept for reuse per scope; more go to the collector. */
const SPARE_LIMIT = 1

export interface HistoryRecordBlock {
	readonly buffers: HistoryBufferBlock
	/** Columns in declaration order; codecs index them by bound ordinal. */
	readonly arrays: readonly HistoryBuffer[]
	/** Sparse values by slot, for a scope that declares payloads; else null. */
	readonly payloads: Map<number, unknown> | null
}

export class HistoryRecords {
	readonly capacity: number
	/** Typed-array bytes of one block. */
	readonly blockBytes: number
	/** Oldest held position, and the position the next record takes. */
	first = 0
	end = 0
	/** The newest block, which `append` writes into, and its first position. */
	tail: HistoryRecordBlock | null = null
	tailBase = 0
	/** The position past the newest block. */
	private blockEnd = 0
	private blocks: HistoryRecordBlock[] = []
	private spare: HistoryRecordBlock[] = []
	/** Block number of `blocks[0]`. */
	private firstBlock = 0

	constructor(private readonly layout: HistoryBufferLayout, readonly scope: HistoryScope, capacity = HISTORY_BLOCK_SIZE) {
		if (!Number.isSafeInteger(capacity) || capacity <= 0) throw new Error('Invalid history block capacity')
		this.capacity = capacity
		this.blockBytes = capacity * layout.bytesPerRecord[scope]
	}

	get length(): number {
		return this.end - this.first
	}

	get blockCount(): number {
		return this.blocks.length
	}

	/** Bytes of the blocks holding records. */
	get liveBytes(): number {
		return this.blocks.length * this.blockBytes
	}

	/** Bytes of every block allocated, spares included. */
	get allocatedBytes(): number {
		return (this.blocks.length + this.spare.length) * this.blockBytes
	}

	get payloadCount(): number {
		let count = 0
		for (const block of this.blocks) count += block.payloads?.size ?? 0
		return count
	}

	/** Whether the next append needs a block of its own. */
	get full(): boolean {
		return this.end >= this.blockEnd
	}

	/**
	 * Takes the next position, opening a block when needed, and returns its slot
	 * in `tail`. A new block's columns read zero.
	 */
	append(): number {
		const position = this.end
		if (position >= this.blockEnd) {
			if (this.blocks.length === 0) this.firstBlock = Math.floor(position / this.capacity)
			this.blocks.push(this.take())
			this.bound()
		}
		this.end = position + 1
		return position - this.tailBase
	}

	/** The block holding a held position. */
	block(position: number): HistoryRecordBlock {
		if (!(position >= this.first && position < this.end)) throw new RangeError(`History ${this.scope} ${position} has been dropped or was never recorded`)
		return this.blocks[Math.floor(position / this.capacity) - this.firstBlock]
	}

	payload(position: number): unknown {
		return this.block(position).payloads?.get(position % this.capacity)
	}

	setPayload(position: number, value: unknown) {
		const payloads = this.block(position).payloads
		if (!payloads) throw new Error(`History ${this.scope} records declare no payload`)
		if (value === undefined) payloads.delete(position % this.capacity)
		else payloads.set(position % this.capacity, value)
	}

	/** Forgets every position below `position`. */
	dropBefore(position: number) {
		const first = Math.min(Math.max(position, this.first), this.end)
		if (first === this.first) return
		this.first = first
		while (this.blocks.length > 0 && (this.firstBlock + 1) * this.capacity <= first) {
			this.release(this.blocks.shift()!)
			this.firstBlock += 1
		}
		this.bound()
		const payloads = this.blocks[0]?.payloads
		if (payloads && payloads.size > 0) {
			const slot = first - this.firstBlock * this.capacity
			for (const key of payloads.keys()) if (key < slot) payloads.delete(key)
		}
	}

	/** Forgets `position` and everything after it. */
	truncate(position: number) {
		const end = Math.min(Math.max(position, this.first), this.end)
		if (end === this.end) return
		this.end = end
		const keep = Math.max(0, Math.ceil(end / this.capacity) - this.firstBlock)
		while (this.blocks.length > keep) this.release(this.blocks.pop()!)
		this.bound()
		const payloads = keep > 0 ? this.blocks[keep - 1].payloads : null
		if (payloads && payloads.size > 0) {
			const slot = end - (this.firstBlock + keep - 1) * this.capacity
			for (const key of payloads.keys()) if (key >= slot) payloads.delete(key)
		}
	}

	/** Forgets everything and starts positions from zero again. */
	clear() {
		for (const block of this.blocks) this.release(block)
		this.blocks = []
		this.firstBlock = 0
		this.first = 0
		this.end = 0
		this.bound()
	}

	/** Recomputes the tail after the blocks change. */
	private bound() {
		const count = this.blocks.length
		this.tail = count > 0 ? this.blocks[count - 1] : null
		this.tailBase = (this.firstBlock + count - 1) * this.capacity
		this.blockEnd = (this.firstBlock + count) * this.capacity
	}

	private take(): HistoryRecordBlock {
		const reused = this.spare.pop()
		if (reused) {
			for (const array of reused.arrays) array.fill(0)
			return reused
		}
		const buffers = this.layout.allocate(this.scope, this.capacity)
		return { buffers, arrays: buffers.arrays, payloads: this.layout.payloads[this.scope] ? new Map() : null }
	}

	private release(block: HistoryRecordBlock) {
		block.payloads?.clear()
		if (this.spare.length < SPARE_LIMIT) this.spare.push(block)
	}
}
