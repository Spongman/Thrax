import { stripAssemblyComment } from '../../../core/assembly/text'
import { labelAt, formatIntegerValue, inspectInteger, memoryTip } from '../../../core/inspection'
import { a64InstructionHelp } from '../instructionHelp'
import { registerTokenHover } from '../../../services/assemblyLanguage'
/**
 * Data tips for A64 sources and disassembly: what a register, address,
 * symbol or number under the pointer is worth as the program stands. X
 * registers are shown at their full 64 bits.
 */

import type * as Monaco from 'monaco-editor'
import { formatAddress } from '../../../core/format'
import type { DebugInspection, RegisterValue, TokenDescription } from '../../contracts'
import { fpRegisterByName, registerByName } from '../a64/assembler/operands'
import { bitsToNumber, DOUBLE, SINGLE } from '../shared/fp'
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
export const formatValue64 = (value: bigint) => formatIntegerValue(value, 64)

const formatValue32 = (value: number) => formatIntegerValue(value, 32)


/** The doubleword stored at `address`, as a paragraph, or nothing outside memory. */
function memoryLine(state: DebugInspection, address: number): string[] {
	const value = address % 4 === 0 ? inspectInteger(state.memory, address, 8) : undefined
	return value === undefined
		? memoryTip(address, state.memory.word(address), value => formatValue32(Number(value)))
		: memoryTip(address, value, value => formatValue64(BigInt(value)))
}

/** Bn, Hn, Sn, Dn or Qn: the float an S or D holds, and the bits. */
function fpRegisterValue(name: string, state: DebugInspection): { id: string, title: string, text: string } | null {
	const register = fpRegisterByName(name)
	if (!register) return null
	const id = `V${register.n}`
	const low = BigInt(Number(state.registers[id] ?? 0) >>> 0) | (BigInt(Number(state.registers[`${id}:hi`] ?? 0) >>> 0) << 32n)
	const title = `${name.toUpperCase()} (${id})`
	const hex = (value: bigint, bytes: number) => `0x${value.toString(16).toUpperCase().padStart(bytes * 2, '0')}`
	switch (register.size) {
		case 4: return { id, title, text: `${bitsToNumber(low & 0xFFFF_FFFFn, SINGLE)} (${hex(low & 0xFFFF_FFFFn, 4)})` }
		case 8: return { id, title, text: `${bitsToNumber(low, DOUBLE)} (${hex(low, 8)})` }
		// The panel holds the low doubleword; a Q's upper half is in the history alone.
		case 16: return { id, title, text: `low doubleword ${hex(low, 8)}` }
		default: return { id, title, text: hex(low & ((1n << BigInt(register.size * 8)) - 1n), register.size) }
	}
}

/** A register's value and descriptor id, by any name it goes by. */
function registerValue(name: string, state: DebugInspection): { id: string, title: string, text: string } | null {
	const register = registerByName(name)
	if (!register) return fpRegisterValue(name, state)
	if (register.zr) return { id: '', title: `${name.toLowerCase()} (always 0)`, text: register.wide ? formatValue64(0n) : formatValue32(0) }
	const id = register.sp ? 'SP' : `X${register.n}`
	const value = asBig(state.registers[id])
	if (!register.wide) return { id: register.sp ? 'SP' : `W${register.n}`, title: name.toUpperCase(), text: formatValue32(Number(value & 0xFFFF_FFFFn)) }
	const title = name.toUpperCase() === id ? id : `${id} (${name.toUpperCase()})`
	return { id, title, text: formatValue64(value) }
}

/** What the token at `offset` of `line` is worth, or null where nothing is. */
export function describeA64Token(line: string, offset: number, state: DebugInspection, sources: A64TipSources = {}): TokenDescription | null {
	const comment = stripAssemblyComment(line, ['//']).length
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
		const effective = BigInt.asUintN(64, asBig(state.registers[id]) + displacement)
		if (effective > BigInt(Number.MAX_SAFE_INTEGER)) return { start, length: match[0].length, register: id, contents: ['**Effective address**', `0x${effective.toString(16).toUpperCase()}`] }
		const address = Number(effective)
		return {
			start, length: match[0].length, register: id, address,
			contents: ['**Effective address**', `\`${formatAddress(address)}\``, ...memoryLine(state, address)],
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
			return { ...span, address, contents: [`**Label ${text}**\n\n\`${formatAddress(address)}\``, ...memoryLine(state, address)] }
		}
		const value = sources.value?.(text)
		if (value !== undefined) return { ...span, contents: [`**${text}**\n\n\`${formatValue64(BigInt(Math.trunc(value)))}\``] }
		const contents = a64InstructionHelp(text)
		return contents ? { ...span, ...contents } : null
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
	return registerTokenHover(monaco, A64_LANGUAGE_ID, (line, offset) => {
		const state = sources.inspection?.()
		if (!state) return null
		const described = describeA64Token(line, offset, state, {
			value: (name) => sources.values?.()?.get(name),
		})
		return described
	})
}
