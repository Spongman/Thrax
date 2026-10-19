/**
 * The Beta history as the shared panels and tools read it: records built on
 * request from the typed columns, and the effects taken apart into chips.
 */

import { formatWord } from '../../core/format'
import type { DescribedEffect, HistoryFormatter, HistoryRecord, MachineHistory } from '../contracts'
import { disassemble } from './disassemble'
import {
	EFFECT_FRAME_DEPTH, EFFECT_HALTED, EFFECT_INPUT, EFFECT_KEY, EFFECT_MEMORY, EFFECT_OUTPUT, EFFECT_PC, EFFECT_PENDING, EFFECT_REGISTER,
	EFFECT_SEG_BASE, EFFECT_SEG_BOUNDS, EFFECT_WAITING, ENTRY_EDIT, ENTRY_INTERRUPT, type BetaHistory,
} from './history'
import type { BetaExecuted } from './instructions'
import type { BetaConsole } from './machine'
import { BETA_REGISTERS } from './registers'

const ADDRESS_MASK = 0x7FFFFFFF

class BetaRecord implements BetaExecuted {
	constructor(
		readonly id: number,
		readonly instructionCount: number,
		readonly address: number,
		readonly kind: 'instruction' | 'edit',
		readonly word: number,
		readonly interrupt: boolean,
	) {}
}

/** Live over the log: entries come and go as the machine runs and rewinds. */
export class BetaHistoryView implements MachineHistory {
	constructor(private readonly log: BetaHistory | null) {}

	get length(): number {
		return this.log?.length ?? 0
	}

	at(index: number): BetaRecord | undefined {
		const log = this.log
		if (!log || index < 0 || index >= log.length) return undefined
		const kind = log.kindAt(index)
		return new BetaRecord(
			log.idAt(index),
			log.countAt(index),
			// The editor and breakpoints know addresses without the supervisor bit.
			(log.pcAt(index) & ADDRESS_MASK) >>> 0,
			kind === ENTRY_EDIT ? 'edit' : 'instruction',
			log.wordAt(index),
			kind === ENTRY_INTERRUPT,
		)
	}

	instructionCountAt(index: number): number {
		return this.log!.countAt(index)
	}

	slice(from: number, to: number): HistoryRecord[] {
		const records: HistoryRecord[] = []
		const end = Math.min(to, this.length)
		for (let index = Math.max(0, from); index < end; index++) records.push(this.at(index)!)
		return records
	}

	indexOfId(id: number): number {
		const log = this.log
		if (!log) return -1
		const index = id - log.firstId
		return index >= 0 && index < log.length ? index : -1
	}
}

const hex = (value: number) => formatWord(value >>> 0)

/** Interrupt sources by BSim vector, then by IRQ bit. */
const VECTOR_NAMES: Record<number, string> = { 12: 'clock', 16: 'keyboard', 20: 'mouse' }
const IRQ_NAMES: readonly [number, string][] = [[2, 'clock'], [4, 'keyboard'], [8, 'mouse']]

const requests = (bits: number) => IRQ_NAMES.filter(([bit]) => bits & bit).map(([, name]) => name).join(', ') || 'none'

/** Every value this machine records is a word. */
type WordEffect = Omit<DescribedEffect, 'applied' | 'label'> & { value?: number, second?: number }

function described(applied: boolean, parts: WordEffect): DescribedEffect {
	const held = parts.value === undefined ? parts.text : hex(parts.value)
	const label = held !== undefined
		? (applied ? `${parts.subject} → ${held}` : `${parts.subject} ${held} →`)
		: parts.detail !== undefined ? `${parts.subject} ${parts.detail}` : parts.subject
	return { ...parts, applied, label }
}

/**
 * The log keeps only what each effect replaced, so a chip shows that value.
 * Every entry stands behind the present: a rewind drops what it undid.
 */
export function betaHistoryFormatter(log: BetaHistory | null, console: BetaConsole): HistoryFormatter {
	return {
		instruction(record) {
			const { kind, word, address, interrupt } = record as BetaExecuted
			if (interrupt) return `${VECTOR_NAMES[word] ?? `vector ${word}`} interrupt`
			return kind === 'edit' ? '' : disassemble(word, address)
		},
		effects(record, applied) {
			if (!log) return []
			const index = record.id - log.firstId
			if (index < 0 || index >= log.length || log.idAt(index) !== record.id) return []
			const start = log.effectStartAt(index)
			const effects: DescribedEffect[] = []
			for (let position = start; position < start + log.effectCountAt(index); position++) {
				const a = log.effectA(position)
				const b = log.effectB(position)
				const at = (parts: WordEffect) => effects.push(described(applied, parts))
				switch (log.effectKind(position)) {
					case EFFECT_REGISTER: at({ subject: BETA_REGISTERS[a].name, register: BETA_REGISTERS[a].id, value: b }); break
					case EFFECT_MEMORY: at({ subject: `[${formatWord(a >>> 0)}]`, address: a >>> 0, value: b }); break
					case EFFECT_PC: at({ subject: 'PC', register: 'PC', value: b }); break
					// WRCHAR writes one character past the length it replaced.
					case EFFECT_OUTPUT: at({ subject: 'console', detail: JSON.stringify(console.output.slice(b, b + 1)) }); break
					case EFFECT_INPUT: at({ subject: 'read', detail: JSON.stringify(console.input.charAt(b)) }); break
					case EFFECT_WAITING: at({ subject: b ? 'input arrived' : 'waiting for input' }); break
					case EFFECT_HALTED: at({ subject: b ? 'running' : 'halted' }); break
					case EFFECT_FRAME_DEPTH: at({ subject: 'call depth', text: String(b) }); break
					case EFFECT_KEY: at({ subject: 'keyboard', text: b < 0 ? 'empty' : JSON.stringify(String.fromCharCode(b)) }); break
					case EFFECT_PENDING: at({ subject: 'interrupts', text: requests(b) }); break
					case EFFECT_SEG_BASE: at({ subject: 'SEG_BASE', value: b }); break
					case EFFECT_SEG_BOUNDS: at({ subject: 'SEG_BOUNDS', value: b }); break
				}
			}
			return effects
		},
	}
}
