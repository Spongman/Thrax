/**
 * The ARM26 history as the shared panels and tools read it: records built on
 * request from the typed columns, and the effects taken apart into chips.
 */

import { formatWord } from '../../core/format'
import { disassembleA32 } from '../arm/a32/disassemble'
import type { DescribedEffect, HistoryFormatter, HistoryRecord, MachineHistory } from '../contracts'
import { BANKS, MODE_NAMES } from './cpu'
import {
	EFFECT_DISPLAY, EFFECT_FRAME_DEPTH, EFFECT_HALTED, EFFECT_INPUT, EFFECT_KEY, EFFECT_KEY_INTERRUPT, EFFECT_MEMORY, EFFECT_OUTPUT, EFFECT_PC,
	EFFECT_PSR, EFFECT_REGISTER, EFFECT_WAITING, ENTRY_EDIT, ENTRY_INTERRUPT, type Arm26History,
} from './history'
import type { Arm26Executed } from './instructions'
import type { Arm26Keyboard } from './keyboard'
import type { Arm26Os } from './os'
import { PHYSICAL_IDS } from './registers'

class Arm26Record implements Arm26Executed {
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
export class Arm26HistoryView implements MachineHistory {
	constructor(private readonly log: Arm26History | null) {}

	get length(): number {
		return this.log?.length ?? 0
	}

	at(index: number): Arm26Record | undefined {
		const log = this.log
		if (!log || index < 0 || index >= log.length) return undefined
		const kind = log.kindAt(index)
		return new Arm26Record(log.idAt(index), log.countAt(index), log.pcAt(index), kind === ENTRY_EDIT ? 'edit' : 'instruction', log.wordAt(index), kind === ENTRY_INTERRUPT)
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

/** The status bits as `NZcvIf SVC`: upper case where set. */
export function statusText(psr: number): string {
	const flags = 'NZCVIF'.split('').map((name, index) => psr & (1 << (31 - index)) ? name : name.toLowerCase()).join('')
	return `${flags} ${MODE_NAMES[psr & 3]}`
}

function described(applied: boolean, parts: Omit<DescribedEffect, 'applied' | 'label'>): DescribedEffect {
	const held = parts.value === undefined ? parts.text : hex(parts.value)
	const label = held !== undefined
		? (applied ? `${parts.subject} → ${held}` : `${parts.subject} ${held} →`)
		: parts.detail !== undefined ? `${parts.subject} ${parts.detail}` : parts.subject
	return { ...parts, applied, label }
}

/** The descriptor id that shows physical register `index` in `mode`: its plain name when the mode sees it. */
export function registerIdIn(index: number, mode: number): string {
	const visible = BANKS[mode].indexOf(index)
	return visible >= 0 ? `R${visible}` : PHYSICAL_IDS[index]
}

/** Every entry stands behind the present; a chip shows what the effect replaced. */
export function arm26HistoryFormatter(log: Arm26History | null, os: Arm26Os, keyboard: Arm26Keyboard, mode: () => number): HistoryFormatter {
	return {
		instruction(record) {
			const { kind, word, address, interrupt } = record as Arm26Executed
			if (interrupt) return 'IRQ'
			return kind === 'edit' ? '' : disassembleA32(word, address)
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
					case EFFECT_REGISTER: {
						const id = registerIdIn(a, mode())
						at({ subject: id === 'R13' ? 'SP' : id === 'R14' ? 'LR' : id, register: id, value: b })
						break
					}
					case EFFECT_MEMORY: at({ subject: `[${formatWord(a >>> 0)}]`, address: a >>> 0, value: b }); break
					case EFFECT_PC: at({ subject: 'PC', register: 'PC', value: b }); break
					case EFFECT_PSR: at({ subject: 'status', register: 'PSR', text: statusText(b) }); break
					case EFFECT_OUTPUT: at({ subject: 'console', detail: JSON.stringify(os.output.slice(b, a)) }); break
					case EFFECT_INPUT: at({ subject: 'read', detail: JSON.stringify(os.input.charAt(b)) }); break
					case EFFECT_WAITING: at({ subject: b ? 'input arrived' : 'waiting for input' }); break
					case EFFECT_HALTED: at({ subject: b ? 'running' : 'halted' }); break
					case EFFECT_FRAME_DEPTH: at({ subject: 'call depth', text: String(b) }); break
					case EFFECT_KEY: at({ subject: 'key', detail: JSON.stringify(keyboard.input.charAt(b)) }); break
					case EFFECT_DISPLAY: at({ subject: 'display', detail: JSON.stringify(keyboard.display.slice(b, a)) }); break
					case EFFECT_KEY_INTERRUPT: at({ subject: 'keyboard interrupt', text: b ? 'enabled' : 'disabled' }); break
				}
			}
			return effects
		},
	}
}
