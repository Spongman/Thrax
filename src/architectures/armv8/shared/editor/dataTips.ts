import { stripAssemblyComment } from '../../../../core/assembly/text'
import { labelAt, formatIntegerValue, memoryTip } from '../../../../core/inspection'
import type { InstructionHelp } from '../../../../core/instructionHelp'
import { armInstructionHelp } from '../instructionHelp'
import { registerTokenHover } from '../../../../services/assemblyLanguage'
/**
 * Data tips for ARM sources and disassembly: what a register, label, symbol
 * or number under the pointer is worth as the program stands.
 */

import type * as Monaco from 'monaco-editor'
import { formatWord } from '../../../../core/format'
import type { DebugInspection, TokenDescription } from '../../../contracts'
import { ARCH_V8, REGISTER_ALIASES } from '../a32/isa'
import { bitsToDouble, bitsToSingle, formatDouble, formatSingle } from '../../../../core/ieee754'
import { ARM_LANGUAGE_ID } from './grammar'

const TOKEN = /0x[0-9a-f]+|&[0-9a-f]+|0b[01]+|\d+|[A-Za-z_.$][\w.$]*/gi

export interface ArmTipSources {
	arch?: number
	instructionHelp?(name: string): InstructionHelp | null
	/** A symbol's value where it is not a label, such as `.equ COUNT, 3`. */
	value?(name: string): number | undefined
}

const formatValue = (value: number) => formatIntegerValue(value, 32)

function parseNumber(text: string): number | null {
	const lower = text.toLowerCase()
	if (lower.startsWith('0x')) return Number.parseInt(lower.slice(2), 16) | 0
	if (lower.startsWith('&')) return Number.parseInt(lower.slice(1), 16) | 0
	if (lower.startsWith('0b')) return Number.parseInt(lower.slice(2), 2) | 0
	return /^\d+$/.test(text) ? Number(text) | 0 : null
}


function memoryLine(state: DebugInspection, address: number): string[] {
	const word = state.memory.word(address)
	return memoryTip(address, word, value => formatValue(Number(value)))
}

/** Where a comment starts on `line`, or its length. */
const commentStart = (line: string) => stripAssemblyComment(line, ['@', ';', '//']).length

/** The register descriptor id a register name reads, R15 as PC. */
export function registerId(name: string): string | undefined {
	const index = REGISTER_ALIASES.get(name.toLowerCase())
	if (index === undefined) return undefined
	return index === 15 ? 'PC' : `R${index}`
}

/** An S or D register of the ARMv8 profile's VFP: its value as a float and its bits. */
function describeFpRegister(text: string, state: DebugInspection): { register: string, contents: string[] } | null {
	const match = /^([sd])(\d+)$/i.exec(text)
	if (!match) return null
	const index = Number(match[2])
	const bits = (id: string) => Number(state.registers[id] ?? 0) >>> 0
	const hex = (value: number) => value.toString(16).padStart(8, '0')
	if (match[1].toLowerCase() === 's') {
		if (index > 31) return null
		const value = bits(`S${index}`)
		return { register: `S${index}`, contents: [`**S${index}**\n\n\`${formatSingle(bitsToSingle(value))}\` (\`0x${hex(value)}\`)`] }
	}
	if (index > 15) return null
	const [low, high] = [bits(`S${2 * index}`), bits(`S${2 * index + 1}`)]
	return { register: `S${2 * index}`, contents: [`**D${index}** (S${2 * index + 1}:S${2 * index})\n\n\`${formatDouble(bitsToDouble(low, high))}\` (\`0x${hex(high)}${hex(low)}\`)`] }
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
			// A32 registers are 32 bits wide.
			const value = Number(state.registers[id] ?? 0)
			const name = text.toUpperCase() === id ? id : `${id} (${text.toUpperCase()})`
			return { ...span, register: id, contents: [`**${name}**\n\n\`${formatValue(value)}\``] }
		}
		if (sources.arch === ARCH_V8) {
			const fp = describeFpRegister(text, state)
			if (fp) return { ...span, ...fp }
			if (text.toLowerCase() === 'fpscr' && state.registers.FPSCR !== undefined) {
				return { ...span, register: 'FPSCR', contents: [`**FPSCR**\n\n\`${formatValue(Number(state.registers.FPSCR))}\``] }
			}
		}
		const address = state.labels.get(text)
		if (address !== undefined) {
			return { ...span, address, contents: [`**Label ${text}**\n\n\`${formatWord(address)}\``, ...memoryLine(state, address)] }
		}
		const value = sources.value?.(text)
		if (value !== undefined) return { ...span, contents: [`**${text}**\n\n\`${formatValue(value)}\``] }
		const contents = sources.instructionHelp ? sources.instructionHelp(text) : armInstructionHelp(text, sources.arch)
		return contents ? { ...span, ...contents } : null
	}
	return null
}

export interface ArmHoverSources {
	inspection?(): DebugInspection
	values?(): ReadonlyMap<string, number> | null
}

/** Live data tips in ARM sources. */
export function registerArmDataTips(monaco: typeof Monaco, sources: ArmHoverSources, arch?: number, language = ARM_LANGUAGE_ID): Monaco.IDisposable {
	return registerTokenHover(monaco, language, (line, offset) => {
		const state = sources.inspection?.()
		if (!state) return null
		const described = describeArmToken(line, offset, state, {
			arch,
			value: (name) => sources.values?.()?.get(name),
		})
		return described
	})
}
