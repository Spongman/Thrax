/**
 * Data tips for A64 sources and disassembly: what a register, address,
 * symbol or number under the pointer is worth as the program stands. X
 * registers are shown at their full 64 bits.
 */

import type * as Monaco from 'monaco-editor'
import { formatRegister, formatWord } from '../../../core/format'
import type { DebugInspection, RegisterValue, TokenDescription } from '../../contracts'
import { registerByName } from '../a64/assembler/operands'
import { parseA64Number } from '../a64/assembler/tokenizer'
import { A64_LANGUAGE_ID } from './grammar'

const TOKEN = /0x[0-9a-f]+|0b[01]+|\d+|[A-Za-z_.$][\w.$]*/gi
/** `[xN]` or `[xN, #offset]`. */
const ADDRESS = /\[\s*([A-Za-z]+\d*)\s*(?:,\s*#?(-?(?:0x[0-9a-f]+|\d+)))?\s*\]/gi

export interface A64TipSources {
	/** A symbol's value where it is not a label, such as `.equ COUNT, 3`. */
	value?(name: string): number | undefined
}

const asBig = (value: RegisterValue | undefined) => typeof value === 'bigint' ? value : BigInt(value ?? 0)

/** A 64-bit value in hex, then as signed and unsigned decimal. */
export function formatValue64(value: bigint): string {
	const unsigned = BigInt.asUintN(64, value)
	return `${formatRegister(unsigned, 64)} (${BigInt.asIntN(64, unsigned)}, unsigned ${unsigned})`
}

const formatValue32 = (value: number) => `${formatWord(value)} (${value | 0}, unsigned ${value >>> 0})`

function labelAt(labels: ReadonlyMap<string, number>, address: number): string | undefined {
	for (const [name, at] of labels) if (at === address) return name
	return undefined
}

/** The doubleword stored at `address`, as a paragraph, or nothing outside memory. */
function memoryLine(state: DebugInspection, address: number): string[] {
	const low = state.memory.word(address)
	const high = state.memory.word(address + 4)
	if (low === undefined) return []
	if (address % 4 !== 0 || high === undefined) return [`\`[${formatWord(address)}]\` = \`${formatValue32(low)}\``]
	return [`\`[${formatWord(address)}]\` = \`${formatValue64((BigInt(high) << 32n) | BigInt(low))}\``]
}

/** A register's value and descriptor id, by any name it goes by. */
function registerValue(name: string, state: DebugInspection): { id: string, title: string, text: string } | null {
	const register = registerByName(name)
	if (!register) return null
	if (register.zr) return { id: '', title: `${name.toLowerCase()} (always 0)`, text: register.wide ? formatValue64(0n) : formatValue32(0) }
	const id = register.sp ? 'SP' : `X${register.n}`
	const value = asBig(state.registers[id])
	if (!register.wide) return { id: register.sp ? 'SP' : `W${register.n}`, title: name.toUpperCase(), text: formatValue32(Number(value & 0xFFFF_FFFFn)) }
	const title = name.toUpperCase() === id ? id : `${id} (${name.toUpperCase()})`
	return { id, title, text: formatValue64(value) }
}

/** What the token at `offset` of `line` is worth, or null where nothing is. */
export function describeA64Token(line: string, offset: number, state: DebugInspection, sources: A64TipSources = {}): TokenDescription | null {
	const comment = line.indexOf('//')
	if (comment >= 0 && offset >= comment) return null
	for (const match of line.matchAll(ADDRESS)) {
		const start = match.index
		if (offset < start || offset >= start + match[0].length) continue
		// The base register itself gets its own tip.
		const baseStart = line.indexOf(match[1], start)
		if (offset >= baseStart && offset < baseStart + match[1].length) break
		const base = registerByName(match[1])
		if (!base?.wide || base.zr) break
		const id = base.sp ? 'SP' : `X${base.n}`
		const displacement = match[2] ? BigInt(match[2].startsWith('-') ? -parseA64Number(match[2].slice(1))! : parseA64Number(match[2])!) : 0n
		const address = Number(BigInt.asUintN(64, asBig(state.registers[id]) + displacement))
		return {
			start, length: match[0].length, register: id, address,
			contents: ['**Effective address**', `\`${formatWord(address)}\``, ...memoryLine(state, address)],
		}
	}
	for (const match of line.matchAll(TOKEN)) {
		const start = match.index
		const text = match[0]
		if (offset < start || offset >= start + text.length) continue
		const span = { start, length: text.length }
		const number = /^[0-9]/.test(text) ? parseA64Number(text) : null
		if (number !== null) {
			// Disassembly writes addresses in hex, so only hex names a label.
			const label = /^0x/i.test(text) && number <= BigInt(Number.MAX_SAFE_INTEGER) ? labelAt(state.labels, Number(number)) : undefined
			const contents = [`**${label ?? 'Number'}**\n\n\`${formatValue64(number)}\``]
			if (!label) return { ...span, contents }
			return { ...span, address: Number(number), contents: [...contents, ...memoryLine(state, Number(number))] }
		}
		const register = registerValue(text, state)
		if (register) return { ...span, ...(register.id ? { register: register.id } : {}), contents: [`**${register.title}**\n\n\`${register.text}\``] }
		const address = state.labels.get(text)
		if (address !== undefined) {
			return { ...span, address, contents: [`**Label ${text}**\n\n\`${formatWord(address)}\``, ...memoryLine(state, address)] }
		}
		const value = sources.value?.(text)
		if (value !== undefined) return { ...span, contents: [`**${text}**\n\n\`${formatValue64(BigInt(Math.trunc(value)))}\``] }
		return null
	}
	return null
}

export interface A64HoverSources {
	inspection?(): DebugInspection
	/** The last assembled program's symbol values. */
	values?(): ReadonlyMap<string, number> | null
}

/** Live data tips in A64 sources. */
export function registerA64DataTips(monaco: typeof Monaco, sources: A64HoverSources): Monaco.IDisposable {
	return monaco.languages.registerHoverProvider(A64_LANGUAGE_ID, {
		provideHover(model, position) {
			const state = sources.inspection?.()
			if (!state) return null
			const described = describeA64Token(model.getLineContent(position.lineNumber), position.column - 1, state, {
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
