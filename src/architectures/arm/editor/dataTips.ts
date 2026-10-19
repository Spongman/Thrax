/**
 * Data tips for ARM sources and disassembly: what a register, label, symbol
 * or number under the pointer is worth as the program stands.
 */

import type * as Monaco from 'monaco-editor'
import { formatWord } from '../../../core/format'
import type { DebugInspection, TokenDescription } from '../../contracts'
import { REGISTER_ALIASES } from '../a32/isa'
import { ARM_LANGUAGE_ID } from './grammar'

const TOKEN = /0x[0-9a-f]+|&[0-9a-f]+|0b[01]+|\d+|[A-Za-z_.$][\w.$]*/gi

export interface ArmTipSources {
	/** A symbol's value where it is not a label, such as `.equ COUNT, 3`. */
	value?(name: string): number | undefined
}

const formatValue = (value: number) => `${formatWord(value)} (${value | 0}, unsigned ${value >>> 0})`

function parseNumber(text: string): number | null {
	const lower = text.toLowerCase()
	if (lower.startsWith('0x')) return Number.parseInt(lower.slice(2), 16) | 0
	if (lower.startsWith('&')) return Number.parseInt(lower.slice(1), 16) | 0
	if (lower.startsWith('0b')) return Number.parseInt(lower.slice(2), 2) | 0
	return /^\d+$/.test(text) ? Number(text) | 0 : null
}

function labelAt(labels: ReadonlyMap<string, number>, address: number): string | undefined {
	for (const [name, at] of labels) if (at === address) return name
	return undefined
}

function memoryLine(state: DebugInspection, address: number): string[] {
	const word = state.memory.word(address)
	return word === undefined ? [] : [`\`[${formatWord(address)}]\` = \`${formatValue(word)}\``]
}

/** Where a comment starts on `line`, or its length. */
function commentStart(line: string): number {
	let quoted = false
	for (let index = 0; index < line.length; index++) {
		const character = line[index]
		if (character === '"') quoted = !quoted
		if (quoted) continue
		if (character === '@' || character === ';' || line.startsWith('//', index)) return index
	}
	return line.length
}

/** The register descriptor id a register name reads, R15 as PC. */
export function registerId(name: string): string | undefined {
	const index = REGISTER_ALIASES.get(name.toLowerCase())
	if (index === undefined) return undefined
	return index === 15 ? 'PC' : `R${index}`
}

/** What the token at `offset` of `line` is worth, or null where nothing is. */
export function describeArmToken(line: string, offset: number, state: DebugInspection, sources: ArmTipSources = {}): TokenDescription | null {
	if (offset >= commentStart(line)) return null
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
		const id = registerId(text)
		if (id !== undefined) {
			const value = state.registers[id] ?? 0
			const name = text.toUpperCase() === id ? id : `${id} (${text.toUpperCase()})`
			return { ...span, register: id, contents: [`**${name}**\n\n\`${formatValue(value)}\``] }
		}
		const address = state.labels.get(text)
		if (address !== undefined) {
			return { ...span, address, contents: [`**Label ${text}**\n\n\`${formatWord(address)}\``, ...memoryLine(state, address)] }
		}
		const value = sources.value?.(text)
		if (value !== undefined) return { ...span, contents: [`**${text}**\n\n\`${formatValue(value)}\``] }
		return null
	}
	return null
}

export interface ArmHoverSources {
	inspection?(): DebugInspection
	values?(): ReadonlyMap<string, number> | null
}

/** Live data tips in ARM sources. */
export function registerArmDataTips(monaco: typeof Monaco, sources: ArmHoverSources): Monaco.IDisposable {
	return monaco.languages.registerHoverProvider(ARM_LANGUAGE_ID, {
		provideHover(model, position) {
			const state = sources.inspection?.()
			if (!state) return null
			const described = describeArmToken(model.getLineContent(position.lineNumber), position.column - 1, state, {
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
