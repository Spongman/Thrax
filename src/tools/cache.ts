/**
 * Data cache simulator.
 *
 * It models placement and replacement only: there is no backing store here,
 * because the point is the hit rate, not the data.  Instruction fetches are not
 * counted: only the data segment is observed.
 */

import type { ExecutionObserver, MachineConfig } from '../core/observer'
import { Replay, type Replayable } from './replay'
import { StepLog } from './stepLog'

export type ReplacementPolicy = 'lru' | 'random' | 'fifo'

export interface CacheSettings {
	/** Total blocks in the cache. */
	blockCount: number
	/** Bytes per block. */
	blockSizeBytes: number
	/**
	 * Blocks per set.  1 is direct-mapped and `blockCount` is fully associative;
	 * anything between is set-associative.
	 */
	associativity: number
	replacement: ReplacementPolicy
}

export const DEFAULT_CACHE_SETTINGS: CacheSettings = {
	blockCount: 8,
	blockSizeBytes: 16,
	associativity: 1,
	replacement: 'lru',
}

/**
 * The cache these settings describe: associativity cannot exceed the cache, so
 * asking for more than the block count is a fully associative cache.  Callers
 * that show the settings use this, so the panel cannot disagree with the cache.
 */
export function effectiveCacheSettings(settings: CacheSettings): CacheSettings {
	return { ...settings, associativity: Math.max(1, Math.min(settings.associativity, settings.blockCount)) }
}

interface CacheBlock {
	tag: number
	valid: boolean
	/** Access counter for LRU, or fill counter for FIFO. */
	order: number
}

export interface CacheSnapshot {
	settings: CacheSettings
	accesses: number
	hits: number
	misses: number
	hitRate: number
	/** Which blocks hold data, in set order, for the tool's block display. */
	blocks: Array<{ valid: boolean; tag: number }>
}

export class CacheSimulator implements ExecutionObserver, Replayable {
	private settings: CacheSettings
	private blocks: CacheBlock[] = []
	private accesses = 0
	private hits = 0
	private clock = 0
	private setCount = 1
	/**
	 * The addresses reached, in order.  A load's address is worked out from
	 * registers as it runs, so the machine's log of what ran does not say where
	 * it went: this is the note that lets the run be played through the cache
	 * again instead of a copy of every block being kept for every access.
	 */
	private readonly reached = new StepLog<number>()
	private readonly replay = new Replay(this)
	/**
	 * Picks the way to evict under the random policy.  A generator of its own,
	 * restarted whenever the blocks are, so a replayed run evicts what the run
	 * evicted the first time; Math.random would put different data in the
	 * blocks every time the machine stepped back.
	 */
	private seed = 1

	onInstruction(_address: number, _decoded: unknown, instructionCount = 0) {
		this.replay.watch(instructionCount)
		// Running on from a step back leaves a future that did not happen, and
		// the machine's history drops the oldest instructions as it fills.
		this.reached.dropFrom(instructionCount)
		const oldest = this.replay.oldest
		if (oldest !== undefined) this.reached.dropBefore(oldest)
	}

	onSeek(to: number) {
		this.replay.seek(to)
	}

	onConfigure(machine: MachineConfig) {
		this.replay.configure(machine)
	}

	replayStep(_address: number, _decoded: unknown, instructionCount: number) {
		for (let index = this.reached.indexFrom(instructionCount); this.reached.countAt(index) === instructionCount; index++) {
			this.touch(this.reached.valueAt(index)!)
		}
	}

	constructor(settings: CacheSettings = DEFAULT_CACHE_SETTINGS) {
		this.settings = settings
		this.configure(settings)
	}

	configure(settings: CacheSettings) {
		this.settings = effectiveCacheSettings(settings)
		this.setCount = Math.max(1, Math.floor(settings.blockCount / this.settings.associativity))
		// A different cache over the same accesses, so it is filled again rather
		// than emptied.
		this.replay.rework()
	}

	/** Everything worked out from the accesses, which a replay redoes. */
	clear() {
		this.blocks = Array.from({ length: this.setCount * this.settings.associativity }, () => ({ tag: 0, valid: false, order: 0 }))
		this.accesses = 0
		this.hits = 0
		this.clock = 0
		this.seed = 1
	}

	reset() {
		this.clear()
		this.reached.clear()
		this.replay.reset()
	}

	onReset() {
		this.reset()
	}

	onMemoryRead(address: number) {
		this.access(address)
	}

	onMemoryWrite(address: number) {
		this.access(address)
	}

	/** One access, counted as a hit or a miss and placed in its set. */
	access(address: number) {
		this.reached.record(this.replay.at - 1, address)
		this.touch(address)
	}

	/** One access through the cache, live or replayed. */
	private touch(address: number) {
		const { blockSizeBytes, associativity, replacement } = this.settings
		const blockNumber = Math.floor((address >>> 0) / blockSizeBytes)
		const setIndex = blockNumber % this.setCount
		const tag = Math.floor(blockNumber / this.setCount)
		const first = setIndex * associativity

		this.accesses += 1
		this.clock += 1

		for (let way = 0; way < associativity; way++) {
			const block = this.blocks[first + way]
			if (block.valid && block.tag === tag) {
				this.hits += 1
				// FIFO keeps the fill order, so only LRU restamps on a hit.
				if (replacement === 'lru') block.order = this.clock
				return
			}
		}

		this.blocks[first + this.victim(first, associativity, replacement)] = { tag, valid: true, order: this.clock }
	}

	/** The way to evict, by the configured policy; an invalid way wins first. */
	private victim(first: number, associativity: number, replacement: ReplacementPolicy): number {
		for (let way = 0; way < associativity; way++) {
			if (!this.blocks[first + way].valid) return way
		}
		if (replacement === 'random') {
			// xorshift, so the same run picks the same ways however often it is
			// played through.
			this.seed ^= this.seed << 13
			this.seed ^= this.seed >>> 17
			this.seed ^= this.seed << 5
			return (this.seed >>> 0) % associativity
		}

		let oldest = 0
		for (let way = 1; way < associativity; way++) {
			if (this.blocks[first + way].order < this.blocks[first + oldest].order) oldest = way
		}
		return oldest
	}

	snapshot(): CacheSnapshot {
		this.replay.settle()
		const misses = this.accesses - this.hits
		return {
			settings: this.settings,
			accesses: this.accesses,
			hits: this.hits,
			misses,
			hitRate: this.accesses === 0 ? 0 : this.hits / this.accesses,
			blocks: this.blocks.map((block) => ({ valid: block.valid, tag: block.tag })),
		}
	}
}
