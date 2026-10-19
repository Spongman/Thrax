/**
 * Operands of A64 instructions in GNU syntax: registers, `#` immediates,
 * `:lo12:` relocations, `[base, offset]` addresses, shifts, extends, `=`
 * literals and bare expressions such as labels and condition names.
 */

import { AssemblyError } from '../../../../core/diagnostics'
import { Op, parseExpression, type Expr, type ExpressionSyntax } from '../../../../core/assembly/expressions'
import { TokenCursor, TokenKind, positionOf, type Position } from '../../../../core/assembly/tokens'
import { EXTENDS, SHIFTS } from '../isa'
import type { A64Token } from './tokenizer'

export class OperandKind {
	static readonly REGISTER = 0
	static readonly IMMEDIATE = 1
	static readonly MEMORY = 2
	static readonly SHIFT = 3
	static readonly EXTEND = 4
	static readonly LITERAL = 5
	static readonly EXPRESSION = 6
}

const { REGISTER, IMMEDIATE, MEMORY, SHIFT, EXTEND, LITERAL, EXPRESSION } = OperandKind

/** A value worked out once symbols are known; `exact` holds a literal's full 64 bits. */
export interface Value {
	expr: Expr
	exact: bigint | null
	/** `:lo12:`: only the low 12 bits, as ADD and loads take a page offset. */
	lo12: boolean
	at: Position
}

export interface RegisterOperand {
	kind: 0
	n: number
	wide: boolean
	/** SP or WSP. */
	sp: boolean
	/** XZR or WZR. */
	zr: boolean
	name: string
	at: Position
}

export interface ImmediateOperand { kind: 1, value: Value, at: Position }

export interface ShiftOperand { kind: 3, shift: number, amount: Value | null, at: Position }

export interface ExtendOperand { kind: 4, extend: number, amount: Value | null, at: Position }

export interface MemoryOperand {
	kind: 2
	base: RegisterOperand
	offset: Value | null
	index: RegisterOperand | null
	/** How the index register is extended or shifted. */
	modifier: ShiftOperand | ExtendOperand | null
	/** `[...]!`: pre-index. */
	writeback: boolean
	/** `[base], #imm`: post-index, filled in by the parser. */
	post: Value | null
	at: Position
}

export interface LiteralOperand { kind: 5, value: Value, at: Position }

/** A bare expression; `name` is set when it is a single identifier, such as a condition. */
export interface ExpressionOperand { kind: 6, value: Value, name: string | null, at: Position }

export type Operand = RegisterOperand | ImmediateOperand | MemoryOperand | ShiftOperand | ExtendOperand | LiteralOperand | ExpressionOperand

/** GNU as precedence: multiplicative and shifts, then bitwise, then additive. */
export const A64_EXPRESSIONS: ExpressionSyntax = {
	binary: new Map([
		['*', { op: Op.Mul, precedence: 3 }], ['/', { op: Op.Div, precedence: 3 }], ['%', { op: Op.Mod, precedence: 3 }],
		['<<', { op: Op.Shl, precedence: 3 }], ['>>', { op: Op.Shr, precedence: 3 }],
		['|', { op: Op.Or, precedence: 2 }], ['&', { op: Op.And, precedence: 2 }], ['^', { op: Op.Xor, precedence: 2 }],
		['+', { op: Op.Add, precedence: 1 }], ['-', { op: Op.Sub, precedence: 1 }],
	]),
	unary: new Map([['-', Op.Neg], ['~', Op.Not], ['+', Op.Plus]]),
	dot: '.',
}

const NAMED: Readonly<Record<string, { n: number, wide: boolean, sp?: boolean, zr?: boolean }>> = {
	sp: { n: 31, wide: true, sp: true }, wsp: { n: 31, wide: false, sp: true },
	xzr: { n: 31, wide: true, zr: true }, wzr: { n: 31, wide: false, zr: true },
	lr: { n: 30, wide: true }, fp: { n: 29, wide: true }, ip0: { n: 16, wide: true }, ip1: { n: 17, wide: true },
}

/** The general-purpose register a name spells, or null. */
export function registerByName(name: string): { n: number, wide: boolean, sp: boolean, zr: boolean } | null {
	const lower = name.toLowerCase()
	const named = NAMED[lower]
	if (named) return { n: named.n, wide: named.wide, sp: named.sp ?? false, zr: named.zr ?? false }
	const match = /^([xw])([0-9]|[12][0-9]|30)$/.exec(lower)
	return match ? { n: Number(match[2]), wide: match[1] === 'x', sp: false, zr: false } : null
}

const fail = (message: string, at: Position): never => { throw new AssemblyError(message, at) }

/** Splits a statement's operand tokens at the commas outside brackets. */
export function splitOperands(tokens: readonly A64Token[]): A64Token[][] {
	const groups: A64Token[][] = [[]]
	let depth = 0
	for (const token of tokens) {
		if (token.kind === TokenKind.Operator) {
			if (token.text === '[' || token.text === '(' || token.text === '{') depth++
			else if (token.text === ']' || token.text === ')' || token.text === '}') depth--
			else if (token.text === ',' && depth === 0) {
				groups.push([])
				continue
			}
		}
		groups[groups.length - 1].push(token)
	}
	return groups.length === 1 && groups[0].length === 0 ? [] : groups
}

const isOperator = (token: A64Token | undefined, text: string) => token?.kind === TokenKind.Operator && token.text === text

/** A value from `tokens`, after any `#`; `:lo12:` may lead it. */
export function parseValue(tokens: readonly A64Token[], at: Position): Value {
	let rest = tokens
	if (isOperator(rest[0], '#')) rest = rest.slice(1)
	let lo12 = false
	if (isOperator(rest[0], ':')) {
		const name = rest[1]
		if (name?.kind !== TokenKind.Identifier || !isOperator(rest[2], ':')) fail('Expected a relocation such as :lo12:', positionOf(rest[0]))
		if (name.text.toLowerCase() !== 'lo12') fail(`Unsupported relocation :${name.text}:`, positionOf(name))
		lo12 = true
		rest = rest.slice(3)
	}
	if (rest.length === 0) fail('Expected a value', at)
	const position = positionOf(rest[0])
	const exact = exactLiteral(rest)
	const cursor = new TokenCursor(rest)
	const expr = parseExpression(cursor, A64_EXPRESSIONS)
	if (!expr) fail(`Unexpected '${rest[0].text}'`, position)
	if (!cursor.atEnd()) fail(`Unexpected '${cursor.peek().text}' after the value`, positionOf(cursor.peek()))
	return { expr: expr!, exact, lo12, at: position }
}

/** A number with at most a sign or complement before it, exactly. */
function exactLiteral(tokens: readonly A64Token[]): bigint | null {
	const last = tokens[tokens.length - 1]
	if (last?.big === undefined) return null
	if (tokens.length === 1) return last.big
	if (tokens.length !== 2 || tokens[0].kind !== TokenKind.Operator) return null
	switch (tokens[0].text) {
		case '-': return -last.big
		case '~': return ~last.big
		case '+': return last.big
	}
	return null
}

function registerOperand(token: A64Token): RegisterOperand | null {
	if (token.kind !== TokenKind.Identifier) return null
	const found = registerByName(token.text)
	return found && { kind: REGISTER, ...found, name: token.text.toLowerCase(), at: positionOf(token) }
}

/** `lsl #2`, `uxtw`, `sxtx #3`, or null where `tokens` are not one. */
function modifierOperand(tokens: readonly A64Token[]): ShiftOperand | ExtendOperand | null {
	const head = tokens[0]
	if (head?.kind !== TokenKind.Identifier) return null
	const lower = head.text.toLowerCase()
	const at = positionOf(head)
	const shift = SHIFTS.indexOf(lower)
	const extend = EXTENDS.indexOf(lower)
	if (shift < 0 && extend < 0) return null
	// A lone shift name is a symbol of that name, unless an amount follows.
	if (shift >= 0 && tokens.length === 1) return null
	const amount = tokens.length > 1 ? parseValue(tokens.slice(1), at) : null
	return shift >= 0 ? { kind: SHIFT, shift, amount, at } : { kind: EXTEND, extend, amount, at }
}

function memoryOperand(tokens: readonly A64Token[]): MemoryOperand {
	const at = positionOf(tokens[0])
	let close = tokens.length - 1
	let writeback = false
	if (isOperator(tokens[close], '!')) {
		writeback = true
		close--
	}
	if (!isOperator(tokens[close], ']')) fail('Expected ] to close the address', positionOf(tokens[close] ?? tokens[0]))
	const parts = splitOperands(tokens.slice(1, close))
	if (parts.length === 0 || parts.length > 3) fail('An address is [base], [base, offset] or [base, index, extend]', at)
	const base = parts[0].length === 1 ? registerOperand(parts[0][0]) : null
	if (!base || !base.wide || base.zr) fail('The base of an address is an X register or SP', parts[0][0] ? positionOf(parts[0][0]) : at)
	let offset: Value | null = null
	let index: RegisterOperand | null = null
	let modifier: ShiftOperand | ExtendOperand | null = null
	if (parts.length > 1) {
		const second = parts[1]
		index = second.length === 1 ? registerOperand(second[0]) : null
		if (!index) offset = parseValue(second, positionOf(second[0] ?? tokens[0]))
	}
	if (parts.length > 2) {
		if (!index) fail('Only a register offset can be extended or shifted', at)
		modifier = modifierOperand(parts[2])
		if (!modifier) fail('Expected an extend or shift such as lsl #3 or sxtw', positionOf(parts[2][0] ?? tokens[0]))
	}
	return { kind: MEMORY, base: base!, offset, index, modifier, writeback, post: null, at }
}

/** One operand from its tokens. */
export function parseOperand(tokens: readonly A64Token[], at: Position): Operand {
	const head = tokens[0]
	if (!head) fail('Missing operand', at)
	const position = positionOf(head)
	if (isOperator(head, '[')) return memoryOperand(tokens)
	if (isOperator(head, '=')) return { kind: LITERAL, value: parseValue(tokens.slice(1), position), at: position }
	if (isOperator(head, '#') || isOperator(head, ':')) return { kind: IMMEDIATE, value: parseValue(tokens, position), at: position }
	if (tokens.length === 1) {
		const register = registerOperand(head)
		if (register) return register
	}
	const modifier = modifierOperand(tokens)
	if (modifier) return modifier
	const value = parseValue(tokens, position)
	return { kind: EXPRESSION, value, name: tokens.length === 1 && head.kind === TokenKind.Identifier ? head.text : null, at: position }
}

/** Every operand of a statement, a post-index folded into the address before it. */
export function parseOperands(tokens: readonly A64Token[], at: Position): Operand[] {
	const operands = splitOperands(tokens).map((group) => parseOperand(group, group[0] ? positionOf(group[0]) : at))
	for (let index = 0; index < operands.length - 1; index++) {
		const operand = operands[index]
		const next = operands[index + 1]
		if (operand.kind !== MEMORY || (next.kind !== IMMEDIATE && next.kind !== EXPRESSION)) continue
		if (operand.writeback || operand.offset || operand.index) fail('A post-indexed address is [base] followed by an offset', next.at)
		operand.post = next.value
		operands.splice(index + 1, 1)
	}
	return operands
}
