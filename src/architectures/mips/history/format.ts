/**
 * How the history panel reads MIPS entries: the word each ran, disassembled,
 * and the packed effects it recorded, taken apart into chips.
 */

import { disassemble } from '../core/disassembler'
import { KIND_CALL, KIND_CONSOLE, KIND_CONSOLE_RESET, KIND_CP0, KIND_DISPLAY, KIND_EXIT_CODE, KIND_FLAG, KIND_FP, KIND_HALTED, KIND_HEAP_POINTER, KIND_HI_LO, KIND_INPUT, KIND_MEMORY, KIND_QUEUED_INPUT, KIND_REGISTER, KIND_SERVICE, KIND_SLEEP } from '../../../core/effectKind'
import type { EffectStore } from '../core/effectStore'
import { formatWord } from '../../../core/format'
import type { Effect, HistoryEntry } from '../../../core/types'
import type { DescribedEffect, HistoryFormatter } from '../../contracts'

const hex = (value: number) => formatWord(value >>> 0)

/** Every value this machine records is a word. */
type WordEffect = Omit<DescribedEffect, 'applied' | 'label'> & { value?: number, second?: number }

function described(applied: boolean, parts: WordEffect): DescribedEffect {
	const held = parts.value === undefined ? parts.text
		: parts.second === undefined ? hex(parts.value)
			: `${hex(parts.value)}/${hex(parts.second)}`
	const label = held !== undefined
		? (applied ? `${parts.subject} → ${held}` : `${parts.subject} ${held} →`)
		: parts.detail !== undefined ? `${parts.subject} ${parts.detail}` : parts.subject
	return { ...parts, applied, label }
}

export function describeEffect(effect: Effect, applied: boolean): DescribedEffect {
	const at = (parts: WordEffect) => described(applied, parts)
	switch (effect.kind) {
		case KIND_REGISTER: return at({ subject: effect.name, register: effect.name, value: effect.value })
		case KIND_FP: return at({ subject: `$f${effect.index}`, register: `$f${effect.index}`, value: effect.value })
		case KIND_FLAG: return at({ subject: `cc${effect.index}`, text: String(effect.value) })
		case KIND_CP0: return at({ subject: `cp0[${effect.index}]`, value: effect.value })
		case KIND_MEMORY: {
			// Unsigned: a word address in the kernel or the MMIO region shifts into a
			// negative byte address, which no panel would match.
			const address = (effect.wordAddress << 2) >>> 0
			const span = effect.words.length === 1 ? formatWord(address) : `${formatWord(address)}+${effect.words.length * 4}`
			return at({ subject: `[${span}]`, address })
		}
		case KIND_CONSOLE: return at({ subject: 'console', detail: JSON.stringify(effect.text) })
		case KIND_CONSOLE_RESET: return at({ subject: 'console cleared' })
		case KIND_DISPLAY: return at({ subject: 'display' })
		case KIND_QUEUED_INPUT: return at({ subject: 'keyboard read' })
		case KIND_CALL: return at({ subject: `call ${formatWord(effect.frame.targetAddress)}`, address: effect.frame.targetAddress })
		case KIND_HI_LO: return at({ subject: 'hi/lo', register: '$hi', value: effect.hi, second: effect.lo })
		case KIND_HEAP_POINTER: return at({ subject: 'heap', value: effect.value })
		case KIND_HALTED: return at({ subject: effect.value ? 'running' : 'halted' })
		case KIND_EXIT_CODE: return at({ subject: 'exit code' })
		case KIND_SLEEP: return at({ subject: 'sleep' })
		case KIND_INPUT: return at({ subject: 'read', detail: JSON.stringify(effect.value) })
		// Only the service knows what its slots mean, so the chip names it.
		case KIND_SERVICE: return at({ subject: effect.name })
	}
}

/** The effects of one entry, in the order they happened. */
export function rowEffects(entry: HistoryEntry, effects: EffectStore | null, applied: boolean): DescribedEffect[] {
	if (!effects) return []
	return Array.from({ length: entry.effectCount }, (unused, offset) =>
		describeEffect(effects.materialize(entry.effectStart + offset), applied))
}

export function historyFormatter(effects: EffectStore): HistoryFormatter {
	return {
		instruction(record) {
			const { word } = record as HistoryEntry
			return word === null ? '' : disassemble(word) ?? ''
		},
		effects: (record, applied) => rowEffects(record as HistoryEntry, effects, applied),
	}
}
