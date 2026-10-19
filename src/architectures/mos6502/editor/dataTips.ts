/**
 * Data tips for 6502 sources and disassembly: what a register, number,
 * symbol or mnemonic under the pointer is worth as the program stands.
 */

import type * as Monaco from 'monaco-editor'
import type { DebugInspection, TokenDescription } from '../../contracts'
import { hex2, hex4 } from '../disassemble'
import { INSN_BY_NAME, INSN_OPCODE, MODE_NAMES } from '../isa'
import { MOS6502_LANGUAGE_ID } from './grammar'

const TOKEN = /\$[0-9a-f]+|%[01]+|0x[0-9a-f]+|\d+|[a-z_.@][\w.@]*/gi

/** What each instruction does, and the flags it sets. */
const SUMMARIES: Readonly<Record<string, string>> = {
	ADC: 'Add memory and carry to A (NVZC)', AND: 'AND memory into A (NZ)', ASL: 'Shift left, bit 7 into C (NZC)',
	BCC: 'Branch if C is clear', BCS: 'Branch if C is set', BEQ: 'Branch if Z is set', BIT: 'Test A AND memory; N and V from memory (NVZ)',
	BMI: 'Branch if N is set', BNE: 'Branch if Z is clear', BPL: 'Branch if N is clear', BRK: 'Software interrupt through $FFFE (I)',
	BVC: 'Branch if V is clear', BVS: 'Branch if V is set', CLC: 'Clear carry', CLD: 'Clear decimal mode', CLI: 'Enable IRQ',
	CLV: 'Clear overflow', CMP: 'Compare A with memory (NZC)', CPX: 'Compare X with memory (NZC)', CPY: 'Compare Y with memory (NZC)',
	DEC: 'Decrement memory (NZ)', DEX: 'Decrement X (NZ)', DEY: 'Decrement Y (NZ)', EOR: 'Exclusive-OR memory into A (NZ)',
	INC: 'Increment memory (NZ)', INX: 'Increment X (NZ)', INY: 'Increment Y (NZ)', JMP: 'Jump', JSR: 'Push the return address less one and jump',
	LDA: 'Load A (NZ)', LDX: 'Load X (NZ)', LDY: 'Load Y (NZ)', LSR: 'Shift right, bit 0 into C (NZC)', NOP: 'No operation',
	ORA: 'OR memory into A (NZ)', PHA: 'Push A', PHP: 'Push P, with B set', PLA: 'Pull A (NZ)', PLP: 'Pull P',
	ROL: 'Rotate left through C (NZC)', ROR: 'Rotate right through C (NZC)', RTI: 'Return from interrupt: pull P, then PC',
	RTS: 'Return from subroutine: pull PC, plus one', SBC: 'Subtract memory and borrow from A (NVZC)', SEC: 'Set carry',
	SED: 'Set decimal mode', SEI: 'Disable IRQ', STA: 'Store A', STX: 'Store X', STY: 'Store Y', TAX: 'Copy A to X (NZ)',
	TAY: 'Copy A to Y (NZ)', TSX: 'Copy SP to X (NZ)', TXA: 'Copy X to A (NZ)', TXS: 'Copy X to SP', TYA: 'Copy Y to A (NZ)',
}

const REGISTERS: Readonly<Record<string, string>> = { a: 'A', x: 'X', y: 'Y', sp: 'SP', pc: 'PC', p: 'P' }

export interface Mos6502TipSources {
	/** A symbol's value where it is not a label, such as `IO_OUT = $F000`. */
	value?(name: string): number | undefined
}

const formatValue = (value: number) => `${value > 0xFF ? hex4(value) : hex2(value)} (${value})`

function parseNumber(text: string): number | null {
	if (text.startsWith('$')) return Number.parseInt(text.slice(1), 16)
	if (text.startsWith('%')) return Number.parseInt(text.slice(1), 2)
	if (/^0x/i.test(text)) return Number.parseInt(text.slice(2), 16)
	return /^\d+$/.test(text) ? Number(text) : null
}

function labelAt(labels: ReadonlyMap<string, number>, address: number): string | undefined {
	for (const [name, at] of labels) if (at === address) return name
	return undefined
}

function memoryLine(state: DebugInspection, address: number): string[] {
	const byte = state.memory.byte(address)
	return byte === undefined ? [] : [`\`[${hex4(address)}]\` = \`${formatValue(byte)}\``]
}

/** What the token at `offset` of `line` is worth, or null where nothing is. */
export function describeMos6502Token(line: string, offset: number, state: DebugInspection, sources: Mos6502TipSources = {}): TokenDescription | null {
	const comment = line.indexOf(';')
	if (comment >= 0 && offset >= comment) return null
	for (const match of line.matchAll(TOKEN)) {
		const start = match.index
		const text = match[0]
		if (offset < start || offset >= start + text.length) continue
		const span = { start, length: text.length }
		const number = parseNumber(text)
		if (number !== null) {
			const immediate = line[start - 1] === '#'
			const label = number <= 0xFFFF && !immediate ? labelAt(state.labels, number) : undefined
			const contents = [`**${label ?? 'Number'}**\n\n\`${formatValue(number)}\``]
			if (number > 0xFFFF || immediate) return { ...span, contents }
			// An operand names a place in memory, whose byte is worth showing.
			return { ...span, address: number, contents: [...contents, ...memoryLine(state, number)] }
		}
		const register = REGISTERS[text.toLowerCase()]
		if (register !== undefined && !state.labels.has(text)) {
			const value = Number(state.registers[register] ?? 0)
			return { ...span, register, contents: [`**${register}**\n\n\`${formatValue(value)}\``] }
		}
		const insn = INSN_BY_NAME.get(text.toUpperCase())
		if (insn !== undefined) {
			const modes = MODE_NAMES.filter((_, mode) => INSN_OPCODE[insn][mode] >= 0)
			return { ...span, contents: [`**${text.toUpperCase()}**: ${SUMMARIES[text.toUpperCase()]}`, `Modes: ${modes.join(', ')}`] }
		}
		const address = state.labels.get(text)
		if (address !== undefined) {
			return { ...span, address, contents: [`**Label ${text}**\n\n\`${hex4(address)}\``, ...memoryLine(state, address)] }
		}
		const value = sources.value?.(text)
		if (value !== undefined) return { ...span, contents: [`**${text}**\n\n\`${formatValue(value)}\``] }
		return null
	}
	return null
}

export interface Mos6502HoverSources {
	inspection?(): DebugInspection
	/** The last assembled program's symbol values. */
	values?(): ReadonlyMap<string, number> | null
}

/** Live data tips in 6502 sources. */
export function registerMos6502DataTips(monaco: typeof Monaco, sources: Mos6502HoverSources): Monaco.IDisposable {
	return monaco.languages.registerHoverProvider(MOS6502_LANGUAGE_ID, {
		provideHover(model, position) {
			const state = sources.inspection?.()
			if (!state) return null
			const described = describeMos6502Token(model.getLineContent(position.lineNumber), position.column - 1, state, {
				value: (name) => sources.values?.()?.get(name),
			})
			if (!described) return null
			return {
				range: new monaco.Range(position.lineNumber, described.start + 1, position.lineNumber, described.start + described.length + 1),
				contents: described.contents.map((value) => ({ value })),
			}
		},
	})
}
