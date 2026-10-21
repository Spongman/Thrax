import { stripAssemblyComment } from '../../../core/assembly/text'
import { labelAt } from '../../../core/inspection'
import { registerTokenHover } from '../../../services/assemblyLanguage'
/**
 * Data tips for 6502 sources and disassembly: what a register, number,
 * symbol or mnemonic under the pointer is worth as the program stands.
 */

import type * as Monaco from 'monaco-editor'
import type { DebugInspection, TokenDescription } from '../../contracts'
import { hex2, hex4 } from '../disassemble'
import { NMOS_MODEL, type CpuModel } from '../isa'
import { mos6502InstructionHelp } from '../instructionHelp'
import { MOS6502_LANGUAGE_ID } from './grammar'

const TOKEN = /\$[0-9a-f]+|%[01]+|0x[0-9a-f]+|\d+|[a-z_.@][\w.@]*/gi


const REGISTERS: Readonly<Record<string, string>> = { a: 'A', x: 'X', y: 'Y', sp: 'SP', pc: 'PC', p: 'P' }

export interface Mos6502TipSources {
	model?: CpuModel
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


function memoryLine(state: DebugInspection, address: number): string[] {
	const byte = state.memory.byte(address)
	return byte === undefined ? [] : [`\`[${hex4(address)}]\` = \`${formatValue(byte)}\``]
}

/** What the token at `offset` of `line` is worth, or null where nothing is. */
export function describeMos6502Token(line: string, offset: number, state: DebugInspection, sources: Mos6502TipSources = {}): TokenDescription | null {
	const comment = stripAssemblyComment(line, [';']).length
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
		const help = mos6502InstructionHelp(text, sources.model ?? NMOS_MODEL)
		if (help) return { ...span, ...help }
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
export function registerMos6502DataTips(monaco: typeof Monaco, sources: Mos6502HoverSources, language = MOS6502_LANGUAGE_ID, cpuModel: CpuModel = NMOS_MODEL): Monaco.IDisposable {
	return registerTokenHover(monaco, language, (line, offset) => {
		const state = sources.inspection?.()
		if (!state) return null
		const described = describeMos6502Token(line, offset, state, {
			model: cpuModel,
			value: (name) => sources.values?.()?.get(name),
		})
		return described
	})
}
