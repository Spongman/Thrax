import { stripAssemblyComment } from '../../../core/assembly/text'
import { labelAt, formatIntegerValue, memoryTip } from '../../../core/inspection'
import { betaInstructionHelp } from '../instructionHelp'
import { registerTokenHover } from '../../../services/assemblyLanguage'
/**
 * Data tips for UASM: what a register, symbol, number or macro under the
 * pointer is worth as the program stands. The gutter's disassembly and the
 * source share describeUasmToken; the source adds assigned symbols and macros
 * from the workspace.
 */

import type * as Monaco from 'monaco-editor'
import { formatWord } from '../../../core/format'
import type { DebugInspection, SourceFile, TokenDescription } from '../../contracts'
import { R_BP, R_LP, R_SP, R_XP } from '../registers'
import { betaLibrary } from '../uasm'
import { UASM_LANGUAGE_ID } from './grammar'

const TOKEN = /0x[0-9a-f]+|0b[01]+|\d+|[$.@A-Za-z_][$.@\w]*/gi
const REGISTER = /^[rR]([12]?\d|3[01])$/
const ALIASES: Readonly<Record<string, number>> = { bp: R_BP, lp: R_LP, sp: R_SP, xp: R_XP, BP: R_BP, LP: R_LP, SP: R_SP, XP: R_XP }
const MACRO = /^\s*\.macro\s+([$.@A-Za-z_][$.@\w]*)\s*\(/

export interface UasmTipSources {
	/** A symbol's value where it is not a label, such as `VEC_KBD = 16`. */
	value?(name: string): number | undefined
	/** The `.macro` lines defining `name`, overloads included. */
	macro?(name: string): readonly string[]
}

const formatValue = (value: number) => formatIntegerValue(value, 32)

function registerIndex(name: string): number | undefined {
	const match = REGISTER.exec(name)
	return match ? Number(match[1]) : ALIASES[name]
}

function parseNumber(text: string): number | null {
	const lower = text.toLowerCase()
	if (lower.startsWith('0x')) return Number.parseInt(lower.slice(2), 16) | 0
	if (lower.startsWith('0b')) return Number.parseInt(lower.slice(2), 2) | 0
	return /^\d+$/.test(text) ? Number(text) | 0 : null
}


/** The word stored at `address`, as a paragraph, or nothing outside memory. */
function memoryLine(state: DebugInspection, address: number): string[] {
	const word = state.memory.word(address)
	return memoryTip(address, word, value => formatValue(Number(value)))
}

/** What the token at `offset` of `line` is worth, or null where nothing is. */
export function describeUasmToken(line: string, offset: number, state: DebugInspection, sources: UasmTipSources = {}): TokenDescription | null {
	const comment = stripAssemblyComment(line, ['//']).length
	if (comment >= 0 && offset >= comment) return null
	for (const match of line.matchAll(TOKEN)) {
		const start = match.index
		const text = match[0]
		if (offset < start || offset >= start + text.length) continue
		const span = { start, length: text.length }
		const number = parseNumber(text)
		if (number !== null) {
			// Disassembly writes addresses in hex, so only hex names a label.
			const label = /^0x/i.test(text) ? labelAt(state.labels, number >>> 0) : undefined
			const contents = [`**${label ?? 'Number'}**\n\n\`${formatValue(number)}\``]
			if (!label) return { ...span, contents }
			return { ...span, address: number >>> 0, contents: [...contents, ...memoryLine(state, number >>> 0)] }
		}
		const index = registerIndex(text)
		if (index !== undefined) {
			const id = `R${index}`
			const value = Number(state.registers[id] ?? 0)
			const name = index === 31 ? 'R31 (always 0)' : text.toUpperCase() === id ? id : `${id} (${text.toUpperCase()})`
			return { ...span, register: id, contents: [`**${name}**\n\n\`${formatValue(value)}\``] }
		}
		const address = state.labels.get(text)
		if (address !== undefined) {
			return { ...span, address, contents: [`**Label ${text}**\n\n\`${formatWord(address)}\``, ...memoryLine(state, address)] }
		}
		const value = sources.value?.(text)
		if (value !== undefined) return { ...span, contents: [`**${text}**\n\n\`${formatValue(value)}\``] }
		const macros = sources.macro?.(text) ?? []
		const contents = betaInstructionHelp(text, macros)
		return contents ? { ...span, ...contents } : null
	}
	return null
}

/** Every `.macro` line in `files`, by macro name. */
export function macroTable(files: readonly SourceFile[]): Map<string, string[]> {
	const table = new Map<string, string[]>()
	for (const file of files) {
		for (const line of file.code.split('\n')) {
			const match = MACRO.exec(line)
			if (!match) continue
			const comment = stripAssemblyComment(line, ['//']).length
			const definition = (comment >= 0 ? line.slice(0, comment) : line).trim().replace(/\s+/g, ' ')
			const list = table.get(match[1]) ?? []
			list.push(definition)
			table.set(match[1], list)
		}
	}
	return table
}

let library: Map<string, string[]> | null = null

/** Macros of the bundled beta.uasm. */
export function libraryMacros(): Map<string, string[]> {
	library ??= macroTable([betaLibrary])
	return library
}

export interface UasmHoverSources {
	files(): readonly { title: string, code: string }[]
	inspection?(): DebugInspection
	/** The last assembled program's symbol values. */
	values?(): ReadonlyMap<string, number> | null
}

/** Live data tips in UASM sources. */
export function registerUasmDataTips(monaco: typeof Monaco, sources: UasmHoverSources): Monaco.IDisposable {
	let cachedFiles: readonly { title: string, code: string }[] | null = null
	let cachedMacros = new Map<string, string[]>()
	const macros = () => {
		const files = sources.files()
		if (files !== cachedFiles) {
			cachedFiles = files
			cachedMacros = macroTable(files.map((file) => ({ name: file.title, code: file.code })))
		}
		return cachedMacros
	}
	return registerTokenHover(monaco, UASM_LANGUAGE_ID, (line, offset) => {
		const state = sources.inspection?.()
		if (!state) return null
		const described = describeUasmToken(line, offset, state, {
			value: (name) => sources.values?.()?.get(name),
			macro: (name) => macros().get(name) ?? libraryMacros().get(name) ?? [],
		})
		return described
	})
}
