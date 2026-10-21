import { registerTokenHover } from '../../../services/assemblyLanguage'
import type * as Monaco from 'monaco-editor'
import { assembleMips } from '../assembler'
import { formatWord, parseWord } from '../../../core/format'
import { bitsToDouble, bitsToSingle, formatDouble, formatSingle } from '../../../core/ieee754'
import { instructionHelp } from '../core/isaDocs'
import { REGISTER_NAMES } from '../core/registers'
import type { DebugInspection, Registers, TokenDescription } from '../../contracts'

/** Registers (FPU ones included, as `$f0`...), memory and labels as they stand. */
export type DebugDataTipState = DebugInspection

function formatValue(value: number) {
	const unsigned = value >>> 0
	return `${formatWord(unsigned)} (${value | 0}, unsigned ${unsigned})`
}

function getRegisterValue(register: string, registers: Registers) {
	const normalized = register.toLowerCase()
	if (/^\$\d+$/.test(normalized)) {
		const alias = REGISTER_NAMES[Number(normalized.slice(1))]
		if (alias) return { name: alias, value: Number(registers[alias] ?? 0) }
	}
	return { name: normalized, value: Number(registers[normalized] ?? 0) }
}

/** Hover contents for `$f0`-`$f31`, including the double a pair holds. */
function getFpRegisterContents(index: number, registers: Registers): string[] {
	const bits = Number(registers[`$f${index}`] ?? 0)
	const contents = [
		`**$f${index}**`,
		`single \`${formatSingle(bitsToSingle(bits))}\``,
		`bits \`${formatWord(bits)}\``,
	]
	if (index % 2 === 0) {
		contents.push(`double \`${formatDouble(bitsToDouble(bits, Number(registers[`$f${index + 1}`] ?? 0)))}\``)
	}
	return contents
}

function getTokenRange(monaco: typeof Monaco, position: Monaco.Position, start: number, length: number) {
	return new monaco.Range(position.lineNumber, start + 1, position.lineNumber, start + length + 1)
}

/**
 * What the token at `offset` of `line` is worth right now, and where in the
 * line it sits.
 *
 * This is the whole of the data tip, kept apart from Monaco because the same
 * question is asked of text Monaco knows nothing about: the disassembly the
 * gutter draws beside a source line is not in any model, and a register there
 * has to report the same value it reports in the source.
 */
export function describeToken(
	line: string,
	offset: number,
	state: DebugDataTipState,
	labelOf: (name: string) => number | undefined = (name) => state.labels.get(name),
): TokenDescription | null {
	const memoryMatch = /(-?(?:0x[0-9a-f]+|\d+)|[A-Za-z_]\w*)?\s*\(\s*(\$(?:[A-Za-z]\w*|\d+))\s*\)/ig
	for (const match of line.matchAll(memoryMatch)) {
		const start = match.index ?? 0
		if (offset < start || offset > start + match[0].length) continue
		const offsetText = match[1]
		const base = getRegisterValue(match[2], state.registers)
		const displacement = offsetText ? (parseWord(offsetText) ?? labelOf(offsetText) ?? 0) : 0
		const address = (base.value + displacement) >>> 0
		const value = state.memory.word(address) ?? 0
		return {
			start,
			length: match[0].length,
			register: base.name,
			address,
			contents: [
				'**Effective address**',
				`\`${formatWord(address)}\` = \`${formatValue(value)}\``,
				`base \`${base.name}\` ${formatValue(base.value)} + offset ${formatValue(displacement)}`,
			],
		}
	}

	const registerMatch = /\$(?:[A-Za-z]\w*|\d+)/g
	for (const match of line.matchAll(registerMatch)) {
		const start = match.index ?? 0
		if (offset < start || offset > start + match[0].length) continue
		const fpRegister = /^\$f(\d{1,2})$/i.exec(match[0])
		if (fpRegister && Number(fpRegister[1]) < 32) {
			return {
				start,
				length: match[0].length,
				register: `$f${Number(fpRegister[1])}`,
				contents: getFpRegisterContents(Number(fpRegister[1]), state.registers),
			}
		}
		const register = getRegisterValue(match[0], state.registers)
		return {
			start,
			length: match[0].length,
			register: register.name,
			contents: [`**${register.name}**\n\n\`${formatValue(register.value)}\``],
		}
	}

	// A word that names an instruction is one, whatever else it may also name:
	// the lexer resolves a bare word the same way, so a mnemonic wins over a
	// label spelled like it (`lexer.ts:140`).  The format suffix belongs to the
	// mnemonic, so `add.s` is one word and not `add`.
	const mnemonicMatch = /[A-Za-z][\w.]*/g
	for (const match of line.matchAll(mnemonicMatch)) {
		const start = match.index ?? 0
		if (offset < start || offset > start + match[0].length) continue
		const help = instructionHelp(match[0])
		if (help) return { start, length: match[0].length, ...help }
	}

	const tokenMatch = /-?(?:0x[0-9a-f]+|\d+)|[A-Za-z_]\w*/ig
	for (const match of line.matchAll(tokenMatch)) {
		const start = match.index ?? 0
		if (offset < start || offset > start + match[0].length) continue
		const number = parseWord(match[0])
		if (number !== null) {
			return { start, length: match[0].length, contents: [`**Immediate**\n\n\`${formatValue(number)}\``] }
		}
		const labelAddress = labelOf(match[0])
		if (labelAddress !== undefined) {
			return {
				start,
				length: match[0].length,
				address: labelAddress,
				contents: [`**Label ${match[0]}**\n\n\`${formatWord(labelAddress)}\``],
			}
		}
	}
	return null
}

/**
 * Installs live MIPS register, label, literal, and address hover data tips,
 * and the instruction docs, which are the one tip that does not depend on
 * where the program has got to.
 */
export function registerMipsDebugDataTips(monaco: typeof Monaco, getState: () => DebugDataTipState) {
	let cachedCode = ''
	let cachedLabels = new Map<string, number>()

	const getLabels = (code: string) => {
		if (code === cachedCode) return cachedLabels
		cachedCode = code
		try {
			cachedLabels = assembleMips(code).program.labels
		} catch {
			cachedLabels = new Map()
		}
		return cachedLabels
	}


	return registerTokenHover(monaco, 'mips', (line, offset, model) => {
		const state = getState()
		// The hovered file resolves labels as they are typed; program labels cover includes.
		const own = getLabels(model.getValue())
		return describeToken(line, offset, state, (name) => own.get(name) ?? state.labels.get(name))
	})
}
