/**
 * Operands and instruction encodings in Zilog syntax. An instruction's size
 * follows from its operands' shapes alone, so layout never needs a value; the
 * values go in once layout has settled.
 */

import { ExprKind, Op, parseExpression, type Expr, type ExpressionSyntax } from '../../../core/assembly/expressions'
import { TokenCursor, TokenKind, positionOf, type Position, type Token } from '../../../core/assembly/tokens'
import { AssemblyError } from '../../../core/diagnostics'

/* ------------------------------------------------------------- operands */

export class OperandKind {
	/** A register or a condition name. */
	static readonly Name = 0
	/** A value. */
	static readonly Immediate = 1
	/** `(nn)`: memory at a value. */
	static readonly Memory = 2
	/** `(HL)`, `(BC)`, `(DE)`, `(SP)`, `(C)`. */
	static readonly Indirect = 3
	/** `(IX+d)` or `(IY+d)`. */
	static readonly Indexed = 4
}

const { Name, Immediate, Memory, Indirect, Indexed } = OperandKind

export interface Operand {
	kind: number
	/** Upper-case register or condition name, for Name and Indirect; IX or IY for Indexed. */
	name: string
	expr: Expr | null
	at: Position
}

/** Names that are always registers, never symbols. */
export const REGISTER_NAMES = new Set([
	'A', 'B', 'C', 'D', 'E', 'H', 'L', 'I', 'R', 'F',
	'AF', 'AF\'', 'BC', 'DE', 'HL', 'SP', 'IX', 'IY',
	'IXH', 'IXL', 'IYH', 'IYL', 'XH', 'XL', 'YH', 'YL', 'HX', 'LX', 'HY', 'LY',
])

const HALF_ALIASES: Readonly<Record<string, string>> = { XH: 'IXH', XL: 'IXL', YH: 'IYH', YL: 'IYL', HX: 'IXH', LX: 'IXL', HY: 'IYH', LY: 'IYL' }

const CONDITIONS = ['NZ', 'Z', 'NC', 'C', 'PO', 'PE', 'P', 'M']

/** Operator spellings, C-like; LOW() and HIGH() are rewritten before parsing. */
export class Z80Op {
	static readonly Eq = 20
	static readonly Ne = 21
	static readonly Lt = 22
	static readonly Gt = 23
	static readonly Le = 24
	static readonly Ge = 25
	static readonly LogicalAnd = 26
	static readonly LogicalOr = 27
	static readonly LogicalNot = 28
}

export const z80ExpressionSyntax: ExpressionSyntax = {
	binary: new Map([
		['||', { op: Z80Op.LogicalOr, precedence: 1 }],
		['&&', { op: Z80Op.LogicalAnd, precedence: 2 }],
		['|', { op: Op.Or, precedence: 3 }],
		['^', { op: Op.Xor, precedence: 4 }],
		['&', { op: Op.And, precedence: 5 }],
		['==', { op: Z80Op.Eq, precedence: 6 }],
		['!=', { op: Z80Op.Ne, precedence: 6 }],
		['<', { op: Z80Op.Lt, precedence: 7 }],
		['>', { op: Z80Op.Gt, precedence: 7 }],
		['<=', { op: Z80Op.Le, precedence: 7 }],
		['>=', { op: Z80Op.Ge, precedence: 7 }],
		['<<', { op: Op.Shl, precedence: 8 }],
		['>>', { op: Op.Shr, precedence: 8 }],
		['+', { op: Op.Add, precedence: 9 }],
		['-', { op: Op.Sub, precedence: 9 }],
		['*', { op: Op.Mul, precedence: 10 }],
		['/', { op: Op.Div, precedence: 10 }],
		['%', { op: Op.Mod, precedence: 10 }],
	]),
	unary: new Map([['-', Op.Neg], ['+', Op.Plus], ['~', Op.Not], ['!', Z80Op.LogicalNot]]),
	dot: '$',
}

const operator = (text: string, like: Token): Token => ({ ...like, kind: TokenKind.Operator, text, length: like.length })
const numberToken = (value: number, like: Token): Token => ({ ...like, kind: TokenKind.Number, text: String(value), value })

/** Index of the `)` closing the `(` at `open`, or -1. */
export function closing(tokens: readonly Token[], open: number): number {
	let depth = 0
	for (let index = open; index < tokens.length; index++) {
		const token = tokens[index]
		if (token.kind !== TokenKind.Operator) continue
		if (token.text === '(') depth++
		else if (token.text === ')' && --depth === 0) return index
	}
	return -1
}

/** LOW(x) becomes ((x) & 255) and HIGH(x) becomes ((x) >> 8 & 255). */
export function rewriteFunctions(tokens: readonly Token[]): Token[] {
	const out: Token[] = []
	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index]
		const name = token.kind === TokenKind.Identifier ? token.text.toUpperCase() : ''
		const open = tokens[index + 1]
		if ((name === 'LOW' || name === 'HIGH') && open?.kind === TokenKind.Operator && open.text === '(') {
			const end = closing(tokens, index + 1)
			if (end < 0) throw new AssemblyError(`Expected ) to close ${name}(`, positionOf(open))
			out.push(operator('(', token), operator('(', token), ...rewriteFunctions(tokens.slice(index + 2, end)), operator(')', token))
			if (name === 'HIGH') out.push(operator('>>', token), numberToken(8, token))
			out.push(operator('&', token), numberToken(255, token), operator(')', token))
			index = end
			continue
		}
		out.push(token)
	}
	return out
}

/** One whole expression from `tokens`, which must hold nothing else. */
export function expressionOf(tokens: readonly Token[], at: Position): Expr {
	if (tokens.length === 0) throw new AssemblyError('Expected an expression', at)
	const register = tokens.find((token) => token.kind === TokenKind.Identifier && REGISTER_NAMES.has(token.text.toUpperCase()))
	if (register) throw new AssemblyError(`Register ${register.text} cannot be used in an expression`, positionOf(register))
	const cursor = new TokenCursor(rewriteFunctions(tokens))
	const expr = parseExpression(cursor, z80ExpressionSyntax)
	if (!expr) throw new AssemblyError(`Unexpected '${cursor.peek().text}' in expression`, positionOf(cursor.peek()))
	if (!cursor.atEnd()) throw new AssemblyError(`Unexpected '${cursor.peek().text}' after expression`, positionOf(cursor.peek()))
	return expr
}

/** Splits at commas outside parentheses. */
export function splitOperands(tokens: readonly Token[]): Token[][] {
	const parts: Token[][] = []
	if (tokens.length === 0) return parts
	let depth = 0
	let current: Token[] = []
	for (const token of tokens) {
		if (token.kind === TokenKind.Operator) {
			if (token.text === '(') depth++
			else if (token.text === ')') depth--
			else if (token.text === ',' && depth === 0) {
				parts.push(current)
				current = []
				continue
			}
		}
		current.push(token)
	}
	parts.push(current)
	return parts
}

const isName = (token: Token | undefined, names: ReadonlySet<string>) =>
	token !== undefined && token.kind === TokenKind.Identifier && names.has(token.text.toUpperCase())

const INDIRECT = new Set(['BC', 'DE', 'HL', 'SP', 'C'])
const INDEX = new Set(['IX', 'IY'])

export function parseOperand(tokens: readonly Token[], fallback: Position): Operand {
	if (tokens.length === 0) throw new AssemblyError('Expected an operand', fallback)
	const first = tokens[0]
	const at = positionOf(first)
	if (tokens.length === 1 && isName(first, REGISTER_NAMES)) {
		const upper = first.text.toUpperCase()
		return { kind: Name, name: HALF_ALIASES[upper] ?? upper, expr: null, at }
	}
	if (tokens.length === 1 && first.kind === TokenKind.Identifier && CONDITIONS.includes(first.text.toUpperCase())) {
		// A condition, or a symbol of that name where a value goes.
		return { kind: Name, name: first.text.toUpperCase(), expr: expressionOf(tokens, at), at }
	}
	const last = tokens[tokens.length - 1]
	if (first.kind === TokenKind.Operator && first.text === '(' && closing(tokens, 0) === tokens.length - 1 && last.text === ')') {
		const inner = tokens.slice(1, -1)
		if (inner.length === 1 && isName(inner[0], INDIRECT)) return { kind: Indirect, name: inner[0].text.toUpperCase(), expr: null, at }
		if (inner.length >= 1 && isName(inner[0], INDEX)) {
			const name = inner[0].text.toUpperCase()
			if (inner.length === 1) return { kind: Indexed, name, expr: { kind: ExprKind.Number, value: 0 }, at }
			const sign = inner[1]
			if (sign.kind !== TokenKind.Operator || (sign.text !== '+' && sign.text !== '-')) {
				throw new AssemblyError(`Expected + or - after ${name}`, positionOf(sign))
			}
			const offset = expressionOf(inner.slice(2), positionOf(sign))
			return { kind: Indexed, name, expr: sign.text === '-' ? { kind: ExprKind.Unary, op: Op.Neg, operand: offset } : offset, at }
		}
		return { kind: Memory, name: '', expr: expressionOf(inner, at), at }
	}
	if (isName(first, REGISTER_NAMES) && tokens.length > 1) {
		throw new AssemblyError(`Register ${first.text} cannot take part in an expression`, at)
	}
	return { kind: Immediate, name: '', expr: expressionOf(tokens, at), at }
}

/* ------------------------------------------------------------ encodings */

export class PartKind {
	static readonly Byte = 0
	static readonly Imm8 = 1
	static readonly Imm16 = 2
	/** A signed index displacement. */
	static readonly Displacement = 3
	/** A JR or DJNZ target, as an offset from the next instruction. */
	static readonly Relative = 4
	/** A fixed byte with a bit number 0-7 put in bits 3-5. */
	static readonly BitNumber = 5
	/** RST's target, 0 to 38h in steps of 8, put in bits 3-5. */
	static readonly Restart = 6
	/** IM's mode, 0 to 2. */
	static readonly InterruptMode = 7
}

const { Byte, Imm8, Imm16, Displacement, Relative, BitNumber, Restart, InterruptMode } = PartKind

export interface Part {
	kind: number
	/** The byte, or the opcode a bit number is put into. */
	value: number
	expr: Expr | null
	at: Position
}

/** What an instruction is: its parts, one byte each but Imm16, which is two. */
export interface Encoding {
	parts: Part[]
	size: number
}

export interface Evaluator {
	/** Address of the instruction's first byte. */
	readonly dot: number
	value(expr: Expr, strict: boolean): number | undefined
}

/** The bytes of an encoding, values range-checked. */
export function emitEncoding(encoding: Encoding, context: Evaluator): number[] {
	const bytes: number[] = []
	const evaluate = (part: Part) => context.value(part.expr!, true)!
	for (const part of encoding.parts) {
		switch (part.kind) {
			case Byte: bytes.push(part.value); break
			case Imm8: {
				const value = evaluate(part)
				if (!Number.isInteger(value) || value < -128 || value > 255) throw new AssemblyError(`Value ${value} does not fit in a byte`, part.at)
				bytes.push(value & 0xFF)
				break
			}
			case Imm16: {
				const value = evaluate(part)
				if (!Number.isInteger(value) || value < -32768 || value > 65535) throw new AssemblyError(`Value ${value} does not fit in 16 bits`, part.at)
				bytes.push(value & 0xFF, (value >> 8) & 0xFF)
				break
			}
			case Displacement: {
				const value = evaluate(part)
				if (!Number.isInteger(value) || value < -128 || value > 127) throw new AssemblyError(`Index displacement ${value} is out of range (-128 to 127)`, part.at)
				bytes.push(value & 0xFF)
				break
			}
			case Relative: {
				const target = evaluate(part)
				const offset = target - (context.dot + encoding.size)
				if (!Number.isInteger(offset) || offset < -128 || offset > 127) {
					throw new AssemblyError(`Relative jump target is out of range: offset ${offset} (-128 to 127)`, part.at)
				}
				bytes.push(offset & 0xFF)
				break
			}
			case BitNumber: {
				const bit = evaluate(part)
				if (!Number.isInteger(bit) || bit < 0 || bit > 7) throw new AssemblyError(`Bit number ${bit} is out of range (0 to 7)`, part.at)
				bytes.push(part.value | (bit << 3))
				break
			}
			case Restart: {
				const target = evaluate(part)
				if (!Number.isInteger(target) || target < 0 || target > 0x38 || target % 8 !== 0) {
					throw new AssemblyError(`RST target ${target} is not one of 0, 8, 10h ... 38h`, part.at)
				}
				bytes.push(0xC7 | target)
				break
			}
			case InterruptMode: {
				const mode = evaluate(part)
				if (mode !== 0 && mode !== 1 && mode !== 2) throw new AssemblyError(`Interrupt mode ${mode} is not 0, 1 or 2`, part.at)
				bytes.push([0x46, 0x56, 0x5E][mode])
				break
			}
		}
	}
	return bytes
}

/* ------------------------------------------------- the instruction table */

const R8: Readonly<Record<string, number>> = { B: 0, C: 1, D: 2, E: 3, H: 4, L: 5, A: 7 }
const RP: Readonly<Record<string, number>> = { BC: 0, DE: 1, HL: 2, SP: 3 }
const RP2: Readonly<Record<string, number>> = { BC: 0, DE: 1, HL: 2, AF: 3 }
const ALU: Readonly<Record<string, number>> = { ADD: 0, ADC: 1, SUB: 2, SBC: 3, AND: 4, XOR: 5, OR: 6, CP: 7 }
const ROTATE: Readonly<Record<string, number>> = { RLC: 0, RRC: 1, RL: 2, RR: 3, SLA: 4, SRA: 5, SLL: 6, SL1: 6, SLI: 6, SRL: 7 }
const BIT_OPS: Readonly<Record<string, number>> = { BIT: 0x40, RES: 0x80, SET: 0xC0 }
const PREFIX: Readonly<Record<string, number>> = { IX: 0xDD, IY: 0xFD }

/** Instructions with no operands. */
const SIMPLE: Readonly<Record<string, readonly number[]>> = {
	NOP: [0x00], RLCA: [0x07], RRCA: [0x0F], RLA: [0x17], RRA: [0x1F], DAA: [0x27], CPL: [0x2F], SCF: [0x37], CCF: [0x3F],
	HALT: [0x76], EXX: [0xD9], DI: [0xF3], EI: [0xFB],
	NEG: [0xED, 0x44], RETN: [0xED, 0x45], RETI: [0xED, 0x4D], RRD: [0xED, 0x67], RLD: [0xED, 0x6F],
	LDI: [0xED, 0xA0], CPI: [0xED, 0xA1], INI: [0xED, 0xA2], OUTI: [0xED, 0xA3],
	LDD: [0xED, 0xA8], CPD: [0xED, 0xA9], IND: [0xED, 0xAA], OUTD: [0xED, 0xAB],
	LDIR: [0xED, 0xB0], CPIR: [0xED, 0xB1], INIR: [0xED, 0xB2], OTIR: [0xED, 0xB3],
	LDDR: [0xED, 0xB8], CPDR: [0xED, 0xB9], INDR: [0xED, 0xBA], OTDR: [0xED, 0xBB],
}

export const MNEMONICS: ReadonlySet<string> = new Set([
	...Object.keys(SIMPLE), ...Object.keys(ALU), ...Object.keys(ROTATE), ...Object.keys(BIT_OPS),
	'LD', 'PUSH', 'POP', 'EX', 'INC', 'DEC', 'JP', 'JR', 'DJNZ', 'CALL', 'RET', 'RST', 'IM', 'IN', 'OUT',
])

/** An 8-bit operand as the r field reads it: a register, (HL) or (IX+d). */
interface R8Operand {
	code: number
	prefix: number
	/** The (IX+d) displacement. */
	displacement: Expr | null
	/** IXH, IXL, IYH or IYL. */
	half: boolean
}

class Builder {
	readonly parts: Part[] = []
	size = 0

	constructor(private readonly at: Position) {}

	byte(...values: number[]) {
		for (const value of values) this.add(Byte, value, null)
		return this
	}

	add(kind: number, value: number, expr: Expr | null, at = this.at) {
		this.parts.push({ kind, value, expr, at })
		this.size += kind === Imm16 ? 2 : 1
		return this
	}

	done(): Encoding {
		return { parts: this.parts, size: this.size }
	}
}

function invalid(mnemonic: string, at: Position): never {
	throw new AssemblyError(`Invalid operands for ${mnemonic}`, at)
}

function r8(operand: Operand): R8Operand | null {
	if (operand.kind === Name) {
		const code = R8[operand.name]
		if (code !== undefined) return { code, prefix: 0, displacement: null, half: false }
		const half = /^I([XY])([HL])$/.exec(operand.name)
		if (half) return { code: half[2] === 'H' ? 4 : 5, prefix: half[1] === 'X' ? 0xDD : 0xFD, displacement: null, half: true }
		return null
	}
	if (operand.kind === Indirect && operand.name === 'HL') return { code: 6, prefix: 0, displacement: null, half: false }
	if (operand.kind === Indexed) return { code: 6, prefix: PREFIX[operand.name], displacement: operand.expr, half: false }
	return null
}

/** Prefix, opcode and displacement of an instruction on one r operand. */
function withR8(builder: Builder, operand: R8Operand, opcode: number, at: Position) {
	if (operand.prefix) builder.byte(operand.prefix)
	builder.byte(opcode)
	if (operand.displacement) builder.add(Displacement, 0, operand.displacement, at)
	return builder
}

const value = (operand: Operand) => operand.kind === Immediate || (operand.kind === Name && operand.expr !== null)
const named = (operand: Operand, name: string) => operand.kind === Name && operand.name === name
/** HL, IX or IY with the prefix it takes. */
const pairHL = (operand: Operand): number | null => operand.kind !== Name ? null : operand.name === 'HL' ? 0 : PREFIX[operand.name] ?? null

function conditionOf(operand: Operand): number {
	return operand.kind === Name ? CONDITIONS.indexOf(operand.name) : -1
}

/** Encodes one instruction; throws an AssemblyError for operands it does not take. */
export function encodeInstruction(mnemonic: string, operands: readonly Operand[], at: Position): Encoding {
	const b = new Builder(at)
	const count = operands.length
	const [first, second] = operands
	const simple = SIMPLE[mnemonic]
	if (simple) {
		if (count !== 0) throw new AssemblyError(`${mnemonic} takes no operands`, operands[0].at)
		return b.byte(...simple).done()
	}
	switch (mnemonic) {
		case 'LD': return encodeLoad(b, operands, at).done()
		case 'PUSH':
		case 'POP': {
			if (count !== 1 || first.kind !== Name) invalid(mnemonic, at)
			const base = mnemonic === 'PUSH' ? 0xC5 : 0xC1
			const prefix = PREFIX[first.name]
			if (prefix) return b.byte(prefix, base | 0x20).done()
			const code = RP2[first.name]
			if (code === undefined) invalid(mnemonic, at)
			return b.byte(base | (code << 4)).done()
		}
		case 'EX': {
			if (count !== 2) invalid(mnemonic, at)
			if (named(first, 'AF') && named(second, 'AF\'')) return b.byte(0x08).done()
			if ((named(first, 'DE') && named(second, 'HL')) || (named(first, 'HL') && named(second, 'DE'))) return b.byte(0xEB).done()
			if (first.kind === Indirect && first.name === 'SP') {
				const prefix = pairHL(second)
				if (prefix === null) invalid(mnemonic, at)
				if (prefix) b.byte(prefix)
				return b.byte(0xE3).done()
			}
			return invalid(mnemonic, at)
		}
		case 'INC':
		case 'DEC': {
			if (count !== 1) invalid(mnemonic, at)
			const increment = mnemonic === 'INC'
			const pair = pairHL(first)
			if (pair) return b.byte(pair, increment ? 0x23 : 0x2B).done()
			if (first.kind === Name && RP[first.name] !== undefined) return b.byte((increment ? 0x03 : 0x0B) | (RP[first.name] << 4)).done()
			const operand = r8(first)
			if (!operand) invalid(mnemonic, at)
			return withR8(b, operand, (increment ? 0x04 : 0x05) | (operand.code << 3), at).done()
		}
		case 'ADD':
		case 'ADC':
		case 'SBC': {
			// 16-bit forms first: ADD HL/IX/IY,rr; ADC and SBC HL,rr.
			const pair = count === 2 ? pairHL(first) : null
			if (pair !== null) {
				if (second.kind !== Name) invalid(mnemonic, at)
				if (mnemonic === 'ADD') {
					const own = pair ? (second.name === first.name ? 2 : second.name === 'HL' ? -1 : RP[second.name]) : RP[second.name]
					if (own === undefined || own < 0) invalid(mnemonic, at)
					if (pair) b.byte(pair)
					return b.byte(0x09 | (own << 4)).done()
				}
				const code = RP[second.name]
				if (pair !== 0 || code === undefined) invalid(mnemonic, at)
				return b.byte(0xED, (mnemonic === 'ADC' ? 0x4A : 0x42) | (code << 4)).done()
			}
			return encodeAlu(b, mnemonic, operands, at).done()
		}
		case 'SUB':
		case 'AND':
		case 'XOR':
		case 'OR':
		case 'CP':
			return encodeAlu(b, mnemonic, operands, at).done()
		case 'RLC': case 'RRC': case 'RL': case 'RR': case 'SLA': case 'SRA': case 'SLL': case 'SL1': case 'SLI': case 'SRL': {
			if (count < 1 || count > 2) invalid(mnemonic, at)
			const operand = r8(first)
			if (!operand || operand.half) invalid(mnemonic, at)
			return encodeCB(b, ROTATE[mnemonic] << 3, operand, second, null, mnemonic, at).done()
		}
		case 'BIT':
		case 'RES':
		case 'SET': {
			if (count < 2 || count > 3 || !value(first)) invalid(mnemonic, at)
			const operand = r8(second)
			if (!operand || operand.half) invalid(mnemonic, at)
			if (mnemonic === 'BIT' && count === 3) invalid(mnemonic, at)
			return encodeCB(b, BIT_OPS[mnemonic], operand, operands[2], first, mnemonic, at).done()
		}
		case 'JP': {
			// JP (HL), JP (IX) and JP (IY); the bare register is accepted too.
			if (count === 1 && first.kind === Indirect && first.name === 'HL') return b.byte(0xE9).done()
			if (count === 1 && first.kind === Indexed && first.expr?.kind === ExprKind.Number && first.expr.value === 0) return b.byte(PREFIX[first.name], 0xE9).done()
			if (count === 1 && first.kind === Name && first.expr === null) {
				const prefix = pairHL(first)
				if (prefix === null) invalid(mnemonic, at)
				if (prefix) b.byte(prefix)
				return b.byte(0xE9).done()
			}
			if (count === 1 && value(first)) return b.byte(0xC3).add(Imm16, 0, first.expr, first.at).done()
			if (count === 2 && conditionOf(first) >= 0 && value(second)) return b.byte(0xC2 | (conditionOf(first) << 3)).add(Imm16, 0, second.expr, second.at).done()
			return invalid(mnemonic, at)
		}
		case 'CALL': {
			if (count === 1 && value(first)) return b.byte(0xCD).add(Imm16, 0, first.expr, first.at).done()
			if (count === 2 && conditionOf(first) >= 0 && value(second)) return b.byte(0xC4 | (conditionOf(first) << 3)).add(Imm16, 0, second.expr, second.at).done()
			return invalid(mnemonic, at)
		}
		case 'JR': {
			if (count === 1 && value(first)) return b.byte(0x18).add(Relative, 0, first.expr, first.at).done()
			if (count === 2 && value(second)) {
				const condition = conditionOf(first)
				if (condition < 0 || condition > 3) throw new AssemblyError('JR takes only the conditions NZ, Z, NC and C', first.at)
				return b.byte(0x20 | (condition << 3)).add(Relative, 0, second.expr, second.at).done()
			}
			return invalid(mnemonic, at)
		}
		case 'DJNZ':
			if (count !== 1 || !value(first)) invalid(mnemonic, at)
			return b.byte(0x10).add(Relative, 0, first.expr, first.at).done()
		case 'RET':
			if (count === 0) return b.byte(0xC9).done()
			if (count === 1 && conditionOf(first) >= 0) return b.byte(0xC0 | (conditionOf(first) << 3)).done()
			return invalid(mnemonic, at)
		case 'RST':
			if (count !== 1 || !value(first)) invalid(mnemonic, at)
			return b.add(Restart, 0, first.expr, first.at).done()
		case 'IM':
			if (count !== 1 || !value(first)) invalid(mnemonic, at)
			return b.byte(0xED).add(InterruptMode, 0, first.expr, first.at).done()
		case 'IN': {
			// IN (C) and IN F,(C) only set the flags.
			if (count === 1 && first.kind === Indirect && first.name === 'C') return b.byte(0xED, 0x70).done()
			if (count !== 2) invalid(mnemonic, at)
			if (named(first, 'A') && second.kind === Memory) return b.byte(0xDB).add(Imm8, 0, second.expr, second.at).done()
			if (second.kind !== Indirect || second.name !== 'C') invalid(mnemonic, at)
			if (named(first, 'F')) return b.byte(0xED, 0x70).done()
			const code = first.kind === Name ? R8[first.name] : undefined
			if (code === undefined) invalid(mnemonic, at)
			return b.byte(0xED, 0x40 | (code << 3)).done()
		}
		case 'OUT': {
			if (count !== 2) invalid(mnemonic, at)
			if (first.kind === Memory && named(second, 'A')) return b.byte(0xD3).add(Imm8, 0, first.expr, first.at).done()
			if (first.kind !== Indirect || first.name !== 'C') invalid(mnemonic, at)
			if (second.kind === Immediate && second.expr?.kind === ExprKind.Number && second.expr.value === 0) return b.byte(0xED, 0x71).done()
			const code = second.kind === Name ? R8[second.name] : undefined
			if (code === undefined) invalid(mnemonic, at)
			return b.byte(0xED, 0x41 | (code << 3)).done()
		}
	}
	throw new AssemblyError(`Unknown instruction ${mnemonic}`, at)
}

function encodeAlu(b: Builder, mnemonic: string, operands: readonly Operand[], at: Position): Builder {
	// `SUB A,B` and `ADD B` are both accepted: the accumulator is implied.
	let source: Operand
	if (operands.length === 2 && named(operands[0], 'A')) source = operands[1]
	else if (operands.length === 1) source = operands[0]
	else return invalid(mnemonic, at)
	const operation = ALU[mnemonic]
	const operand = r8(source)
	if (operand) return withR8(b, operand, 0x80 | (operation << 3) | operand.code, at)
	if (!value(source)) invalid(mnemonic, at)
	return b.byte(0xC6 | (operation << 3)).add(Imm8, 0, source.expr, source.at)
}

/** CB-prefixed: on a register, (HL), or (IX+d) with an optional register the result is copied to. */
function encodeCB(b: Builder, opcode: number, operand: R8Operand, copy: Operand | undefined, bit: Operand | null, mnemonic: string, at: Position): Builder {
	let code = operand.code
	if (copy !== undefined) {
		// Undocumented: (IX+d) with a register also loads the result into it.
		const target = copy.kind === Name ? R8[copy.name] : undefined
		if (!operand.prefix || target === undefined) invalid(mnemonic, at)
		code = target
	}
	if (operand.prefix) b.byte(operand.prefix, 0xCB).add(Displacement, 0, operand.displacement, at)
	else b.byte(0xCB)
	if (bit) b.add(BitNumber, opcode | code, bit.expr, bit.at)
	else b.byte(opcode | code)
	return b
}

function encodeLoad(b: Builder, operands: readonly Operand[], at: Position): Builder {
	if (operands.length !== 2) invalid('LD', at)
	const [target, source] = operands
	// Special registers.
	if (named(target, 'A') && named(source, 'I')) return b.byte(0xED, 0x57)
	if (named(target, 'A') && named(source, 'R')) return b.byte(0xED, 0x5F)
	if (named(target, 'I') && named(source, 'A')) return b.byte(0xED, 0x47)
	if (named(target, 'R') && named(source, 'A')) return b.byte(0xED, 0x4F)
	// The accumulator through BC, DE and an address.
	if (named(target, 'A') && source.kind === Indirect && (source.name === 'BC' || source.name === 'DE')) return b.byte(source.name === 'BC' ? 0x0A : 0x1A)
	if (target.kind === Indirect && (target.name === 'BC' || target.name === 'DE') && named(source, 'A')) return b.byte(target.name === 'BC' ? 0x02 : 0x12)
	if (named(target, 'A') && source.kind === Memory) return b.byte(0x3A).add(Imm16, 0, source.expr, source.at)
	if (target.kind === Memory && named(source, 'A')) return b.byte(0x32).add(Imm16, 0, target.expr, target.at)
	// 16-bit.
	if (target.kind === Name && (RP[target.name] !== undefined || PREFIX[target.name])) {
		const prefix = PREFIX[target.name] ?? 0
		const code = prefix ? 2 : RP[target.name]
		if (named(target, 'SP')) {
			const from = pairHL(source)
			if (from !== null) {
				if (from) b.byte(from)
				return b.byte(0xF9)
			}
		}
		if (source.kind === Memory) {
			if (code === 2) {
				if (prefix) b.byte(prefix)
				return b.byte(0x2A).add(Imm16, 0, source.expr, source.at)
			}
			return b.byte(0xED, 0x4B | (code << 4)).add(Imm16, 0, source.expr, source.at)
		}
		if (value(source)) {
			if (prefix) b.byte(prefix)
			return b.byte(0x01 | (code << 4)).add(Imm16, 0, source.expr, source.at)
		}
		return invalid('LD', at)
	}
	if (target.kind === Memory && source.kind === Name && (RP[source.name] !== undefined || PREFIX[source.name])) {
		const prefix = PREFIX[source.name] ?? 0
		const code = prefix ? 2 : RP[source.name]
		if (code === 2) {
			if (prefix) b.byte(prefix)
			return b.byte(0x22).add(Imm16, 0, target.expr, target.at)
		}
		return b.byte(0xED, 0x43 | (code << 4)).add(Imm16, 0, target.expr, target.at)
	}
	// 8-bit: r, (HL), (IX+d), IXH...
	const to = r8(target)
	if (!to) return invalid('LD', at)
	const from = r8(source)
	if (from) {
		if (to.code === 6 && from.code === 6) invalid('LD', at)
		const memory = to.code === 6 ? to : from.code === 6 ? from : null
		if (memory) {
			// The other operand of (HL) or (IX+d) is a plain register.
			const other = memory === to ? from : to
			if (other.half) invalid('LD', at)
			return withR8(b, memory, 0x40 | (to.code << 3) | from.code, at)
		}
		const prefix = to.prefix || from.prefix
		if ((to.prefix && from.prefix && to.prefix !== from.prefix)) invalid('LD', at)
		// With a prefix in force, H and L mean its halves, so they cannot be named.
		if (prefix && ((!to.half && (to.code === 4 || to.code === 5)) || (!from.half && (from.code === 4 || from.code === 5)))) invalid('LD', at)
		if (prefix) b.byte(prefix)
		return b.byte(0x40 | (to.code << 3) | from.code)
	}
	if (!value(source)) return invalid('LD', at)
	withR8(b, to, 0x06 | (to.code << 3), at)
	return b.add(Imm8, 0, source.expr, source.at)
}
