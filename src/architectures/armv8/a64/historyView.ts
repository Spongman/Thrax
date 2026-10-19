/**
 * The AArch64 history as the shared panels and tools read it: records built
 * on request from the typed columns, and the effects taken apart into chips.
 * Register and memory values are shown at their full width.
 */

import { formatRegister, formatWord } from '../../../core/format'
import type { DescribedEffect, HistoryFormatter, HistoryRecord, MachineHistory, RegisterValue } from '../../contracts'
import { disassemble } from './disassemble'
import {
	EFFECT_BREAK, EFFECT_DISPLAY, EFFECT_EXIT, EFFECT_FLAGS, EFFECT_FRAME_DEPTH, EFFECT_HALTED, EFFECT_INPUT, EFFECT_KEY, EFFECT_MEMORY,
	EFFECT_OUTPUT, EFFECT_PC, EFFECT_REGISTER, EFFECT_SP, EFFECT_WAITING, ENTRY_EDIT, type A64History,
} from './history'
import type { A64Executed } from './instructions'
import type { A64Keyboard, A64Linux } from './machine'
import { nzcvRegister } from './registers'

class A64Record implements A64Executed {
	constructor(
		readonly id: number,
		readonly instructionCount: number,
		readonly address: number,
		readonly kind: 'instruction' | 'edit',
		readonly word: number,
	) {}
}

/** Live over the log: entries come and go as the machine runs and rewinds. */
export class A64HistoryView implements MachineHistory {
	constructor(private readonly log: A64History | null) {}

	get length(): number {
		return this.log?.length ?? 0
	}

	at(index: number): A64Record | undefined {
		const log = this.log
		if (!log || index < 0 || index >= log.length) return undefined
		return new A64Record(log.idAt(index), log.countAt(index), log.pcAt(index), log.kindAt(index) === ENTRY_EDIT ? 'edit' : 'instruction', log.wordAt(index))
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

function described(applied: boolean, parts: Omit<DescribedEffect, 'applied' | 'label'>): DescribedEffect {
	const held = parts.value === undefined ? parts.text : formatRegister(parts.value, typeof parts.value === 'bigint' ? 64 : 32)
	const label = held !== undefined
		? (applied ? `${parts.subject} → ${held}` : `${parts.subject} ${held} →`)
		: parts.detail !== undefined ? `${parts.subject} ${parts.detail}` : parts.subject
	return { ...parts, applied, label }
}

/** A memory value at its width: a word or less as a number, a doubleword as a bigint. */
const memoryValue = (value: bigint, size: number): RegisterValue => size === 8 ? value : Number(value)

/**
 * The log keeps only what each effect replaced, so a chip shows that value.
 * Every entry stands behind the present: a rewind drops what it undid.
 */
export function a64HistoryFormatter(log: A64History | null, linux: A64Linux, keyboard: A64Keyboard): HistoryFormatter {
	return {
		instruction(record) {
			const { kind, word, address } = record as A64Executed
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
				const at = (parts: Omit<DescribedEffect, 'applied' | 'label'>) => effects.push(described(applied, parts))
				switch (log.effectKind(position)) {
					case EFFECT_REGISTER: at({ subject: `X${a}`, register: `X${a}`, value: log.effectValue(position) }); break
					case EFFECT_SP: at({ subject: 'SP', register: 'SP', value: log.effectValue(position) }); break
					case EFFECT_PC: at({ subject: 'PC', register: 'PC', value: BigInt(b) }); break
					case EFFECT_FLAGS: at({ subject: 'NZCV', register: 'NZCV', value: nzcvRegister(b) }); break
					case EFFECT_MEMORY: {
						const size = log.effectSize(position)
						at({ subject: `[${formatWord(a)}]`, address: a, value: memoryValue(log.effectValue(position), size) })
						break
					}
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
