/**
 * The Z80 history as the shared panels and tools read it: records built on
 * request from the typed columns, and the effects taken apart into chips.
 */

import type { DescribedEffect, HistoryFormatter, HistoryRecord, MachineHistory } from '../contracts'
import { SLOT_AF, SLOT_AF_ALT, SLOT_BC, SLOT_BC_ALT, SLOT_DE, SLOT_DE_ALT, SLOT_EI_DELAY, SLOT_HALTED, SLOT_HL, SLOT_HL_ALT, SLOT_I, SLOT_IFF1, SLOT_IFF2, SLOT_IM, SLOT_IX, SLOT_IY, SLOT_PC, SLOT_R, SLOT_SP } from './cpu'
import { decode, hex16, hex8, instructionLength } from './disassemble'
import {
	EFFECT_FIELD, EFFECT_FRAME_DEPTH, EFFECT_MEMORY, EFFECT_OUTPUT, EFFECT_SLOT, ENTRY_EDIT, ENTRY_INTERRUPT, NMI_DATA, type Z80History,
} from './history'
import { packInstruction, type Z80Executed } from './instructions'
import {
	FIELD_CONTROL, FIELD_EXIT, FIELD_HALTED, FIELD_INPUT_INDEX, FIELD_KEY, FIELD_LISTENING, FIELD_NMI, FIELD_PENDING, FIELD_PERIOD,
	FIELD_SLEEPING, FIELD_TICKED, FIELD_WAITING, IRQ_KEYBOARD, IRQ_TIMER, KEYBOARD_DATA, TIMER_DATA, type Z80Console,
} from './machine'

class Z80Record implements Z80Executed {
	constructor(
		readonly id: number,
		readonly instructionCount: number,
		readonly address: number,
		readonly kind: 'instruction' | 'edit',
		readonly packed: number,
		readonly interrupt: boolean,
	) {}
}

/** The bytes an entry recorded, as a reader. */
const reader = (bytes: number) => (offset: number) => offset < 4 ? (bytes >>> (offset * 8)) & 0xFF : 0

/** Live over the log: entries come and go as the machine runs and rewinds. */
export class Z80HistoryView implements MachineHistory {
	constructor(private readonly log: Z80History | null) {}

	get length(): number {
		return this.log?.length ?? 0
	}

	at(index: number): Z80Record | undefined {
		const log = this.log
		if (!log || index < 0 || index >= log.length) return undefined
		const kind = log.kindAt(index)
		const bytes = log.bytesAt(index)
		const interrupt = kind === ENTRY_INTERRUPT
		const read = reader(bytes)
		return new Z80Record(
			log.idAt(index),
			log.countAt(index),
			log.pcAt(index),
			kind === ENTRY_EDIT ? 'edit' : 'instruction',
			interrupt ? bytes : packInstruction(read, instructionLength(read)),
			interrupt,
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

/** Slot names and the register ids a click goes to. */
const SLOTS: Readonly<Record<number, { name: string, id?: string, byte?: boolean }>> = {
	[SLOT_AF]: { name: 'AF', id: 'AF' },
	[SLOT_BC]: { name: 'BC', id: 'BC' },
	[SLOT_DE]: { name: 'DE', id: 'DE' },
	[SLOT_HL]: { name: 'HL', id: 'HL' },
	[SLOT_AF_ALT]: { name: 'AF\'', id: 'AF2' },
	[SLOT_BC_ALT]: { name: 'BC\'', id: 'BC2' },
	[SLOT_DE_ALT]: { name: 'DE\'', id: 'DE2' },
	[SLOT_HL_ALT]: { name: 'HL\'', id: 'HL2' },
	[SLOT_IX]: { name: 'IX', id: 'IX' },
	[SLOT_IY]: { name: 'IY', id: 'IY' },
	[SLOT_SP]: { name: 'SP', id: 'SP' },
	[SLOT_PC]: { name: 'PC', id: 'PC' },
	[SLOT_I]: { name: 'I', id: 'I', byte: true },
	[SLOT_R]: { name: 'R', id: 'R', byte: true },
	[SLOT_IFF1]: { name: 'IFF1', id: 'IFF1' },
	[SLOT_IFF2]: { name: 'IFF2', id: 'IFF2' },
	[SLOT_IM]: { name: 'IM', id: 'IM' },
	[SLOT_HALTED]: { name: 'HALT' },
	[SLOT_EI_DELAY]: { name: 'EI delay' },
}

const sources = (bits: number) => [bits & IRQ_KEYBOARD ? 'keyboard' : '', bits & IRQ_TIMER ? 'timer' : ''].filter(Boolean).join(', ') || 'none'

const character = (code: number) => code < 0 ? 'none' : JSON.stringify(String.fromCharCode(code))

/** Machine field chips: what changed, shown as the value it held. */
function fieldEffect(field: number, old: number, console: Z80Console): Omit<DescribedEffect, 'applied' | 'label'> {
	switch (field) {
		case FIELD_HALTED: return { subject: old ? 'running' : 'ended' }
		case FIELD_NMI: return { subject: old ? 'NMI taken' : 'NMI requested' }
		case FIELD_INPUT_INDEX: return { subject: 'read', detail: JSON.stringify(console.input.charAt(old)) }
		case FIELD_KEY: return { subject: 'keyboard', text: character(old) }
		case FIELD_PENDING: return { subject: 'interrupts', text: sources(old) }
		case FIELD_CONTROL: return { subject: 'enabled', text: sources(old) }
		case FIELD_PERIOD: return { subject: 'timer period', text: String(old) }
		case FIELD_WAITING: return { subject: old ? 'input arrived' : 'waiting for input' }
		case FIELD_LISTENING: return { subject: 'listening', text: old ? 'yes' : 'no' }
		case FIELD_EXIT: return { subject: 'exit code', text: old < 0 ? 'none' : String(old) }
		case FIELD_TICKED: return { subject: 'timer fired', text: old ? 'yes' : 'no' }
		case FIELD_SLEEPING: return { subject: old ? 'woken' : 'sleeping' }
	}
	return { subject: `field ${field}` }
}

function described(applied: boolean, parts: Omit<DescribedEffect, 'applied' | 'label'>): DescribedEffect {
	const held = parts.value === undefined ? parts.text : parts.text ?? hex16(Number(parts.value))
	const label = held !== undefined
		? (applied ? `${parts.subject} → ${held}` : `${parts.subject} ${held} →`)
		: parts.detail !== undefined ? `${parts.subject} ${parts.detail}` : parts.subject
	return { ...parts, applied, label }
}

const INTERRUPT_NAMES: Readonly<Record<number, string>> = { [KEYBOARD_DATA]: 'keyboard', [TIMER_DATA]: 'timer', [NMI_DATA]: 'NMI' }

/** The log keeps only what each effect replaced, so a chip shows that value. */
export function z80HistoryFormatter(log: Z80History | null, console: Z80Console): HistoryFormatter {
	return {
		instruction(record) {
			const { kind, packed, address, interrupt } = record as Z80Executed
			if (interrupt) return `${INTERRUPT_NAMES[packed] ?? `bus ${hex8(packed)}`} interrupt`
			return kind === 'edit' ? '' : decode((offset) => Math.floor(packed / 256 ** offset) & 0xFF, address).text
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
				const at = (parts: Omit<DescribedEffect, 'applied' | 'label'>) => effects.push(described(applied, parts))
				switch (log.effectKind(position)) {
					case EFFECT_SLOT: {
						const slot = SLOTS[a]
						if (a === SLOT_EI_DELAY) break
						at({ subject: slot.name, register: slot.id, value: b, text: slot.byte ? hex8(b) : a >= SLOT_IFF1 ? String(b) : undefined })
						break
					}
					case EFFECT_MEMORY: at({ subject: `[${hex16(a)}]`, address: a, value: b, text: hex8(b) }); break
					case EFFECT_FIELD: at(fieldEffect(a, b, console)); break
					// Output grows a character at a time past the length it replaced.
					case EFFECT_OUTPUT: at({ subject: 'console', detail: JSON.stringify(console.output.slice(b, b + 1)) }); break
					case EFFECT_FRAME_DEPTH: at({ subject: 'call depth', text: String(b) }); break
				}
			}
			return effects
		},
	}
}
