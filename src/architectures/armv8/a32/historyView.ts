import { HistoryView, describeEffect } from '../../../core/historyView'
import type { PolledTerminal } from '../../../core/devices/polledTerminal'
/**
 * The AArch32 history as the shared panels and tools read it: records built
 * on request from the typed columns, and the effects taken apart into chips.
 */

import { formatRegister, formatWord } from '../../../core/format'
import { disassembleA32 } from '../../arm/a32/disassemble'
import { ARCH_V8 } from '../../arm/a32/isa'
import type { DescribedEffect, HistoryFormatter } from '../../contracts'
import {
	EFFECT_BREAK, EFFECT_CPSR, EFFECT_DISPLAY, EFFECT_EXIT, EFFECT_FRAME_DEPTH, EFFECT_HALTED, EFFECT_INPUT, EFFECT_KEY, EFFECT_MEMORY,
	EFFECT_MONITOR, EFFECT_OUTPUT, EFFECT_PC, EFFECT_REGISTER, EFFECT_WAITING, ENTRY_EDIT, type A32History,
} from './history'
import type { A32Executed } from './instructions'
import type { A32Linux } from './machine'

class A32Record implements A32Executed {
	constructor(
		readonly id: number,
		readonly instructionCount: number,
		readonly address: number,
		readonly kind: 'instruction' | 'edit',
		readonly word: number,
	) {}
}

/** Live over the log: entries come and go as the machine runs and rewinds. */
export class A32HistoryView extends HistoryView<A32History, A32Record> {
	protected record(log: A32History, index: number): A32Record {
		return new A32Record(log.idAt(index), log.countAt(index), log.pcAt(index), log.kindAt(index) === ENTRY_EDIT ? 'edit' : 'instruction', log.wordAt(index))
	}
}

function described(applied: boolean, parts: Omit<DescribedEffect, 'applied' | 'label'>): DescribedEffect {
	return describeEffect(applied, parts, parts.value === undefined ? parts.text : formatRegister(parts.value, 32))
}

const REGISTER_NAMES: Readonly<Record<number, string>> = { 13: 'SP', 14: 'LR' }

/**
 * The log keeps only what each effect replaced, so a chip shows that value.
 * Every entry stands behind the present: a rewind drops what it undid.
 */
export function a32HistoryFormatter(log: A32History | null, linux: A32Linux, keyboard: PolledTerminal): HistoryFormatter {
	return {
		instruction(record) {
			const { kind, word, address } = record as A32Executed
			return kind === 'edit' ? '' : disassembleA32(word, address, ARCH_V8)
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
					case EFFECT_REGISTER: at({ subject: REGISTER_NAMES[a] ?? `R${a}`, register: `R${a}`, value: b >>> 0 }); break
					case EFFECT_PC: at({ subject: 'PC', register: 'PC', value: b >>> 0 }); break
					case EFFECT_CPSR: at({ subject: 'CPSR', register: 'CPSR', value: b >>> 0 }); break
					case EFFECT_MEMORY: at({ subject: `[${formatWord(a)}]`, address: a, value: b >>> 0 }); break
					case EFFECT_MONITOR: at({ subject: 'exclusive monitor', text: b < 0 ? 'open' : formatWord(b) }); break
					case EFFECT_OUTPUT: at({ subject: 'console', detail: JSON.stringify(linux.output.slice(b, b + 32)) }); break
					case EFFECT_INPUT: at({ subject: 'read', detail: JSON.stringify(linux.input.slice(b, b + 32)) }); break
					case EFFECT_WAITING: at({ subject: b ? 'input arrived' : 'waiting for input' }); break
					case EFFECT_HALTED: at({ subject: b ? 'running' : 'halted' }); break
					case EFFECT_EXIT: at({ subject: 'exit', text: String(linux.exitCode) }); break
					case EFFECT_BREAK: at({ subject: 'brk', value: b }); break
					case EFFECT_FRAME_DEPTH: at({ subject: 'call depth', text: String(b) }); break
					case EFFECT_KEY: at({ subject: 'keyboard', detail: JSON.stringify(keyboard.queued.charAt(b)) }); break
					case EFFECT_DISPLAY: at({ subject: 'display', detail: JSON.stringify(keyboard.display.slice(b, b + 1)) }); break
				}
			}
			return effects
		},
	}
}
