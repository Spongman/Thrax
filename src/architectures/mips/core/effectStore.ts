/**
 * MIPS's effect codec over the shared history log.
 *
 * An effect is three small numbers and, for a few kinds, one value that is not
 * a number. Held as an object each, that costs about 56 bytes plus a slot in an
 * array of its own; held in the log's columns it costs nine, with the odd value
 * in the block's sparse payloads. Effects are addressed by the log's absolute
 * effect position, and an entry's run may straddle two blocks.
 */

import { REGISTER_FILE_NAMES } from './registers'
import { serviceOf, slotOf } from '../../../core/service'
import { KIND_REGISTER, KIND_FP, KIND_FLAG, KIND_CP0, KIND_MEMORY, KIND_CONSOLE, KIND_CONSOLE_RESET, KIND_DISPLAY, KIND_QUEUED_INPUT, KIND_CALL, KIND_HI_LO, KIND_HEAP_POINTER, KIND_HALTED, KIND_EXIT_CODE, KIND_SLEEP, KIND_INPUT, KIND_SERVICE } from './effectKind'
import type { CallFrame, DelayState, Effect } from './types'
import { HISTORY_BLOCK_SIZE } from '../../../core/historyBuffers'
import type { HistoryLog } from '../../../core/historyLog'
import type { HistoryRecords } from '../../../core/historyRecords'

/** Entries per block, and effects per block. */
export const BLOCK_SIZE = HISTORY_BLOCK_SIZE

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

export class EffectStore {
	private readonly records: HistoryRecords
	private readonly capacity: number
	// Column ordinals, bound once.
	private readonly kind: number
	private readonly a: number
	private readonly b: number

	constructor(private readonly log: HistoryLog) {
		const { layout } = log
		this.records = log.effects
		this.capacity = log.effects.capacity
		this.kind = layout.column('effect', 'kind', 'u8')
		this.a = layout.column('effect', 'a', 'i32')
		this.b = layout.column('effect', 'b', 'i32')
		if (!layout.payloads.effect) throw new Error('History codec requires effect payloads')
	}

	/** The position the next effect takes. */
	get position(): number {
		return this.records.end
	}

	/** Records one effect on the open entry; false when none is open or it was dropped. */
	push(kind: number, a: number, b: number, value?: unknown): boolean {
		const slot = this.log.pushEffect()
		if (slot < 0) return false
		const block = this.records.tail!
		block.arrays[this.kind][slot] = kind
		block.arrays[this.a][slot] = a
		block.arrays[this.b][slot] = b
		if (value !== undefined) block.payloads!.set(slot, value)
		return true
	}

	/** The kind, as the code the column holds. */
	kindAt(index: number): number {
		return this.records.block(index).arrays[this.kind][index % this.capacity]
	}

	/** Every column of one effect, through a single block lookup. */
	slotAt(index: number): EffectSlot {
		const block = this.records.block(index)
		const slot = index % this.capacity
		return {
			kind: block.arrays[this.kind][slot],
			a: block.arrays[this.a][slot],
			b: block.arrays[this.b][slot],
			value: block.payloads!.get(slot),
		}
	}

	aAt(index: number): number {
		return this.records.block(index).arrays[this.a][index % this.capacity]
	}

	valueAt(index: number): unknown {
		return this.records.block(index).payloads!.get(index % this.capacity)
	}

	setA(index: number, value: number) {
		this.records.block(index).arrays[this.a][index % this.capacity] = value
	}

	setB(index: number, value: number) {
		this.records.block(index).arrays[this.b][index % this.capacity] = value
	}

	setValue(index: number, value: unknown) {
		this.records.setPayload(index, value)
	}

	get blockCount() {
		return this.records.blockCount
	}

	/** Exact typed-array allocation; sparse payload heap size is deliberately excluded. */
	get allocatedBufferBytes() {
		return this.records.allocatedBytes
	}

	get payloadCount() {
		return this.records.payloadCount
	}

	/**
	 * What each registered service is called, for the one panel that prints it.
	 * The store keeps no other idea of what a service is.
	 */
	private readonly serviceNames: string[] = []

	nameService(id: number, name: string) {
		this.serviceNames[id] = name
	}

	/**
	 * The effect as an object, for the history panel.  Only the rows on screen
	 * are ever built, so this costs nothing for a log nobody is looking at.
	 */
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
