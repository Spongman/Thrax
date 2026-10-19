/**
 * Both ARM dialects, a line at a time, into the shared engine's statements.
 *
 * GNU as: `label:` anywhere before the statement, `1:` local labels reached
 * as `1b` and `1f`, `name = expr`, and the directives .text .data .bss
 * .section .word/.long .hword/.short .byte .ascii .asciz/.string .align
 * (a power of two) .balign .p2align .space/.skip .equ/.set .org .ltorg/.pool
 * .macro/.endm .end, with .global and the ELF bookkeeping directives accepted
 * and ignored.  Macros are textual: `\param` takes an argument's text,
 * `\@` counts expansions, arguments are separated by commas.
 *
 * armasm: a label is whatever starts in column 1, without a colon; AREA
 * (CODE or DATA), DCD/DCDU, DCW/DCWU, DCB, SPACE/FILL, EQU, ALIGN, LTORG,
 * ENTRY, END, with EXPORT/GLOBAL/IMPORT/EXTERN and the like accepted.
 *
 * Instructions are four-byte fragments encoded once layout is settled; CODE
 * and .text go to section 0, DATA and .data to section 1.
 */

import { StatementKind, type FragmentStatement, type HookContext, type Statement } from '../../../core/assembly/assembler'
import type { Provenance } from '../../../core/assembly/emitter'
import { ExprKind, Op, parseExpression, type Expr, type ExpressionSyntax } from '../../../core/assembly/expressions'
import { location } from '../../../core/assembly/macroEngine'
import type { AssemblySource } from '../../../core/assembly/sources'
import { TokenCursor, TokenKind, makeToken, positionOf, type Position, type Token } from '../../../core/assembly/tokens'
import { AssemblyError } from '../../../core/diagnostics'
import type { Diagnostic } from '../../../core/types'
import { DIALECT_ARMASM } from './dialect'
import { parseInstruction, parseMnemonic, type InstructionScope } from './instructions'
import { LiteralPool } from './pool'
import { armasmExpressionSyntax, gnuExpressionSyntax } from './syntax'
import { tokenizeArm } from './tokenizer'

const { Label, Assign, Origin, Emit, Align, Bytes, Hook, Section, Fragment } = StatementKind
const { Identifier, Number: NumberToken, String: StringToken, Newline, End } = TokenKind

export const SECTION_TEXT = 0
export const SECTION_DATA = 1

/** Expansions one assembly may make, so a recursive macro ends. */
const MAX_EXPANSIONS = 10_000
const MAX_DIAGNOSTICS = 100

/** GNU directives that only matter to a linker or debugger. */
const GNU_IGNORED = new Set([
	'.global', '.globl', '.extern', '.weak', '.hidden', '.local', '.type', '.size', '.func', '.endfunc', '.syntax', '.arch', '.cpu',
	'.fpu', '.file', '.ident', '.arm', '.code32', '.eabi_attribute', '.fnstart', '.fnend', '.cantunwind', '.object_arch', '.list', '.nolist',
])
const GNU_DIRECTIVES = new Set([
	...GNU_IGNORED, '.text', '.data', '.bss', '.section', '.word', '.long', '.4byte', '.int', '.hword', '.short', '.2byte', '.byte',
	'.ascii', '.asciz', '.string', '.align', '.p2align', '.balign', '.space', '.skip', '.zero', '.equ', '.set', '.equiv', '.ltorg', '.pool',
	'.org', '.end', '.macro', '.endm', '.include', '.code', '.thumb', '.thumb_func',
])

const ARMASM_IGNORED = new Set(['EXPORT', 'GLOBAL', 'IMPORT', 'EXTERN', 'KEEP', 'PRESERVE8', 'REQUIRE8', 'ARM', 'CODE32', 'INFO', 'TTL', 'SUBT'])
const ARMASM_UNSUPPORTED = new Set(['GET', 'INCLUDE', 'MACRO', 'MEND', 'IF', 'ELSE', 'ENDIF', 'ELIF', 'WHILE', 'WEND', 'RN', 'SETA', 'SETL', 'SETS', 'GBLA', 'GBLL', 'GBLS', 'LCLA', 'LCLL', 'LCLS', 'MAP', 'FIELD', 'ROUT'])
export const ARMASM_DIRECTIVES: ReadonlySet<string> = new Set([
	...ARMASM_IGNORED, ...ARMASM_UNSUPPORTED, 'AREA', 'DCD', 'DCDU', 'DCW', 'DCWU', 'DCB', 'SPACE', 'FILL', 'EQU', 'ALIGN', 'LTORG', 'ENTRY', 'END', 'THUMB', 'CODE16',
])

export const GNU_DIRECTIVE_NAMES: readonly string[] = Object.freeze([...GNU_DIRECTIVES].map((name) => name.slice(1)).sort())

export interface ArmParseOptions {
	dialect: number
	/** Sources by name, for the text of macro bodies. */
	sources: ReadonlyMap<string, AssemblySource>
	/** Names defined before the program, such as SWI numbers. */
	predefined: ReadonlyMap<string, number>
}

/** What the hooks record as the engine runs. */
export interface ArmParseState {
	/** Where ENTRY stood, once emitted. */
	entry: number | null
}

export interface ArmParse {
	statements: Statement[]
	diagnostics: Diagnostic[]
	warnings: Diagnostic[]
	state: ArmParseState
	/** Whether anything went to the data section, which then has to be placed. */
	usesData: boolean
}

interface Line {
	tokens: Token[]
	/** The text of a macro expansion's line; source lines are read from the file. */
	raw: string | null
}

interface Macro {
	name: string
	parameters: { name: string, fallback: string }[]
	body: string[]
}

const number = (value: number): Expr => ({ kind: ExprKind.Number, value })

function splitLines(tokens: readonly Token[], raw: (index: number) => string | null = () => null): Line[] {
	const lines: Line[] = []
	let current: Token[] = []
	for (const token of tokens) {
		if (token.kind === Newline) {
			if (current.length) lines.push({ tokens: current, raw: raw(current[0].line) })
			current = []
		} else {
			current.push(token)
		}
	}
	if (current.length) lines.push({ tokens: current, raw: raw(current[0].line) })
	return lines
}

/** Parses an include-expanded token stream. */
export function parseArm(tokens: readonly Token[], options: ArmParseOptions): ArmParse {
	return new Parser(options).run(splitLines(tokens))
}

class Parser {
	private readonly armasm: boolean
	private readonly syntax: ExpressionSyntax
	private readonly out: Statement[] = []
	private readonly diagnostics: Diagnostic[] = []
	private readonly warnings: Diagnostic[] = []
	private readonly state: ArmParseState = { entry: null }
	private section = SECTION_TEXT
	private usesData = false
	private readonly pools = [new LiteralPool(), new LiteralPool()]
	private readonly allPools = [...this.pools]
	private readonly macros = new Map<string, Macro>()
	private readonly localCounts = new Map<string, number>()
	private readonly labels = new Map<string, Position>()
	private readonly sourceLines = new Map<string, string[]>()
	private lines: Line[] = []
	private index = 0
	private expansions = 0
	private ended = false
	private readonly scope: InstructionScope

	constructor(private readonly options: ArmParseOptions) {
		this.armasm = options.dialect === DIALECT_ARMASM
		this.syntax = this.armasm ? armasmExpressionSyntax : gnuExpressionSyntax
		this.scope = {
			syntax: this.syntax,
			pool: () => this.pools[this.section],
			swiNames: options.predefined,
			warn: (message, at) => this.warnings.push({ severity: 'warning', message, file: at.file, line: at.line, column: at.column, endColumn: at.endColumn }),
		}
	}

	run(lines: Line[]): ArmParse {
		this.lines = lines
		const start = lines[0]?.tokens[0]
		const at: Position = start ? positionOf(start) : { file: '', line: 1, column: 1 }
		// Each assembly lays out afresh: pools refill and ENTRY moves.
		this.out.push({
			kind: Hook,
			run: (context) => {
				if (context.emitting) return
				for (const pool of this.allPools) pool.reset()
				this.state.entry = null
			},
			at,
		})
		for (const [name, value] of this.options.predefined) this.out.push({ kind: Assign, name, value: number(value), at })
		for (; this.index < this.lines.length && !this.ended; this.index++) {
			const line = this.lines[this.index]
			try {
				if (this.armasm) this.armasmLine(line)
				else this.gnuLine(line)
			} catch (error) {
				if (!(error instanceof AssemblyError)) throw error
				this.diagnostics.push(error.diagnostic)
				if (this.diagnostics.length >= MAX_DIAGNOSTICS) break
			}
		}
		// Whatever loads are still waiting get their pool at the end of their section.
		const last = this.lines[this.lines.length - 1]?.tokens[0]
		const end = last ? positionOf(last) : at
		for (const section of [SECTION_TEXT, SECTION_DATA]) {
			this.out.push({ kind: Section, section, at: end }, ...this.pools[section].statements(end))
		}
		return { statements: this.out, diagnostics: this.diagnostics, warnings: this.warnings, state: this.state, usesData: this.usesData }
	}

	/* ------------------------------------------------------------ GNU */

	private gnuLine(line: Line) {
		const tokens = line.tokens
		const cursor = new TokenCursor(tokens)
		while ((cursor.peek().kind === Identifier || cursor.peek().kind === NumberToken) && cursor.isOperator(':', 1)) {
			const token = cursor.next()
			cursor.next()
			if (token.kind === NumberToken) this.localDefinition(token)
			else this.label(token.text, token)
		}
		if (cursor.atLineEnd()) return
		this.resolveLocalReferences(tokens, cursor.index)
		const head = cursor.next()
		if (head.kind !== Identifier) throw new AssemblyError(`Unexpected '${head.text}' at the start of a statement`, positionOf(head))
		if (cursor.isOperator('=')) {
			cursor.next()
			this.assign(head, cursor)
			return
		}
		const name = head.text.toLowerCase()
		if (name.startsWith('.') && name.length > 1) {
			this.gnuDirective(name, head, cursor)
			return
		}
		const macro = this.macros.get(name)
		if (macro) {
			this.expand(macro, head, cursor, line)
			return
		}
		this.instruction(head, cursor)
	}

	/** `1b` and `2f` become the generated names of the nearest local labels. */
	private resolveLocalReferences(tokens: Token[], from: number) {
		for (let index = from; index < tokens.length; index++) {
			const token = tokens[index]
			const match = token.kind === Identifier ? /^([0-9]+)([bf])$/.exec(token.text) : null
			if (!match) continue
			const backward = match[2] === 'b'
			if (backward && !this.localCounts.get(match[1])) throw new AssemblyError(`No local label ${match[1]} before ${token.text}`, positionOf(token))
			tokens[index] = { ...token, text: this.localLabel(match[1], backward ? 0 : 1) }
		}
	}

	/** The generated name of local label `digits`: the last defined, or the next with `ahead`. */
	private localLabel(digits: string, ahead: number): string {
		return `.L${digits}~${(this.localCounts.get(digits) ?? 0) + ahead}`
	}

	private gnuDirective(name: string, head: Token, cursor: TokenCursor) {
		const at = positionOf(head)
		if (GNU_IGNORED.has(name)) {
			cursor.index = cursor.tokens.length
			return
		}
		switch (name) {
			case '.text': return this.select(SECTION_TEXT, at)
			case '.data':
			case '.bss': return this.select(SECTION_DATA, at)
			case '.section': {
				const token = cursor.next()
				const section = token.kind === StringToken ? token.string! : token.text
				if (!section) throw new AssemblyError('.section needs a name', positionOf(token))
				cursor.index = cursor.tokens.length
				return this.select(/^\.(data|bss)/.test(section) ? SECTION_DATA : SECTION_TEXT, at)
			}
			case '.word':
			case '.long':
			case '.4byte':
			case '.int': return this.values(cursor, 4, false)
			case '.hword':
			case '.short':
			case '.2byte': return this.values(cursor, 2, false)
			case '.byte': return this.values(cursor, 1, false)
			case '.ascii':
			case '.asciz':
			case '.string': {
				do {
					const token = cursor.peek()
					if (token.kind !== StringToken) throw new AssemblyError(`${name} expects a string in double quotes`, positionOf(token))
					cursor.next()
					const bytes = Array.from(token.string!, (character) => character.charCodeAt(0) & 0xFF)
					if (name !== '.ascii') bytes.push(0)
					this.out.push({ kind: Bytes, bytes: Uint8Array.from(bytes), at: positionOf(token) })
				} while (cursor.accept(','))
				return this.end(cursor)
			}
			case '.align':
			case '.p2align': {
				const power = this.optionalExpression(cursor)
				this.skipArguments(cursor)
				this.out.push({ kind: Align, boundary: power ? { kind: ExprKind.Binary, op: Op.Shl, left: number(1), right: power, at } : null, at })
				return
			}
			case '.balign': {
				const boundary = this.optionalExpression(cursor)
				this.skipArguments(cursor)
				this.out.push({ kind: Align, boundary, at })
				return
			}
			case '.space':
			case '.skip':
			case '.zero': {
				const size = this.expression(cursor, `${name} needs a size`)
				const fill = cursor.accept(',') ? this.expression(cursor, 'Expected a fill value') : null
				this.end(cursor)
				return this.space(size, fill, at)
			}
			case '.equ':
			case '.set':
			case '.equiv': {
				const symbol = cursor.next()
				if (symbol.kind !== Identifier) throw new AssemblyError(`${name} needs a symbol name`, positionOf(symbol))
				cursor.expect(',', `Expected ',' after the name in ${name}`)
				return this.assign(symbol, cursor)
			}
			case '.ltorg':
			case '.pool':
				this.end(cursor)
				return this.flushPool(at)
			case '.org': {
				const value = this.expression(cursor, '.org needs an address')
				this.skipArguments(cursor)
				this.out.push({ kind: Origin, value, at })
				return
			}
			case '.end':
				this.ended = true
				return
			case '.macro': return this.defineMacro(head, cursor)
			case '.endm': throw new AssemblyError('.endm without .macro', at)
			case '.include': throw new AssemblyError('.include expects a file name in double quotes', at)
			case '.code': {
				const width = this.expression(cursor, '.code needs 32')
				if (width.kind === ExprKind.Number && width.value === 32) return this.end(cursor)
				throw new AssemblyError('Only ARM code (.code 32) is available on this target', at)
			}
			case '.thumb':
			case '.thumb_func': throw new AssemblyError('Thumb is not available on this target', at)
		}
		throw new AssemblyError(`Unknown directive '${head.text}'`, at)
	}

	/** `1:`: the next of local label 1's generated names. */
	private localDefinition(token: Token) {
		const digits = token.text
		this.localCounts.set(digits, (this.localCounts.get(digits) ?? 0) + 1)
		this.out.push({ kind: Label, name: this.localLabel(digits, 0), at: positionOf(token) })
	}

	/* ---------------------------------------------------------- armasm */

	private armasmLine(line: Line) {
		const cursor = new TokenCursor(line.tokens)
		const first = cursor.peek()
		let label: Token | null = null
		if (first.column === 1) {
			if (first.kind !== Identifier) throw new AssemblyError(`Only a label can start in column 1, not '${first.text}'`, positionOf(first))
			label = cursor.next()
		}
		if (cursor.atLineEnd()) {
			if (label) this.label(label.text, label)
			return
		}
		const head = cursor.next()
		if (head.kind !== Identifier) {
			const hint = label && isKeyword(label.text) ? `; '${label.text}' in column 1 is read as a label, so indent instructions` : ''
			throw new AssemblyError(`Unexpected '${head.text}'${hint}`, positionOf(head))
		}
		const name = head.text.toUpperCase()
		if (name === 'EQU') {
			if (!label) throw new AssemblyError('EQU needs a name in column 1', positionOf(head))
			return this.assign(label, cursor)
		}
		if (label) this.label(label.text, label, name === 'DCD' || name === 'DCW')
		if (ARMASM_DIRECTIVES.has(name)) return this.armasmDirective(name, head, cursor)
		if (!parseMnemonic(head.text) && label && isKeyword(label.text)) {
			throw new AssemblyError(`'${label.text}' in column 1 is read as a label; indent instructions and directives`, positionOf(label))
		}
		this.instruction(head, cursor)
	}

	private armasmDirective(name: string, head: Token, cursor: TokenCursor) {
		const at = positionOf(head)
		if (ARMASM_IGNORED.has(name)) {
			cursor.index = cursor.tokens.length
			return
		}
		if (ARMASM_UNSUPPORTED.has(name)) throw new AssemblyError(`armasm's ${name} directive is not supported`, at)
		switch (name) {
			case 'AREA': {
				const area = cursor.next()
				if (area.kind !== Identifier) throw new AssemblyError('AREA needs a name', positionOf(area))
				let data = false
				while (cursor.accept(',')) {
					const attribute = cursor.next()
					if (attribute.kind === Identifier && attribute.text.toUpperCase() === 'DATA') data = true
					// ALIGN=n and the like.
					if (cursor.accept('=')) cursor.next()
				}
				this.end(cursor)
				return this.select(data ? SECTION_DATA : SECTION_TEXT, at)
			}
			case 'DCD':
			case 'DCDU':
				if (name === 'DCD') this.out.push({ kind: Align, boundary: number(4), carry: true, at })
				return this.values(cursor, 4, false)
			case 'DCW':
			case 'DCWU':
				if (name === 'DCW') this.out.push({ kind: Align, boundary: number(2), carry: true, at })
				return this.values(cursor, 2, false)
			case 'DCB': return this.values(cursor, 1, true)
			case 'SPACE': {
				const size = this.expression(cursor, 'SPACE needs a size')
				this.end(cursor)
				return this.space(size, null, at)
			}
			case 'FILL': {
				const size = this.expression(cursor, 'FILL needs a size')
				const fill = cursor.accept(',') ? this.expression(cursor, 'Expected a fill value') : null
				this.end(cursor)
				return this.space(size, fill, at)
			}
			case 'ALIGN': {
				const boundary = this.optionalExpression(cursor)
				this.skipArguments(cursor)
				this.out.push({ kind: Align, boundary, at })
				return
			}
			case 'LTORG':
				this.end(cursor)
				return this.flushPool(at)
			case 'ENTRY':
				this.end(cursor)
				this.out.push({ kind: Hook, run: (context) => { if (context.emitting) this.state.entry = context.dot }, at })
				return
			case 'END':
				this.ended = true
				return
			case 'THUMB':
			case 'CODE16': throw new AssemblyError('Thumb is not available on this target', at)
		}
		throw new AssemblyError(`Unknown directive '${head.text}'`, at)
	}

	/* ---------------------------------------------------------- shared */

	private label(name: string, token: Token, movable = false) {
		const at = positionOf(token)
		if (name === '.') throw new AssemblyError('Cannot use . as a label', at)
		const previous = this.labels.get(name)
		if (previous) throw new AssemblyError(`Label ${name} is already defined on line ${previous.line}${previous.file !== at.file ? ` of ${previous.file}` : ''}`, at)
		this.labels.set(name, at)
		this.out.push({ kind: Label, name, at, ...(movable ? { movable } : {}) })
	}

	private assign(name: Token, cursor: TokenCursor) {
		const at = positionOf(name)
		const value = this.expression(cursor, `Expected a value for ${name.text}`)
		this.end(cursor)
		this.out.push(name.text === '.' ? { kind: Origin, value, at } : { kind: Assign, name: name.text, value, at })
	}

	private select(section: number, at: Position) {
		this.section = section
		if (section === SECTION_DATA) this.usesData = true
		this.out.push({ kind: Section, section, at })
	}

	private flushPool(at: Position) {
		const pool = this.pools[this.section]
		this.out.push(...pool.statements(at))
		const next = new LiteralPool()
		this.pools[this.section] = next
		this.allPools.push(next)
	}

	/** Comma-separated values of `size` bytes; strings too where `strings`. */
	private values(cursor: TokenCursor, size: number, strings: boolean) {
		do {
			const token = cursor.peek()
			if (strings && token.kind === StringToken) {
				cursor.next()
				this.out.push({ kind: Bytes, bytes: Uint8Array.from(token.string!, (character) => character.charCodeAt(0) & 0xFF), at: positionOf(token) })
				continue
			}
			const at = positionOf(token)
			this.out.push({ kind: Emit, value: this.expression(cursor, 'Expected a value'), size, at })
		} while (cursor.accept(','))
		this.end(cursor)
	}

	/** Reserves `size` bytes: skipped when zero-filled, written otherwise. */
	private space(size: Expr, fill: Expr | null, at: Position) {
		if (!fill) {
			this.out.push({ kind: Origin, value: { kind: ExprKind.Binary, op: Op.Add, left: { kind: ExprKind.Dot }, right: size, at }, at })
			return
		}
		let count = 0
		const provenance: Provenance = { kind: 'data', source: location(at), expansion: [] }
		const measure: Statement = {
			kind: Hook,
			run: (context: HookContext) => {
				const value = context.value(size, true)!
				if (!Number.isInteger(value) || value < 0) throw new AssemblyError(`Size ${value} is not a whole number of bytes`, at)
				count = value
			},
			at,
		}
		const bytes: FragmentStatement = {
			kind: Fragment,
			get size() { return count },
			encode: (context) => new Uint8Array(count).fill(context.value(fill, true)! & 0xFF),
			provenance,
			at,
		}
		this.out.push(measure, bytes)
	}

	private instruction(head: Token, cursor: TokenCursor) {
		const at = positionOf(head)
		const parsed = parseInstruction(head, cursor, this.scope)
		if (!parsed) {
			const hint = !this.armasm && ARMASM_DIRECTIVES.has(head.text.toUpperCase()) ? `; ${head.text.toUpperCase()} is armasm, so name the file .armasm` : ''
			throw new AssemblyError(`Unknown instruction '${head.text}'${hint}`, at)
		}
		const provenance: Provenance = { kind: 'instruction', source: location(at), expansion: [] }
		if (parsed.prepare) this.out.push({ kind: Hook, run: (context) => parsed.prepare!(context), at })
		this.out.push({
			kind: Fragment,
			size: 4,
			encode(context) {
				if (context.dot & 3) throw new AssemblyError('An instruction must be word aligned; align first', at)
				const word = parsed.encode(context)
				return [word & 0xFF, (word >>> 8) & 0xFF, (word >>> 16) & 0xFF, word >>> 24]
			},
			provenance,
			at,
		})
	}

	private expression(cursor: TokenCursor, message: string): Expr {
		const expr = parseExpression(cursor, this.syntax)
		if (!expr) throw new AssemblyError(message, positionOf(cursor.peek()))
		return expr
	}

	private optionalExpression(cursor: TokenCursor): Expr | null {
		return cursor.atLineEnd() ? null : this.expression(cursor, 'Expected a value')
	}

	/** Fill and limit arguments of alignment directives, which change nothing here. */
	private skipArguments(cursor: TokenCursor) {
		if (cursor.accept(',')) cursor.index = cursor.tokens.length
		this.end(cursor)
	}

	private end(cursor: TokenCursor) {
		const token = cursor.peek()
		if (token.kind !== End) throw new AssemblyError(`Unexpected '${token.text}'`, positionOf(token))
	}

	/* ---------------------------------------------------------- macros */

	private rawLine(line: Line): string {
		if (line.raw !== null) return line.raw
		const { file, line: number } = line.tokens[0]
		let lines = this.sourceLines.get(file)
		if (!lines) this.sourceLines.set(file, lines = (this.options.sources.get(file)?.code ?? '').split('\n'))
		return lines[number - 1] ?? ''
	}

	private defineMacro(head: Token, cursor: TokenCursor) {
		const nameToken = cursor.next()
		if (nameToken.kind !== Identifier) throw new AssemblyError('.macro needs a name', positionOf(nameToken))
		const parameters: Macro['parameters'] = []
		while (!cursor.atLineEnd()) {
			const parameter = cursor.next()
			if (parameter.kind !== Identifier) throw new AssemblyError(`Unexpected '${parameter.text}' among the macro parameters`, positionOf(parameter))
			let fallback = ''
			if (cursor.accept('=')) {
				const value = cursor.next()
				fallback = value.text
			}
			parameters.push({ name: parameter.text, fallback })
			cursor.accept(',')
		}
		const body: string[] = []
		let last = ''
		for (this.index++; this.index < this.lines.length; this.index++) {
			const line = this.lines[this.index]
			const first = line.tokens[0]
			if (first.kind === Identifier && first.text.toLowerCase() === '.endm') {
				const name = nameToken.text.toLowerCase()
				if (this.macros.has(name)) throw new AssemblyError(`Macro ${nameToken.text} is already defined`, positionOf(nameToken))
				this.macros.set(name, { name: nameToken.text, parameters, body })
				return
			}
			// Lines a `;` split share their text; keep it once.
			const key = line.raw ?? `${first.file}\n${first.line}`
			if (key !== last) body.push(this.rawLine(line))
			last = key
		}
		throw new AssemblyError(`.macro ${nameToken.text} has no .endm`, positionOf(head))
	}

	private expand(macro: Macro, head: Token, cursor: TokenCursor, line: Line) {
		const at = positionOf(head)
		if (++this.expansions > MAX_EXPANSIONS) throw new AssemblyError(`More than ${MAX_EXPANSIONS} macro expansions (is ${macro.name} recursive?)`, at)
		// Arguments are the source text between top-level commas.
		const raw = this.rawLine(line)
		const args: string[] = []
		let first: Token | null = null
		let last: Token | null = null
		let depth = 0
		const take = () => {
			args.push(first && last ? raw.slice(first.column - 1, last.column - 1 + last.length) : '')
			first = last = null
		}
		while (!cursor.atLineEnd()) {
			const token = cursor.next()
			if (depth === 0 && token.kind === TokenKind.Operator && token.text === ',') {
				take()
				continue
			}
			if (token.kind === TokenKind.Operator && '([{'.includes(token.text)) depth++
			if (token.kind === TokenKind.Operator && ')]}'.includes(token.text)) depth--
			first ??= token
			last = token
		}
		if (first || args.length) take()
		if (args.length > macro.parameters.length) throw new AssemblyError(`Macro ${macro.name} takes ${macro.parameters.length} arguments, not ${args.length}`, at)
		const values = new Map(macro.parameters.map((parameter, index) => [parameter.name, args[index] || parameter.fallback]))
		const count = String(this.expansions)
		const text = macro.body.map((body) => body.replace(/\\(\(\)|@|[A-Za-z_.$][\w.$]*)/g, (whole, name: string) => {
			if (name === '()') return ''
			if (name === '@') return count
			return values.get(name) ?? whole
		}))
		// The expansion reports at the invoking line.
		const tokens = tokenizeArm({ name: head.file, code: text.join('\n') }, this.options.dialect)
		const lines = splitLines(tokens, (index) => text[index - 1] ?? null)
			.map((expanded) => ({ ...expanded, tokens: expanded.tokens.map((token) => ({ ...token, line: head.line })) }))
		this.lines.splice(this.index + 1, 0, ...lines)
	}
}

/** Whether `text` reads as a mnemonic or directive, for the column-1 hint. */
function isKeyword(text: string): boolean {
	return parseMnemonic(text) !== null || ARMASM_DIRECTIVES.has(text.toUpperCase())
}

/** A Newline token, for splicing streams. */
export const newlineAfter = (source: AssemblySource) => {
	const lines = source.code.split('\n')
	return makeToken(Newline, '\n', source.name, lines.length, lines[lines.length - 1].length + 1, 1)
}
