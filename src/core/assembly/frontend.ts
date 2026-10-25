import { AssemblyError } from '../diagnostics'
import { Op, parseExpression, type ExpressionSyntax, type Expr } from './expressions'
import { makeToken, TokenCursor, TokenKind, type Position } from './tokens'
import { StatementKind, type Statement } from './assembler'

/** A conventional precedence ladder; dialect-specific shifts and unary operators stay explicit. */
export function integerSyntax(rightShift: number, modulo: boolean, unary: readonly [string, number][] = []): ExpressionSyntax {
	return {
		binary: new Map([
			['|', { op: Op.Or, precedence: 1 }], ['^', { op: Op.Xor, precedence: 2 }], ['&', { op: Op.And, precedence: 3 }],
			['<<', { op: Op.Shl, precedence: 4 }], ['>>', { op: rightShift, precedence: 4 }],
			['+', { op: Op.Add, precedence: 5 }], ['-', { op: Op.Sub, precedence: 5 }],
			['*', { op: Op.Mul, precedence: 6 }], ['/', { op: Op.Div, precedence: 6 }],
			...(modulo ? [['%', { op: Op.Mod, precedence: 6 }] as [string, { op: number, precedence: number }]] : []),
		]),
		unary: new Map([['-', Op.Neg], ['+', Op.Plus], ['~', Op.Not], ...unary]),
		dot: '.',
	}
}

/** One parser lifetime per dialect; tokenization and numeric spelling are configurable. */
export function expressionParser(config: {
	syntax: ExpressionSyntax
	tokens: RegExp
	isNumber(text: string): boolean
	number(text: string): number
	operator?(text: string): string | undefined
}): (text: string, at: Position) => Expr {
	return (text, at) => {
		const tokens = [...text.matchAll(config.tokens)].filter(match => !/^\s+$/.test(match[0])).map(match => {
			const part = match[0], numeric = config.isNumber(part), operator = config.operator?.(part)
			const token = makeToken(numeric ? TokenKind.Number : operator !== undefined || !/^[\w.$]/.test(part) ? TokenKind.Operator : TokenKind.Identifier,
				operator ?? part, at.file, at.line, at.column + match.index)
			if (numeric) token.value = config.number(part)
			return token
		})
		const cursor = new TokenCursor(tokens), value = parseExpression(cursor, config.syntax)
		if (!value || !cursor.atEnd()) throw new AssemblyError(`Invalid expression '${text}'`, at)
		return value
	}
}

export function quotedBytes(args: readonly string[], terminated: boolean): Uint8Array {
	const decoded: unknown[] = args.map(arg => JSON.parse(arg))
	if (decoded.some(value => typeof value !== 'string')) throw new Error('Expected quoted strings')
	return new TextEncoder().encode(decoded.join('') + (terminated ? '\0' : ''))
}

/** Shared emission plumbing; directive names, widths and string support are dialect choices. */
export function* dataStatements(args: readonly string[], size: number, at: Position, expression: (text: string, at: Position) => Expr, reserve: (bytes: number) => void, byteStrings = false): Generator<Statement> {
	if (!args.length) throw new Error('Data directive needs values')
	reserve(size * args.length)
	for (const arg of args) {
		if (byteStrings && size === 1 && arg.startsWith('"')) {
			const bytes = quotedBytes([arg], false)
			reserve(bytes.length - 1)
			yield { kind: StatementKind.Bytes, bytes, at }
			continue
		}
		yield { kind: StatementKind.Emit, size, value: expression(arg, at), at }
	}
}

export function reservationBytes(count: number, unit: number, limit: number, diagnostic: string): Uint8Array {
	const bytes = count * unit
	if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > limit) throw new Error(diagnostic)
	return new Uint8Array(bytes)
}
