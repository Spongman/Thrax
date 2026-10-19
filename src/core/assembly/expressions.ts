import { AssemblyError } from '../diagnostics'
import { TokenKind, positionOf, type Position, type TokenCursor } from './tokens'

/** Operator codes; a dialect maps its spellings to these and supplies their arithmetic. */
export class Op {
	static readonly Add = 0
	static readonly Sub = 1
	static readonly Mul = 2
	static readonly Div = 3
	static readonly Mod = 4
	static readonly And = 5
	static readonly Or = 6
	static readonly Xor = 7
	static readonly Shl = 8
	static readonly Shr = 9
	static readonly Sar = 10
	static readonly Neg = 11
	static readonly Not = 12
	static readonly Plus = 13
}

export class ExprKind {
	static readonly Number = 0
	static readonly Symbol = 1
	static readonly Dot = 2
	static readonly Unary = 3
	static readonly Binary = 4
}

const { Number: NumberExpr, Symbol: SymbolExpr, Dot, Unary, Binary } = ExprKind

export type Expr =
	| { kind: 0; value: number }
	| { kind: 1; name: string; at: Position }
	| { kind: 2 }
	| { kind: 3; op: number; operand: Expr }
	| { kind: 4; op: number; left: Expr; right: Expr; at: Position }

export interface ExpressionSyntax {
	/** Equal precedences associate left to right; higher binds tighter. */
	binary: ReadonlyMap<string, { op: number; precedence: number }>
	unary: ReadonlyMap<string, number>
	/** Identifier spelling of the location counter, if any. */
	dot: string | null
}

export interface Arithmetic {
	unary(op: number, value: number): number
	binary(op: number, left: number, right: number, at: Position): number
}

export interface EvaluationScope {
	lookup(name: string): number | undefined
	readonly dot: number
}

/** Parse one expression, or return null when no operand starts here. */
export function parseExpression(cursor: TokenCursor, syntax: ExpressionSyntax): Expr | null {
	if (!startsOperand(cursor, syntax)) return null
	return parseBinary(cursor, syntax, 0)
}

function startsOperand(cursor: TokenCursor, syntax: ExpressionSyntax): boolean {
	const token = cursor.peek()
	if (token.kind === TokenKind.Identifier || token.kind === TokenKind.Number) return true
	return token.kind === TokenKind.Operator && (token.text === '(' || syntax.unary.has(token.text))
}

function parseBinary(cursor: TokenCursor, syntax: ExpressionSyntax, minimum: number): Expr {
	let left = parseUnary(cursor, syntax)
	for (;;) {
		const token = cursor.peek()
		const operator = token.kind === TokenKind.Operator ? syntax.binary.get(token.text) : undefined
		if (!operator || operator.precedence < minimum) return left
		cursor.next()
		if (!startsOperand(cursor, syntax)) {
			throw new AssemblyError(`Expected operand after operator '${token.text}'`, positionOf(cursor.peek()))
		}
		const right = parseBinary(cursor, syntax, operator.precedence + 1)
		left = { kind: Binary, op: operator.op, left, right, at: positionOf(token) }
	}
}

function parseUnary(cursor: TokenCursor, syntax: ExpressionSyntax): Expr {
	const token = cursor.next()
	if (token.kind === TokenKind.Number) return { kind: NumberExpr, value: token.value }
	if (token.kind === TokenKind.Identifier) {
		return token.text === syntax.dot ? { kind: Dot } : { kind: SymbolExpr, name: token.text, at: positionOf(token) }
	}
	if (token.kind === TokenKind.Operator) {
		if (token.text === '(') {
			if (!startsOperand(cursor, syntax)) throw new AssemblyError('Expected expression between grouping parentheses', positionOf(cursor.peek()))
			const inner = parseBinary(cursor, syntax, 0)
			cursor.expect(')', 'Expected closing parenthesis')
			return inner
		}
		const op = syntax.unary.get(token.text)
		if (op !== undefined) {
			if (!startsOperand(cursor, syntax)) {
				throw new AssemblyError(`Expected value after unary '${token.text}' operator`, positionOf(cursor.peek()))
			}
			return { kind: Unary, op, operand: parseUnary(cursor, syntax) }
		}
	}
	throw new AssemblyError(`Unexpected '${token.text}' in expression`, positionOf(token))
}

/**
 * Undefined symbols yield undefined when not strict, so a layout pass can size
 * code before forward references are known; strict evaluation reports them.
 */
export function evaluate(expr: Expr, scope: EvaluationScope, arithmetic: Arithmetic, strict: boolean): number | undefined {
	switch (expr.kind) {
		case NumberExpr: return expr.value
		case Dot: return scope.dot
		case SymbolExpr: {
			const value = scope.lookup(expr.name)
			if (value === undefined && strict) throw new AssemblyError(`Symbol '${expr.name}' is undefined`, expr.at)
			return value
		}
		case Unary: {
			const value = evaluate(expr.operand, scope, arithmetic, strict)
			return value === undefined ? undefined : arithmetic.unary(expr.op, value)
		}
		case Binary: {
			const left = evaluate(expr.left, scope, arithmetic, strict)
			const right = evaluate(expr.right, scope, arithmetic, strict)
			return left === undefined || right === undefined ? undefined : arithmetic.binary(expr.op, left, right, expr.at)
		}
	}
}
