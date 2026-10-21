import { HistoryView, describeEffect, textChange } from '../../core/historyView'
/**
 * The 6502 history as the shared panels and tools read it: records built on
 * request from the typed columns, and each entry's changes taken apart into
 * chips. Registers are kept per entry rather than per change, so what an
 * entry changed is the difference from the entry after it, or from the CPU
 * for the last.
 */

import type { DescribedEffect, HistoryFormatter } from '../contracts'
import type { Mos6502Cpu } from './cpu'
import type { Mos6502Device } from './device'
import { disassemble, hex2, hex4 } from './disassemble'
import {
	EFFECT_CONTROL, EFFECT_EXIT, EFFECT_FRAME_DEPTH, EFFECT_HALTED, EFFECT_INPUT, EFFECT_MEMORY, EFFECT_NMI, EFFECT_OUTPUT, EFFECT_PERIOD,
	EFFECT_TIMER_FLAG, ENTRY_EDIT, ENTRY_INTERRUPT, type Mos6502History,
	EFFECT_SLEEPING, EFFECT_STOPPED,
} from './history'
import type { Mos6502Executed } from './instructions'

class Mos6502Record implements Mos6502Executed {
	constructor(
		readonly id: number,
		readonly instructionCount: number,
		readonly address: number,
		readonly kind: 'instruction' | 'edit',
		readonly opcode: number,
		readonly interrupt: boolean,
	) {}
}

/** Live over the log: entries come and go as the machine runs and rewinds. */
export class Mos6502HistoryView extends HistoryView<Mos6502History, Mos6502Record> {
	protected record(log: Mos6502History, index: number): Mos6502Record {
		const kind = log.kindAt(index)
		return new Mos6502Record(log.idAt(index), log.countAt(index), log.pcAt(index), kind === ENTRY_EDIT ? 'edit' : 'instruction', log.opcodeAt(index), kind === ENTRY_INTERRUPT)
	}
}

const VECTOR_NAMES: Readonly<Record<number, string>> = { 0xFFFA: 'NMI', 0xFFFE: 'IRQ' }

const described = describeEffect

/** Registers packed as the history keeps them, by name, with their width. */
const PACKED: readonly [string, number][] = [['A', 0], ['X', 8], ['Y', 16], ['SP', 24]]

export function mos6502HistoryFormatter(log: Mos6502History | null, cpu: Mos6502Cpu, device: Mos6502Device): HistoryFormatter {
	const packed = () => (cpu.a | (cpu.x << 8) | (cpu.y << 16) | (cpu.sp << 24)) >>> 0
	return {
		instruction(record) {
			const { kind, opcode, address, interrupt } = record as Mos6502Executed
			if (interrupt) return `${VECTOR_NAMES[opcode] ?? hex4(opcode)} interrupt`
			if (kind === 'edit') return ''
			const memory = cpu.memory
			return disassemble([opcode, memory[(address + 1) & 0xFFFF], memory[(address + 2) & 0xFFFF]], address, undefined, cpu.model)
		},
		effects(record, applied) {
			if (!log) return []
			const index = record.id - log.firstId
			if (index < 0 || index >= log.length || log.idAt(index) !== record.id) return []
			const effects: DescribedEffect[] = []
			const at = (parts: Omit<DescribedEffect, 'applied' | 'label'>, held?: string) => effects.push(described(applied, parts, held))
			// What the entry left is what the next one started from.
			const last = index === log.length - 1
			const before = log.registersAt(index)
			const after = last ? (log.timeline.ahead ? log.controlRegistersAt(index) : packed()) : log.registersAt(index + 1)
			for (const [name, shift] of PACKED) {
				const old = (before >>> shift) & 0xFF
				if (old !== ((after >>> shift) & 0xFF)) at({ subject: name, register: name, value: applied ? (after >>> shift) & 255 : old }, hex2(applied ? (after >>> shift) & 255 : old))
			}
			const p = log.pAt(index)
			const afterP = last ? (log.timeline.ahead ? log.controlPAt(index) : cpu.p) : log.pAt(index + 1)
			if (p !== afterP) at({ subject: 'P', register: 'P', value: applied ? afterP : p }, hex2(applied ? afterP : p))
			const start = log.effectStartAt(index)
			for (let position = start; position < start + log.effectCountAt(index); position++) {
				const a = log.effectA(position)
				const b = log.effectB(position)
				switch (log.effectKind(position)) {
					case EFFECT_MEMORY: at({ subject: `[${hex4(a)}]`, address: a, value: b }, hex2(b)); break
					case EFFECT_OUTPUT: at({ subject: 'console', detail: textChange((log.timeline.ahead ? log.outputText.text : device.output), a, b) }); break
					case EFFECT_INPUT: at({ subject: 'read', detail: JSON.stringify(device.input.charAt(b)) }); break
					case EFFECT_HALTED: at({ subject: b ? 'running' : 'halted' }); break
					case EFFECT_EXIT: at({ subject: 'exit code', text: b < 0 ? 'none' : String(b) }); break
					case EFFECT_FRAME_DEPTH: at({ subject: 'call depth', text: String(b) }); break
					case EFFECT_CONTROL: at({ subject: 'interrupt enables', text: hex2(b) }); break
					case EFFECT_PERIOD: at({ subject: 'timer period', text: String(b) }); break
					case EFFECT_TIMER_FLAG: at({ subject: 'timer flag', text: String(b) }); break
					case EFFECT_NMI: at({ subject: 'NMI', text: b ? 'pending' : 'none' }); break
					case EFFECT_SLEEPING: at({ subject: 'WAI', text: b ? 'waiting' : 'running' }); break
					case EFFECT_STOPPED: at({ subject: 'STP', text: b ? 'stopped' : 'running' }); break
				}
			}
			return effects
		},
	}
}
