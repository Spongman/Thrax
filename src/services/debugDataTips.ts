import { Assembler } from '../core/assembler'
import { bitsToDouble, bitsToSingle, formatDouble, formatSingle } from '../core/coprocessor'
import { formatWord, parseWord } from '../core/format'
import { instructionHelp } from '../core/isaDocs'
import { REGISTER_NAMES } from '../core/registers'
import type { MemoryView, Registers } from '../core/types'

export interface DebugDataTipState {
	registers: Registers
	memory: MemoryView
	fpRegisters: number[]
	/** Labels of the assembled program, which reach across files. */
	labels: Map<string, number>
}

/** One token of a line, and what it is worth. */
export interface TokenDescription {
	start: number
	length: number
	/** Markdown, one paragraph per entry, in the order they are shown. */
	contents: string[]
	/** The register this token names, for panels that light one. */
	register?: string
	/** The address this token resolves to, for panels that light one. */
	address?: number
}

interface MonacoLike {
	Range: new (startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number) => unknown
	languages: {
		registerHoverProvider: (languageId: string, provider: {
			provideHover: (model: MonacoModel, position: MonacoPosition) => MonacoHover | null
		}) => { dispose: () => void }
	}
}

interface MonacoModel {
	getLineContent: (lineNumber: number) => string
	getValue: () => string
}

interface MonacoPosition {
	lineNumber: number
	column: number
}

interface MonacoHover {
	range: unknown
	contents: Array<{ value: string }>
}

function formatValue(value: number) {
	const unsigned = value >>> 0
	return `${formatWord(unsigned)} (${value | 0}, unsigned ${unsigned})`
}

function getRegisterValue(register: string, registers: Registers) {
	const normalized = register.toLowerCase()
	if (/^\$\d+$/.test(normalized)) {
		const alias = REGISTER_NAMES[Number(normalized.slice(1))]
		if (alias) return { name: alias, value: registers[alias] ?? 0 }
	}
	return { name: normalized, value: registers[normalized] ?? 0 }
}

/** Hover contents for `$f0`-`$f31`, including the double a pair holds. */
function getFpRegisterContents(index: number, fpRegisters: number[]): string[] {
	const bits = fpRegisters[index] ?? 0
	const contents = [
		`**$f${index}**`,
		`single \`${formatSingle(bitsToSingle(bits))}\``,
		`bits \`${formatWord(bits)}\``,
	]
	if (index % 2 === 0) {
		contents.push(`double \`${formatDouble(bitsToDouble(bits, fpRegisters[index + 1] ?? 0))}\``)
	}
	return contents
}

function getTokenRange(monaco: MonacoLike, position: MonacoPosition, start: number, length: number) {
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
		const value = state.memory.words.get(address >>> 2) ?? 0
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
				contents: getFpRegisterContents(Number(fpRegister[1]), state.fpRegisters),
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
		if (help) return { start, length: match[0].length, contents: help }
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
export function registerMipsDebugDataTips(monaco: MonacoLike, getState: () => DebugDataTipState) {
	let cachedCode = ''
	let cachedLabels = new Map<string, number>()

	const getLabels = (code: string) => {
		if (code === cachedCode) return cachedLabels
		cachedCode = code
		try {
			cachedLabels = new Assembler(code).assemble().program.labels
		} catch {
			cachedLabels = new Map()
		}
		return cachedLabels
	}

	return monaco.languages.registerHoverProvider('mips', {
		provideHover(model, position) {
			const state = getState()
			// The hovered file is assembled on its own, so a label it defines
			// resolves as it is typed; the program's own labels cover the rest,
			// which is where a label defined in another file comes from.
			const own = getLabels(model.getValue())
			const described = describeToken(
				model.getLineContent(position.lineNumber),
				position.column - 1,
				state,
				(name) => own.get(name) ?? state.labels.get(name),
			)
			if (!described) return null
			return {
				range: getTokenRange(monaco, position, described.start, described.length),
				contents: described.contents.map((value) => ({ value })),
			}
		},
	})
}
