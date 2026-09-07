/**
 * Where the history's effects live.
 *
 * An effect is three small numbers and, for a few kinds, one value that is not
 * a number. Held as an object each, that costs about 56 bytes plus a slot in an
 * array of its own; held in columns it costs nine, which is what decides how
 * deep a history the workspace can afford.
 *
 * The columns come in blocks of a fixed size rather than one growing array. An
 * effect is addressed by a packed index -- the block it is in, and the slot
 * within it -- so a block whose effects have all been evicted is simply
 * dropped. Nothing is copied on eviction and nothing wraps.
 *
 * One instruction's effects never span two blocks. That way an entry's run is
 * always whole in one block, so evicting a block cannot cut an entry in half,
 * and reading a run resolves the block once. A block that fills mid-instruction
 * hands its part-built run to the next one, which is the only copy that ever
 * happens and touches only the handful of effects that instruction has so far.
 */

import { REGISTER_FILE_NAMES } from './registers'
import { serviceOf, slotOf } from './service'
import { KIND_REGISTER, KIND_FP, KIND_FLAG, KIND_CP0, KIND_MEMORY, KIND_CONSOLE, KIND_CONSOLE_RESET, KIND_DISPLAY, KIND_QUEUED_INPUT, KIND_CALL, KIND_HI_LO, KIND_HEAP_POINTER, KIND_HALTED, KIND_EXIT_CODE, KIND_SLEEP, KIND_INPUT, KIND_SERVICE } from './effectKind'
import type { CallFrame, DelayState, Effect } from './types'



/**
 * Entries per block, and effects per block: the whole history rolls at one
 * granularity.  Profiled from 256 to 16384 against a full million-entry log,
 * memory varies by about four per cent across that range and the speed of a run
 * not at all, so this is a middle value rather than a tuned one.
 */
export const BLOCK_SIZE = 2048



/** Every column of one effect, as `slotAt` reads them out together. */
export interface EffectSlot {
	/** The kind, as its code; `EFFECT_KINDS` spells it. */
	kind: number
	/** Which location: a register number, an index, or a word address. */
	a: number
	/** The value held, for the kinds whose value is a number. */
	b: number
	/** What is held when it is not a number; undefined for the rest. */
	value: unknown
}

/** One block of columns, plus the values of the few effects that need one. */
interface Block {
	kind: Uint8Array
	/** Which location: a register number, an index, or a word address. */
	a: Int32Array
	/** The value held, or the second half of a pair. */
	b: Int32Array
	/** Only for the kinds whose value is not a number; sparse. */
	values: Map<number, unknown>
}

function emptyBlock(): Block {
	return {
		kind: new Uint8Array(BLOCK_SIZE),
		a: new Int32Array(BLOCK_SIZE),
		b: new Int32Array(BLOCK_SIZE),
		values: new Map(),
	}
}

export class EffectStore {
	/** Blocks in order; `blocks[0]` is block number `firstBlock`. */
	private blocks: Block[] = []
	private firstBlock = 0
	/** The block being written, and the next free slot in it. */
	private currentBlock = 0
	private nextSlot = 0
	/** Where the run being built started, or -1 when none is open. */
	private runStart = -1

	/** The index of the next effect, which is where a run about to open begins. */
	get position(): number {
		return this.currentBlock * BLOCK_SIZE + this.nextSlot
	}

	/**
	 * Starts an instruction's run.  A block with no room left is left behind
	 * here rather than part-way through, so a run is never split.
	 */
	beginRun(): number {
		if (this.nextSlot >= BLOCK_SIZE) this.advanceBlock()
		this.runStart = this.position
		return this.runStart
	}

	/** Ends it, giving back what the entry needs to find its effects again. */
	endRun(): { start: number, count: number } {
		const start = this.runStart < 0 ? this.position : this.runStart
		const count = this.position - start
		this.runStart = -1
		return { start, count }
	}

	push(kind: number, a: number, b: number, value?: unknown) {
		if (this.nextSlot >= BLOCK_SIZE) this.carryRunToNextBlock()
		const target = this.blockAt(this.currentBlock, true)!
		const slot = this.nextSlot++
		target.kind[slot] = kind
		target.a[slot] = a
		target.b[slot] = b
		if (value !== undefined) target.values.set(slot, value)
	}

	/**
	 * Forgets everything below `index`.  Only whole blocks are given up, since
	 * an entry's run is whole in one and the store cannot know which entries the
	 * caller still wants inside the block it is reading.
	 */
	dropBefore(index: number) {
		const wanted = Math.floor(index / BLOCK_SIZE)
		while (this.firstBlock < wanted && this.blocks.length > 1) {
			this.blocks.shift()
			this.firstBlock += 1
		}
	}

	/** Forgets everything from `index` on, which a diverging run has left behind. */
	truncate(index: number) {
		if (index >= this.position) return
		const wantedBlock = Math.max(this.firstBlock, Math.floor(index / BLOCK_SIZE))
		this.currentBlock = wantedBlock
		this.nextSlot = index < wantedBlock * BLOCK_SIZE ? 0 : index % BLOCK_SIZE
		while (this.firstBlock + this.blocks.length - 1 > this.currentBlock) this.blocks.pop()
		const block = this.blockAt(this.currentBlock)
		// The values of the effects being dropped go with them.
		if (block) for (const slot of [...block.values.keys()]) if (slot >= this.nextSlot) block.values.delete(slot)
	}

	clear() {
		this.blocks = []
		this.firstBlock = 0
		this.currentBlock = 0
		this.nextSlot = 0
		this.runStart = -1
	}

	/** The kind, as the code the column holds. */
	kindAt(index: number): number {
		return this.blockOf(index).kind[index % BLOCK_SIZE]
	}

	/**
	 * Every column of one effect, through a single block lookup.
	 *
	 * Reading them one at a time locates the block four times over, each with a
	 * divide, a bounds check and a modulo, to fetch four numbers that sit beside
	 * each other.  Anything that wants more than one column asks for all of them.
	 */
	slotAt(index: number): EffectSlot {
		const block = this.blockOf(index)
		const slot = index % BLOCK_SIZE
		return {
			kind: block.kind[slot],
			a: block.a[slot],
			b: block.b[slot],
			value: block.values.get(slot),
		}
	}

	aAt(index: number): number {
		return this.blockOf(index).a[index % BLOCK_SIZE]
	}

	valueAt(index: number): unknown {
		return this.blockOf(index).values.get(index % BLOCK_SIZE)
	}

	setA(index: number, value: number) {
		this.blockOf(index).a[index % BLOCK_SIZE] = value
	}

	setB(index: number, value: number) {
		this.blockOf(index).b[index % BLOCK_SIZE] = value
	}

	setValue(index: number, value: unknown) {
		this.blockOf(index).values.set(index % BLOCK_SIZE, value)
	}

	/** Blocks held, which is what the log costs beyond its entries. */
	get blockCount() {
		return this.blocks.length
	}

	private advanceBlock() {
		this.currentBlock += 1
		this.nextSlot = 0
		this.blockAt(this.currentBlock, true)
	}

	/**
	 * Moves the run being built into a fresh block, so the instruction's effects
	 * stay together.  Only what this instruction has recorded so far moves,
	 * which is a handful of slots.
	 */
	private carryRunToNextBlock() {
		const from = this.blockAt(this.currentBlock)!
		const start = this.runStart
		const carried = start < 0 ? 0 : this.position - start
		const firstSlot = start % BLOCK_SIZE

		this.advanceBlock()
		if (carried === 0) return

		const to = this.blockAt(this.currentBlock)!
		for (let offset = 0; offset < carried; offset++) {
			to.kind[offset] = from.kind[firstSlot + offset]
			to.a[offset] = from.a[firstSlot + offset]
			to.b[offset] = from.b[firstSlot + offset]
			const value = from.values.get(firstSlot + offset)
			if (value !== undefined) to.values.set(offset, value)
		}
		this.nextSlot = carried
		this.runStart = this.currentBlock * BLOCK_SIZE
	}

	/** Where the run being built now starts, which a carry may have moved. */
	get openRunStart() {
		return this.runStart
	}

	private blockAt(number: number, create = false): Block | undefined {
		const at = number - this.firstBlock
		if (create) while (this.blocks.length <= at) this.blocks.push(emptyBlock())
		return this.blocks[at]
	}

	private blockOf(index: number): Block {
		const block = this.blockAt(Math.floor(index / BLOCK_SIZE))
		if (!block) throw new Error(`History effect ${index} has been dropped`)
		return block
	}

	/**
	 * The effect as an object, for the history panel.  Only the rows on screen
	 * are ever built, so this costs nothing for a log nobody is looking at.
	 */
	/**
	 * What each registered service is called, for the one panel that prints it.
	 * The store keeps no other idea of what a service is.
	 */
	private readonly serviceNames: string[] = []

	nameService(id: number, name: string) {
		this.serviceNames[id] = name
	}

	materialize(index: number): Effect {
		const { kind: code, a, b, value } = this.slotAt(index)
		switch (code) {
			case KIND_REGISTER: return { kind: code, name: REGISTER_FILE_NAMES[a], value: b }
			case KIND_MEMORY: return { kind: code, wordAddress: a, words: value as Array<number | undefined> }
			case KIND_CONSOLE: return { kind: code, text: String(value) }
			case KIND_CALL: return { kind: code, frame: value as CallFrame }
			case KIND_HI_LO: return { kind: code, hi: a, lo: b }
			// `a` says whether the program had exited; `null` is not a number.
			case KIND_EXIT_CODE: return { kind: code, value: a === 0 ? null : b }
			case KIND_FLAG: return { kind: code, index: a, value: b !== 0 }
			case KIND_HALTED: return { kind: code, value: b !== 0 }
			case KIND_FP:
			case KIND_CP0:
				return { kind: code, index: a, value: b }
			case KIND_HEAP_POINTER:
			case KIND_SLEEP:
				return { kind: code, value: b }
			case KIND_CONSOLE_RESET:
			case KIND_DISPLAY:
			case KIND_QUEUED_INPUT:
			case KIND_INPUT:
				return { kind: code, value: String(value) }
			case KIND_SERVICE: {
				const service = serviceOf(a)
				return { kind: code, name: this.serviceNames[service] ?? 'device', service, slot: slotOf(a), value: b }
			}
		}
		throw new Error(`Effect ${index} has an unknown kind: ${code}`)
	}
}

/** Delay states as the codes the entry's own column holds. */
export const DELAY_STATES: DelayState[] = ['none', 'registered', 'triggered']
