/**
 * Lines of Z80 source to the shared engine's statements: labels (`name:`, or
 * a name in column 1), `EQU`, `=`, `DEFL`, `ORG`, the data directives,
 * `ALIGN`, `END`, and macros, which expand here as tokens so a parameter may
 * stand for a register as well as a value.
 */

import { StatementKind, type Statement } from '../../../core/assembly/assembler'
import type { Provenance } from '../../../core/assembly/emitter'
import { evaluate, ExprKind, Op, type Expr } from '../../../core/assembly/expressions'
import { location, type ExpansionFrame } from '../../../core/assembly/macroEngine'
import { TokenKind, positionOf, type Position, type Token } from '../../../core/assembly/tokens'
import { AssemblyError } from '../../../core/diagnostics'
import type { Diagnostic } from '../../contracts'
import { MNEMONICS, REGISTER_NAMES, emitEncoding, encodeInstruction, expressionOf, parseOperand, splitOperands } from './encoder'
import { z80Arithmetic } from './arithmetic'

const { Label, Assign, Origin, Align, Fragment } = StatementKind

const DATA_BYTES = new Set(['DB', 'DEFB', 'DM', 'DEFM', 'BYTE'])
const DATA_WORDS = new Set(['DW', 'DEFW', 'WORD'])
const DATA_SPACE = new Set(['DS', 'DEFS', 'BLOCK'])
const MACRO_START = new Set(['MACRO'])
const MACRO_END = new Set(['ENDM', 'ENDMACRO'])

/** Directives, which may also be written with a leading dot. */
export const DIRECTIVES: ReadonlySet<string> = new Set([
	'ORG', 'EQU', 'DEFL', 'ALIGN', 'END', 'INCLUDE',
	...DATA_BYTES, ...DATA_WORDS, ...DATA_SPACE, ...MACRO_START, ...MACRO_END,
])

/** Nested macro expansion stops here. */
const MAX_MACRO_DEPTH = 64

interface Macro {
	name: string
	parameters: string[]
	body: Token[][]
	at: Position
}

export interface ParseResult {
	statements: Statement[]
	diagnostics: Diagnostic[]
}

/** The upper-case keyword a token spells, with an optional leading dot dropped. */
function keyword(token: Token | undefined): string {
	if (!token || token.kind !== TokenKind.Identifier) return ''
	const upper = token.text.toUpperCase()
	const bare = upper.startsWith('.') ? upper.slice(1) : upper
	return DIRECTIVES.has(bare) ? bare : upper
}

const isOperator = (token: Token | undefined, text: string) => token !== undefined && token.kind === TokenKind.Operator && token.text === text

/** Splits the token stream into lines, dropping empty ones. */
function linesOf(tokens: readonly Token[]): Token[][] {
	const lines: Token[][] = []
	let current: Token[] = []
	for (const token of tokens) {
		if (token.kind === TokenKind.Newline) {
			if (current.length) lines.push(current)
			current = []
		} else {
			current.push(token)
		}
	}
	if (current.length) lines.push(current)
	return lines
}

export function parseZ80(tokens: readonly Token[]): ParseResult {
	return new Parser().parse(tokens)
}

class Parser {
	private readonly statements: Statement[] = []
	private readonly diagnostics: Diagnostic[] = []
	private readonly macros = new Map<string, Macro>()
	private readonly labels = new Set<string>()
	/** EQU values known while parsing, for a DS count with a fill. */
	private readonly constants = new Map<string, number>()
	/** The last label not starting with a dot, which local labels hang off. */
	private global = ''
	private readonly frames: ExpansionFrame[] = []
	/** Each macro expansion's own prefix for its dot labels. */
	private local: string | null = null
	private expansions = 0
	private ended = false

	parse(tokens: readonly Token[]): ParseResult {
		const lines = linesOf(tokens)
		this.block(lines, null)
		return { statements: this.statements, diagnostics: this.diagnostics }
	}

	/** Lines in order; `invocation` is where a macro expanding them was used. */
	private block(lines: Token[][], invocation: Position | null) {
		for (let index = 0; index < lines.length && !this.ended; index++) {
			const line = lines[index]
			try {
				const definition = this.macroHeader(line)
				if (definition) {
					index = this.collectMacro(lines, index, definition)
					continue
				}
				this.line(line, invocation)
			} catch (error) {
				if (!(error instanceof AssemblyError)) throw error
				this.diagnostics.push(error.diagnostic)
			}
		}
	}

	/** `MACRO name args` or `name MACRO args`: the name, parameters and position. */
	private macroHeader(line: Token[]): { name: Token, parameters: Token[] } | null {
		if (MACRO_START.has(keyword(line[0])) && line[1]?.kind === TokenKind.Identifier) return { name: line[1], parameters: line.slice(2) }
		if (line[0]?.kind === TokenKind.Identifier && MACRO_START.has(keyword(line[1]))) return { name: line[0], parameters: line.slice(2) }
		// `name: MACRO` too.
		if (line[0]?.kind === TokenKind.Identifier && isOperator(line[1], ':') && MACRO_START.has(keyword(line[2]))) return { name: line[0], parameters: line.slice(3) }
		return null
	}

	private collectMacro(lines: Token[][], start: number, header: { name: Token, parameters: Token[] }): number {
		const { name, parameters } = header
		const at = positionOf(name)
		const names = splitOperands(parameters).map((part) => {
			if (part.length !== 1 || part[0].kind !== TokenKind.Identifier) throw new AssemblyError('Macro parameters must be names', part[0] ? positionOf(part[0]) : at)
			return part[0].text
		})
		if (new Set(names).size !== names.length) throw new AssemblyError(`Duplicate parameter in macro ${name.text}`, at)
		const body: Token[][] = []
		for (let index = start + 1; index < lines.length; index++) {
			const line = lines[index]
			if (MACRO_END.has(keyword(line[0]))) {
				const key = name.text.toUpperCase()
				if (this.macros.has(key)) throw new AssemblyError(`Macro ${name.text} is already defined`, at)
				if (MNEMONICS.has(key) || DIRECTIVES.has(key)) throw new AssemblyError(`Macro ${name.text} has the name of an instruction`, at)
				this.macros.set(key, { name: name.text, parameters: names, body, at })
				return index
			}
			if (this.macroHeader(line)) throw new AssemblyError('A macro cannot be defined inside another', positionOf(line[0]))
			body.push(line)
		}
		throw new AssemblyError(`Macro ${name.text} has no ENDM`, at)
	}

	/** A label's full name: a dot label belongs to the global label before it, or to its macro expansion. */
	private qualify(name: string): string {
		if (!name.startsWith('.')) return name
		return (this.local ?? this.global) + name
	}

	private defineLabel(token: Token) {
		const name = this.qualify(token.text)
		if (!token.text.startsWith('.')) this.global = token.text
		this.checkName(token, name)
		this.labels.add(name)
		this.statements.push({ kind: Label, name, at: positionOf(token) })
	}

	private checkName(token: Token, name: string) {
		if (this.labels.has(name)) throw new AssemblyError(`Symbol ${name} is already defined`, positionOf(token))
		const upper = name.toUpperCase()
		if (MNEMONICS.has(upper) || DIRECTIVES.has(upper)) throw new AssemblyError(`${token.text} is an instruction, not a label`, positionOf(token))
		if (REGISTER_NAMES.has(upper)) throw new AssemblyError(`${token.text} is a register, not a label`, positionOf(token))
	}

	/** A name assigned a value: EQU once, `=` and DEFL again and again. */
	private assign(token: Token, rest: Token[], once: boolean, at: Position) {
		const name = this.qualify(token.text)
		if (once) {
			this.checkName(token, name)
			this.labels.add(name)
		} else if (this.labels.has(name) && !this.constants.has(name)) {
			throw new AssemblyError(`Symbol ${name} is a label`, positionOf(token))
		}
		const value = this.expression(rest, at)
		const known = this.constant(value)
		if (known === undefined) this.constants.delete(name)
		else this.constants.set(name, known)
		this.statements.push({ kind: Assign, name, value, at: positionOf(token) })
	}

	/** An expression, with dot names qualified as their labels are. */
	private expression(tokens: Token[], at: Position): Expr {
		return expressionOf(tokens.map((token) =>
			token.kind === TokenKind.Identifier && token.text.startsWith('.') && token.text.length > 1 ? { ...token, text: this.qualify(token.text) } : token), at)
	}

	/** A value known now, from numbers and EQUs already seen, or undefined. */
	private constant(expr: Expr): number | undefined {
		try {
			const value = evaluate(expr, { lookup: (name) => this.constants.get(name), dot: NaN }, z80Arithmetic, false)
			return value !== undefined && Number.isFinite(value) ? value : undefined
		} catch {
			return undefined
		}
	}

	private line(tokens: Token[], invocation: Position | null) {
		let rest = tokens
		const first = rest[0]
		const at = (token: Token) => invocation ?? positionOf(token)
		// Assignments: `name EQU x`, `name = x`, `name DEFL x`, with or without a colon.
		if (first.kind === TokenKind.Identifier) {
			const colon = isOperator(rest[1], ':') ? 1 : 0
			const operator = rest[1 + colon]
			const word = keyword(operator)
			if (word === 'EQU' || word === 'DEFL' || isOperator(operator, '=')) {
				this.assign(first, rest.slice(2 + colon), word === 'EQU', at(first))
				return
			}
		}
		if (first.kind === TokenKind.Identifier && isOperator(rest[1], ':')) {
			this.defineLabel(first)
			rest = rest.slice(2)
		} else if (first.kind === TokenKind.Identifier && first.column === 1 && !this.isStatement(first)) {
			// A name in the first column is a label, colon or not.
			this.defineLabel(first)
			rest = rest.slice(1)
		}
		if (rest.length === 0) return
		const head = rest[0]
		if (head.kind !== TokenKind.Identifier) throw new AssemblyError(`Expected an instruction, not '${head.text}'`, positionOf(head))
		const word = keyword(head)
		const operands = rest.slice(1)
		const position = at(head)
		const macro = this.macros.get(head.text.toUpperCase())
		if (macro) return this.expand(macro, operands, positionOf(head), position)
		if (DIRECTIVES.has(word)) return this.directive(word, head, operands, position)
		if (MNEMONICS.has(word)) return this.instruction(word, head, operands, position)
		throw new AssemblyError(`Unknown instruction '${head.text}'`, positionOf(head))
	}

	private isStatement(token: Token): boolean {
		const word = keyword(token)
		return MNEMONICS.has(word) || DIRECTIVES.has(word) || this.macros.has(token.text.toUpperCase())
	}

	private provenance(kind: 'instruction' | 'data', at: Position): Provenance {
		return { kind, source: location(at), expansion: this.frames.slice() }
	}

	private instruction(mnemonic: string, head: Token, operandTokens: Token[], at: Position) {
		const operands = splitOperands(operandTokens).map((part) => parseOperand(this.qualifyTokens(part), positionOf(head)))
		const encoding = encodeInstruction(mnemonic, operands, positionOf(head))
		this.statements.push({
			kind: Fragment,
			size: encoding.size,
			encode: (context) => emitEncoding(encoding, context),
			provenance: this.provenance('instruction', at),
			at: positionOf(head),
		})
	}

	private qualifyTokens(tokens: Token[]): Token[] {
		return tokens.map((token) => token.kind === TokenKind.Identifier && token.text.startsWith('.') && token.text.length > 1 ? { ...token, text: this.qualify(token.text) } : token)
	}

	private directive(word: string, head: Token, operands: Token[], at: Position) {
		const position = positionOf(head)
		const parts = () => splitOperands(operands)
		switch (word) {
			case 'ORG':
				this.statements.push({ kind: Origin, value: this.expression(operands, position), at: position })
				return
			case 'ALIGN':
				this.statements.push({ kind: Align, boundary: this.expression(operands, position), at: position })
				return
			case 'END':
				this.ended = true
				return
			case 'INCLUDE':
				throw new AssemblyError('INCLUDE takes a file name in quotes', position)
			case 'EQU':
			case 'DEFL':
				throw new AssemblyError(`${word} needs a name before it`, position)
			case 'MACRO':
			case 'ENDM':
			case 'ENDMACRO':
				throw new AssemblyError(`${word} without a macro`, position)
		}
		if (DATA_BYTES.has(word) || DATA_WORDS.has(word)) {
			const width = DATA_WORDS.has(word) ? 2 : 1
			const items = parts().map((part) => {
				if (part.length === 1 && part[0].kind === TokenKind.String) {
					if (width === 2) throw new AssemblyError('Strings go in DB, not DW', positionOf(part[0]))
					return Array.from(part[0].string!, (character) => character.charCodeAt(0) & 0xFF)
				}
				return this.expression(part, part[0] ? positionOf(part[0]) : position)
			})
			if (items.length === 0) throw new AssemblyError(`${word} needs at least one value`, position)
			const size = items.reduce((total, item) => total + (Array.isArray(item) ? item.length : width), 0)
			this.statements.push({
				kind: Fragment,
				size,
				encode: (context) => {
					const bytes: number[] = []
					for (const item of items) {
						if (Array.isArray(item)) {
							bytes.push(...item)
							continue
						}
						const value = context.value(item, true)!
						const [low, high] = width === 1 ? [-128, 255] : [-32768, 65535]
						if (!Number.isInteger(value) || value < low || value > high) throw new AssemblyError(`Value ${value} does not fit in ${width === 1 ? 'a byte' : '16 bits'}`, position)
						bytes.push(value & 0xFF)
						if (width === 2) bytes.push((value >> 8) & 0xFF)
					}
					return bytes
				},
				provenance: this.provenance('data', at),
				at: position,
			})
			return
		}
		// DS count[,fill]: a fill needs the count now; without one the space is skipped.
		const [countTokens, fillTokens, ...extra] = parts()
		if (!countTokens || extra.length) throw new AssemblyError(`${word} takes a count and an optional fill byte`, position)
		const count = this.expression(countTokens, position)
		const known = this.constant(count)
		if (known !== undefined && (!Number.isInteger(known) || known < 0)) throw new AssemblyError(`${word} count ${known} is not a size`, position)
		if (fillTokens === undefined && known === undefined) {
			this.statements.push({ kind: Origin, value: { kind: ExprKind.Binary, op: Op.Add, left: { kind: ExprKind.Dot }, right: count, at: position }, at: position })
			return
		}
		if (known === undefined) throw new AssemblyError(`${word} with a fill byte needs a count known where it is written`, position)
		const fill = fillTokens ? this.expression(fillTokens, position) : null
		this.statements.push({
			kind: Fragment,
			size: known,
			encode: (context) => {
				const value = fill ? context.value(fill, true)! : 0
				if (!Number.isInteger(value) || value < -128 || value > 255) throw new AssemblyError(`Fill ${value} does not fit in a byte`, position)
				return new Array<number>(known).fill(value & 0xFF)
			},
			provenance: known > 0 ? this.provenance('data', at) : null,
			at: position,
		})
	}

	private expand(macro: Macro, operands: Token[], head: Position, at: Position) {
		if (this.frames.length >= MAX_MACRO_DEPTH) throw new AssemblyError(`Macro expansion exceeds ${MAX_MACRO_DEPTH} levels (is ${macro.name} recursive?)`, head)
		const args = splitOperands(operands)
		if (args.length !== macro.parameters.length) {
			throw new AssemblyError(`Macro ${macro.name} takes ${macro.parameters.length} argument${macro.parameters.length === 1 ? '' : 's'}, not ${args.length}`, head)
		}
		const values = new Map(macro.parameters.map((name, index) => [name, args[index]]))
		const lines = macro.body.map((line) => line.flatMap((token) =>
			token.kind === TokenKind.Identifier ? values.get(token.text) ?? [token] : [token]))
		const outerLocal = this.local
		this.frames.push({ macro: macro.name, invocation: location(head), definition: location(macro.at) })
		this.local = `${macro.name}.${++this.expansions}`
		try {
			// The outermost invocation is the line every expanded byte maps to.
			this.block(lines, this.frames.length === 1 ? head : at)
		} finally {
			this.frames.pop()
			this.local = outerLocal
		}
	}
}
