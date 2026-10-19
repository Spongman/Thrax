/**
 * Data tips for Z80 source and disassembly: what a register, symbol or number
 * under the pointer is worth as the program stands.
 */

import type * as Monaco from 'monaco-editor'
import type { DebugInspection, TokenDescription } from '../../contracts'
import { parseZ80Number } from '../asm/tokenizer'
import { hex16, hex8 } from '../disassemble'
import { Z80_LANGUAGE_ID } from './grammar'

const TOKEN = /(?:\$|#)[0-9a-f]+|%[01]+|[0-9][0-9a-z_]*|[A-Za-z_.?@][\w.?@]*'?/gi

/** Register names as written, to the descriptor ids they read. */
const REGISTERS: Readonly<Record<string, string>> = {
	A: 'A', F: 'F', B: 'B', C: 'C', D: 'D', E: 'E', H: 'H', L: 'L', I: 'I', R: 'R',
	AF: 'AF', BC: 'BC', DE: 'DE', HL: 'HL', IX: 'IX', IY: 'IY', SP: 'SP', PC: 'PC',
	'AF\'': 'AF2', 'BC\'': 'BC2', 'DE\'': 'DE2', 'HL\'': 'HL2',
}
const HALVES: Readonly<Record<string, [string, number]>> = { IXH: ['IX', 8], IXL: ['IX', 0], IYH: ['IY', 8], IYL: ['IY', 0] }
const WIDE = new Set(['AF', 'BC', 'DE', 'HL', 'IX', 'IY', 'SP', 'PC', 'AF2', 'BC2', 'DE2', 'HL2'])

export interface Z80TipSources {
	/** A symbol's value where it is not a label, such as an EQU. */
	value?(name: string): number | undefined
}

const formatByte = (value: number) => `${hex8(value)} (${value & 0xFF}, signed ${(value << 24) >> 24})`
const formatWord = (value: number) => `${hex16(value)} (${value & 0xFFFF}, signed ${(value << 16) >> 16})`
const formatValue = (value: number) => value >= -128 && value <= 255 ? formatByte(value) : formatWord(value)

/** The byte and word stored at `address`, as a paragraph, or nothing outside memory. */
function memoryLine(state: DebugInspection, address: number): string[] {
	const low = state.memory.byte(address)
	if (low === undefined) return []
	const high = state.memory.byte((address + 1) & 0xFFFF) ?? 0
	return [`\`(${hex16(address)})\` = \`${hex8(low)}\`, word \`${hex16(low | (high << 8))}\``]
}

function labelAt(labels: ReadonlyMap<string, number>, address: number): string | undefined {
	for (const [name, at] of labels) if (at === address) return name
	return undefined
}

/** What the token at `offset` of `line` is worth, or null where nothing is. */
export function describeZ80Token(line: string, offset: number, state: DebugInspection, sources: Z80TipSources = {}): TokenDescription | null {
	const comment = line.indexOf(';')
	if (comment >= 0 && offset >= comment) return null
	for (const match of line.matchAll(TOKEN)) {
		const start = match.index
		const text = match[0]
		if (offset < start || offset >= start + text.length) continue
		const span = { start, length: text.length }
		if (/^[$#%0-9]/.test(text)) {
			const number = parseZ80Number(text)
			if (Number.isNaN(number)) return null
			// Disassembly writes addresses as four hex digits, which name a label.
			const label = text.length === 5 && text.startsWith('$') ? labelAt(state.labels, number) : undefined
			const contents = [`**${label ?? 'Number'}**\n\n\`${formatValue(number)}\``]
			if (!label) return { ...span, contents }
			return { ...span, address: number, contents: [...contents, ...memoryLine(state, number)] }
		}
		const upper = text.toUpperCase()
		const half = HALVES[upper]
		if (half) {
			const value = (Number(state.registers[half[0]] ?? 0) >> half[1]) & 0xFF
			return { ...span, register: half[0], contents: [`**${upper}**\n\n\`${formatByte(value)}\``] }
		}
		const id = REGISTERS[upper]
		if (id !== undefined) {
			const value = Number(state.registers[id] ?? 0)
			const contents = [`**${upper}**\n\n\`${WIDE.has(id) ? formatWord(value) : formatByte(value)}\``]
			// A pair that holds an address shows what is there.
			if (WIDE.has(id) && id !== 'AF' && id !== 'AF2') contents.push(...memoryLine(state, value & 0xFFFF))
			return { ...span, register: id, contents }
		}
		const address = state.labels.get(text)
		if (address !== undefined) {
			return { ...span, address, contents: [`**Label ${text}**\n\n\`${hex16(address)}\``, ...memoryLine(state, address)] }
		}
		const value = sources.value?.(text)
		if (value !== undefined) return { ...span, contents: [`**${text}**\n\n\`${formatValue(value)}\``] }
		return null
	}
	return null
}

export interface Z80HoverSources {
	inspection?(): DebugInspection
	/** The last assembled program's symbol values. */
	values?(): ReadonlyMap<string, number> | null
}

/** Live data tips in Z80 sources. */
export function registerZ80DataTips(monaco: typeof Monaco, sources: Z80HoverSources): Monaco.IDisposable {
	return monaco.languages.registerHoverProvider(Z80_LANGUAGE_ID, {
		provideHover(model, position) {
			const state = sources.inspection?.()
			if (!state) return null
			const described = describeZ80Token(model.getLineContent(position.lineNumber), position.column - 1, state, {
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
