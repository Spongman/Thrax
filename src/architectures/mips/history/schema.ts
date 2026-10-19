import type { HistoryBufferSchema, HistoryBufferType } from '../../../core/historyBuffers'

const column = (name: string, type: HistoryBufferType) => Object.freeze({ name, type, elements: 1 })

/**
 * MIPS's explicit history columns. Entry: where it ran and the word, the count
 * before it, and the control state it exchanges; flags hold the entry kind, the
 * delay state, and whether pc and target were held unsigned. Effect: the packed
 * kind and two values. Payloads: an entry's file/random copies and an effect's
 * non-numeric value.
 */
export const mipsHistorySchema: HistoryBufferSchema = Object.freeze({
	entry: Object.freeze([
		column('address', 'u32'),
		column('word', 'i32'),
		column('instructionCount', 'f64'),
		column('pc', 'i32'),
		column('delayedTarget', 'i32'),
		column('flags', 'u8'),
	]),
	effect: Object.freeze([column('kind', 'u8'), column('a', 'i32'), column('b', 'i32')]),
	payloads: Object.freeze(['entry', 'effect'] as const),
})
