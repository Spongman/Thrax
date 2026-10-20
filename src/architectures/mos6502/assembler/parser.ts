/**
 * ca65-style statements for the shared engine.
 *
 * Instructions become fragments. One with both a zero-page and an absolute
 * form takes the zero-page one when layout already knows its operand fits in
 * a byte; a forward reference takes the absolute one. `z:` and `a:` force
 * either. Labels beginning with `@` are local to the label before them.
 */

import { StatementKind, type HookContext, type Statement } from '../../../core/assembly/assembler'
import { Op, parseExpression, type Expr, type ExpressionSyntax } from '../../../core/assembly/expressions'
import { TokenCursor, TokenKind, positionOf, type Position, type Token } from '../../../core/assembly/tokens'
import { AssemblyError } from '../../../core/diagnostics'
import type { Diagnostic } from '../../../core/types'
import { ABS, ABX, ABY, ACC, IMM, IMP, IND, INSN_BY_NAME, INSN_OPCODE, IZX, IZY, ALL_MNEMONICS, MODE_BYTES, REL, ZP, ZPX, ZPY, isBranch, takesAccumulator } from '../isa'
import { AIX, NMOS_MODEL, ZPI, ZPR, type CpuModel } from '../isa'
import { PC_SYMBOL } from './tokenizer'

const { Label, Assign, Origin, Emit, Invoke, Define, Align, Bytes, Hook, Fragment } = StatementKind
const { Identifier, String: StringToken, Newline, End } = TokenKind

/** Unary operators beyond the engine's own: the low and high byte. */
export const OP_LOW = 100
export const OP_HIGH = 101

/** ca65's precedence: unary, then multiplicative (with & ^ << >>), then additive (with |). */
export const mos6502ExpressionSyntax: ExpressionSyntax = {
	binary: new Map([
		['*', { op: Op.Mul, precedence: 2 }], ['/', { op: Op.Div, precedence: 2 }], ['&', { op: Op.And, precedence: 2 }],
		['^', { op: Op.Xor, precedence: 2 }], ['<<', { op: Op.Shl, precedence: 2 }], ['>>', { op: Op.Shr, precedence: 2 }],
		['+', { op: Op.Add, precedence: 1 }], ['-', { op: Op.Sub, precedence: 1 }], ['|', { op: Op.Or, precedence: 1 }],
	]),
	unary: new Map([['-', Op.Neg], ['~', Op.Not], ['+', Op.Plus], ['<', OP_LOW], ['>', OP_HIGH]]),
	dot: PC_SYMBOL,
}

/** What the parse leaves beside the statements for the assembler to read once it has run. */
export interface Mos6502ParseState {
	/** `.breakpoint` addresses. */
	breakpoints: number[]
	/** Where the first instruction emitted went: the default entry. */
	firstInstruction: number | null
}

export interface Mos6502Parse {
	statements: Statement[]
	diagnostics: Diagnostic[]
}

const DIRECTIVE_ALIASES: Readonly<Record<string, string>> = {
	db: 'byte', byt: 'byte', dw: 'word', addr: 'word', ds: 'res', endm: 'endmacro',
}

const REGISTER_NAMES = new Set(['a', 'x', 'y'])

/** Renames `@local` labels after the label they follow, so each stretch has its own. */
function scopeLocals(tokens: readonly Token[]): Token[] {
	let scope = ''
	let lineStart = true
	return tokens.map((token, index) => {
		const atStart = lineStart
		lineStart = token.kind === Newline
		if (token.kind !== Identifier) return token
		const next = tokens[index + 1]
		const defines = atStart && next?.kind === TokenKind.Operator && next.text === ':'
		if (token.text.startsWith('@')) return { ...token, text: `${scope}${token.text}` }
		if (defines) scope = token.text
		return token
	})
}

/** Parse an include-expanded token stream into engine statements. */
export function parseMos6502(tokens: readonly Token[], state: Mos6502ParseState, model: CpuModel = NMOS_MODEL): Mos6502Parse {
	const parser = new Parser(new TokenCursor(scopeLocals(tokens)), state, model)
	const statements = parser.body(null)
	return { statements, diagnostics: parser.diagnostics }
}

const hex = (value: number, digits: number) => `$${value.toString(16).toUpperCase().padStart(digits, '0')}`

/** The 8-bit two's complement or unsigned byte of `value`, or an error. */
function byteOf(value: number, what: string, at: Position): number {
	if (!Number.isInteger(value) || value < -128 || value > 255) throw new AssemblyError(`${what} ${value} does not fit in a byte`, at)
	return value & 0xFF
}

class Parser {
	readonly diagnostics: Diagnostic[] = []

	constructor(private readonly cursor: TokenCursor, private readonly state: Mos6502ParseState, private readonly model: CpuModel) {}

	/** Statements up to the end, or to `.endmacro` when `macro` opened them. */
	body(macro: Position | null): Statement[] {
		const cursor = this.cursor
		const result: Statement[] = []
		for (;;) {
			try {
				const token = cursor.peek()
				if (token.kind === End) {
					if (macro) throw new AssemblyError('.macro has no .endmacro', macro)
					return result
				}
				if (token.kind === Newline) {
					cursor.next()
					continue
				}
				if (macro && token.kind === Identifier && this.directiveName(token.text) === 'endmacro') {
					cursor.next()
					this.endLine()
					return result
				}
				this.line(result, macro !== null)
			} catch (error) {
				if (!(error instanceof AssemblyError)) throw error
				this.diagnostics.push(error.diagnostic)
				if (cursor.atEnd()) return result
				cursor.skipLine()
			}
		}
	}

	private directiveName(text: string): string | null {
		if (!text.startsWith('.') || text.length < 2) return null
		const name = text.slice(1).toLowerCase()
		return DIRECTIVE_ALIASES[name] ?? name
	}

	private endLine() {
		const token = this.cursor.peek()
		if (token.kind !== Newline && token.kind !== End) throw new AssemblyError(`Unexpected '${token.text}' at the end of the statement`, positionOf(token))
	}

	/** Labels, then at most one statement. */
	private line(out: Statement[], inMacro: boolean) {
		const cursor = this.cursor
		for (;;) {
			const token = cursor.peek()
			if (token.kind === Newline || token.kind === End) return
			const at = positionOf(token)
			if (token.kind === Identifier && cursor.isOperator(':', 1) && !token.text.startsWith('.')) {
				if (token.text === PC_SYMBOL) throw new AssemblyError('Cannot use * as a label', at)
				if (REGISTER_NAMES.has(token.text.toLowerCase()) || this.model.mnemonics.includes(token.text.toUpperCase())) {
					throw new AssemblyError(`'${token.text}' is reserved and cannot be a label`, at)
				}
				cursor.index += 2
				out.push({ kind: Label, name: token.text, at })
				continue
			}
			this.statement(out, inMacro)
			this.endLine()
			return
		}
	}

	private statement(out: Statement[], inMacro: boolean) {
		const cursor = this.cursor
		const token = cursor.next()
		const at = positionOf(token)
		if (token.kind !== Identifier) throw new AssemblyError(`Unexpected '${token.text}'`, at)
		const second = cursor.peek()
		if (cursor.isOperator('=') || cursor.isOperator(':=') || (second.kind === Identifier && /^\.?(equ|set)$/i.test(second.text))) {
			cursor.next()
			const value = this.expression(`Expected an expression after ${second.text}`)
			out.push(token.text === PC_SYMBOL ? { kind: Origin, value, at } : { kind: Assign, name: token.text, value, at })
			return
		}
		const directive = this.directiveName(token.text)
		if (directive !== null) {
			this.directive(directive, token, at, out, inMacro)
			return
		}
		const insn = INSN_BY_NAME.get(token.text.toUpperCase())
		if (insn !== undefined && this.model.opcodes[insn].some(opcode => opcode >= 0)) {
			out.push(this.instruction(insn, at))
			return
		}
		// Anything else names a macro, its arguments expressions.
		const args: Expr[] = []
		if (!cursor.atLineEnd()) {
			do args.push(this.expression(`Expected an argument to ${token.text}`))
			while (cursor.accept(','))
		}
		out.push({ kind: Invoke, name: token.text, args, at })
	}

	private expression(message: string): Expr {
		const value = parseExpression(this.cursor, mos6502ExpressionSyntax)
		if (!value) throw new AssemblyError(message, positionOf(this.cursor.peek()))
		return value
	}

	private string(message: string): string {
		const token = this.cursor.peek()
		if (token.kind !== StringToken) throw new AssemblyError(message, positionOf(token))
		this.cursor.next()
		return token.string!
	}

	private directive(name: string, token: Token, at: Position, out: Statement[], inMacro: boolean) {
		const cursor = this.cursor
		switch (name) {
			case 'org':
				out.push({ kind: Origin, value: this.expression('.org expects an address'), at })
				return
			case 'byte':
			case 'word': {
				const size = name === 'byte' ? 1 : 2
				do {
					const next = cursor.peek()
					if (next.kind === StringToken && size === 1) {
						cursor.next()
						out.push({ kind: Bytes, bytes: this.encode(next.string!, positionOf(next)), at })
					} else {
						out.push({ kind: Emit, value: this.expression(`${token.text} expects values`), size, at })
					}
				} while (cursor.accept(','))
				return
			}
			case 'ascii':
			case 'asciiz': {
				const parts: number[] = []
				do parts.push(...this.encode(this.string(`${token.text} expects a string`), at))
				while (cursor.accept(','))
				if (name === 'asciiz') parts.push(0)
				out.push({ kind: Bytes, bytes: Uint8Array.from(parts), at })
				return
			}
			case 'res': {
				const count = this.expression(`${token.text} expects a byte count`)
				const fill = cursor.accept(',') ? this.expression(`${token.text} expects a fill byte after the comma`) : null
				out.push({
					kind: Fragment, at, provenance: 'data',
					size: (context) => {
						const value = context.value(count, true)!
						if (!Number.isInteger(value) || value < 0 || value > 0x10000) throw new AssemblyError(`${token.text} cannot reserve ${value} bytes`, at)
						return value
					},
					encode: (context, size) => new Uint8Array(size).fill(fill ? byteOf(context.value(fill, true)!, 'Fill byte', at) : 0),
				})
				return
			}
			case 'align':
				out.push({ kind: Align, boundary: this.expression('.align expects a boundary'), at })
				return
			case 'macro': {
				if (inMacro) throw new AssemblyError('A macro cannot be defined inside another', at)
				const nameToken = cursor.next()
				if (nameToken.kind !== Identifier || nameToken.text.startsWith('.')) throw new AssemblyError('.macro expects a name', positionOf(nameToken))
				const parameters: string[] = []
				if (!cursor.atLineEnd()) {
					do {
						const parameter = cursor.next()
						if (parameter.kind !== Identifier) throw new AssemblyError('Macro parameters must be names', positionOf(parameter))
						parameters.push(parameter.text)
					} while (cursor.accept(','))
				}
				this.endLine()
				const body = this.body(at)
				out.push({ kind: Define, macro: { name: nameToken.text, parameters, body, at: positionOf(nameToken) }, at })
				return
			}
			case 'endmacro':
				throw new AssemblyError('.endmacro without .macro', at)
			case 'equ':
			case 'set': {
				const target = cursor.next()
				if (target.kind !== Identifier) throw new AssemblyError(`${token.text} expects a name`, positionOf(target))
				cursor.accept(',')
				out.push({ kind: Assign, name: target.text, value: this.expression(`${token.text} expects a value`), at })
				return
			}
			case 'breakpoint':
				out.push({ kind: Hook, at, run: (context: HookContext) => { if (context.emitting) this.state.breakpoints.push(context.dot) } })
				return
			case 'include':
				throw new AssemblyError('.include expects a file name in double quotes', at)
		}
		throw new AssemblyError(`Unrecognised directive '${token.text}'`, at)
	}

	private encode(text: string, at: Position): Uint8Array {
		const bytes = new Uint8Array(text.length)
		for (let index = 0; index < text.length; index++) {
			const code = text.charCodeAt(index)
			if (code > 0xFF) throw new AssemblyError(`'${text[index]}' is not a byte`, at)
			bytes[index] = code
		}
		return bytes
	}

	/** The operand of instruction `insn`, as an engine fragment. */
	private instruction(insn: number, at: Position): Statement {
		const cursor = this.cursor
		const name = ALL_MNEMONICS[insn]
		const opcodes = this.model.opcodes[insn]
		if (opcodes.every(opcode => opcode < 0)) throw new AssemblyError(`${name} is not supported by the ${this.model.id} CPU`, at)
		const fixed = (mode: number, expr: Expr | null): Statement => {
			const opcode = opcodes[mode]
			if (opcode < 0) throw new AssemblyError(`${name} has no ${modeLabel(mode)} mode`, at)
			return this.fragment(opcode, mode, expr, at)
		}
		if (cursor.atLineEnd()) {
			if (opcodes[IMP] >= 0) return fixed(IMP, null)
			if (opcodes[ACC] >= 0) return fixed(ACC, null)
			throw new AssemblyError(`${name} needs an operand`, at)
		}
		const first = cursor.peek()
		if (first.kind === Identifier && first.text.toLowerCase() === 'a' && (cursor.peek(1).kind === Newline || cursor.peek(1).kind === End)) {
			cursor.next()
			return fixed(ACC, null)
		}
		if (cursor.accept('#')) return fixed(IMM, this.expression(`${name} # expects a value`))
		if (opcodes[ZPR] >= 0) {
			const zero = this.expression(`${name} expects a zero-page address`)
			cursor.expect(',', `${name} expects a branch target after the zero-page operand`)
			const target = this.expression(`${name} expects a target`)
			return { kind: Fragment, at, provenance: 'instruction', size: 3, encode: context => {
				this.state.firstInstruction ??= context.dot
				const address = context.value(zero, true)!, offset = context.value(target, true)! - ((context.dot + 3) & 0xFFFF)
				if (!Number.isInteger(address) || address < 0 || address > 255) throw new AssemblyError('Bit branch address is outside zero page', at)
				if (!Number.isInteger(offset) || offset < -128 || offset > 127) throw new AssemblyError('Bit branch target is out of range', at)
				return [opcodes[ZPR], address, offset & 255]
			} }
		}
		if (opcodes[REL] >= 0) return fixed(REL, this.expression(`${name} expects a target`))
		if (cursor.isOperator('(')) {
			const start = cursor.index
			cursor.next()
			const inner = this.expression(`${name} expects an address in parentheses`)
			if (cursor.accept(',')) {
				this.index('x', name)
				cursor.expect(')', 'Expected ) after ,X')
				return fixed(opcodes[AIX] >= 0 ? AIX : IZX, inner)
			}
			cursor.expect(')', 'Expected )')
			if (cursor.atLineEnd()) {
				if (opcodes[IND] < 0 && opcodes[ZPI] < 0) throw new AssemblyError(`${name} has no indirect mode in ${this.model.id}`, at)
				return fixed(opcodes[ZPI] >= 0 ? ZPI : IND, inner)
			}
			if (cursor.accept(',')) {
				this.index('y', name)
				return fixed(IZY, inner)
			}
			// A parenthesised start of an ordinary expression, such as (base+1)*2.
			cursor.index = start
		}
		let force: 'z' | 'a' | null = null
		const prefix = cursor.peek()
		if (prefix.kind === Identifier && /^[az]$/i.test(prefix.text) && cursor.isOperator(':', 1)) {
			force = prefix.text.toLowerCase() as 'z' | 'a'
			cursor.index += 2
		}
		const expr = this.expression(`${name} expects an operand`)
		let zp = ZP
		let absolute = ABS
		if (cursor.accept(',')) {
			const register = this.index(null, name)
			zp = register === 'x' ? ZPX : ZPY
			absolute = register === 'x' ? ABX : ABY
		}
		const short = opcodes[zp] >= 0 && force !== 'a'
		const long = opcodes[absolute] >= 0 && force !== 'z'
		if (!short && !long) {
			const asked = force === 'z' ? zp : force === 'a' ? absolute : absolute
			throw new AssemblyError(`${name} has no ${modeLabel(asked)} mode`, at)
		}
		if (!long) return this.fragment(opcodes[zp], zp, expr, at, force === 'z' ? '' : `${name} has no ${modeLabel(absolute)} mode, and `)
		if (!short) return this.fragment(opcodes[absolute], absolute, expr, at)
		return {
			kind: Fragment, at, provenance: 'instruction',
			size: (context) => {
				const value = context.value(expr, false)
				return value !== undefined && value >= 0 && value <= 0xFF ? 2 : 3
			},
			encode: (context, size) => this.encodeOperand(size === 2 ? opcodes[zp] : opcodes[absolute], size === 2 ? zp : absolute, expr, context, at),
		}
	}

	/** Reads `,X` or `,Y`'s register, `wanted` or either. */
	private index(wanted: 'x' | 'y' | null, name: string): 'x' | 'y' {
		const token = this.cursor.next()
		const register = token.kind === Identifier ? token.text.toLowerCase() : ''
		if ((register === 'x' || register === 'y') && (wanted === null || wanted === register)) return register
		throw new AssemblyError(`${name} expects ${wanted ? wanted.toUpperCase() : 'X or Y'} as its index`, positionOf(token))
	}

	/** `lacks` explains a zero-page operand that had no choice, as when the absolute form is missing. */
	private fragment(opcode: number, mode: number, expr: Expr | null, at: Position, lacks = ''): Statement {
		return {
			kind: Fragment, at, provenance: 'instruction', size: MODE_BYTES[mode],
			encode: (context) => this.encodeOperand(opcode, mode, expr, context, at, lacks),
		}
	}

	private encodeOperand(opcode: number, mode: number, expr: Expr | null, context: HookContext, at: Position, lacks = ''): number[] {
		this.state.firstInstruction ??= context.dot
		if (expr === null) return [opcode]
		const value = context.value(expr, true)!
		if (!Number.isInteger(value)) throw new AssemblyError(`Operand ${value} is not an integer`, at)
		switch (MODE_BYTES[mode]) {
			case 2: {
				if (mode === IMM) return [opcode, byteOf(value, 'Immediate value', at)]
				if (mode === REL) {
					const offset = value - ((context.dot + 2) & 0xFFFF)
					if (offset < -128 || offset > 127) {
						throw new AssemblyError(`Branch out of range: ${hex(value & 0xFFFF, 4)} is ${offset} bytes away; a branch reaches -128 to +127`, at)
					}
					return [opcode, offset & 0xFF]
				}
				if (value < 0 || value > 0xFF) throw new AssemblyError(`${lacks}${hex(value & 0xFFFF, 4)} is outside the zero page`, at)
				return [opcode, value]
			}
			default:
				if (value < 0 || value > 0xFFFF) throw new AssemblyError(`Address ${value} is outside the 64 KiB address space`, at)
				return [opcode, value & 0xFF, value >> 8]
		}
	}
}

function modeLabel(mode: number): string {
	switch (mode) {
		case IMP: return 'implied'
		case ACC: return 'accumulator'
		case IMM: return 'immediate'
		case ZP: return 'zero-page'
		case ZPX: return 'zero-page,X'
		case ZPY: return 'zero-page,Y'
		case ABS: return 'absolute'
		case ABX: return 'absolute,X'
		case ABY: return 'absolute,Y'
		case IND: return 'indirect'
		case IZX: return '(zp,X)'
		case IZY: return '(zp),Y'
		case ZPI: return '(zero page)'
		case AIX: return '(absolute,X)'
		case ZPR: return 'zero page,relative'
		default: return 'relative'
	}
}
