/**
 * GNU as lexical rules for AArch64 sources, a logical line at a time: comments
 * are already gone (see source.ts), `;` separates statements, and a number
 * keeps its exact 64-bit value beside the JavaScript one.
 */

import { TokenKind, makeToken, type Token } from '../../../../core/assembly/tokens'

const { Identifier, Number: NumberToken, String: StringToken, Operator, Newline, Invalid } = TokenKind

/** A token that may carry a number's exact value. */
export interface A64Token extends Token {
	big?: bigint
	/** A real literal, such as 1.5 or 2e-3, whose value is `value`. */
	real?: boolean
}

const FLOAT_START = /^[0-9]+(?:\.[0-9]*)?(?:e[0-9]*)?$/i
const FLOAT = /^[0-9]+(?:\.[0-9]*(?:e[+-]?[0-9]+)?|e[+-]?[0-9]+)$/i

const identifierStart = /[A-Za-z_.$]/
const identifierPart = /[A-Za-z0-9_.$]/
const twoCharacterOperators = new Set(['<<', '>>', '==', '!=', '<=', '>=', '&&', '||'])
const oneCharacterOperators = new Set(['#', '[', ']', '!', ',', ':', '=', '+', '-', '*', '/', '%', '&', '|', '^', '~', '(', ')', '{', '}', '<', '>'])
const escapes: Record<string, string> = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', '"': '"', '\'': '\'', '\\': '\\' }

/** GNU number syntax: 0x hex, 0b binary, a leading 0 octal, else decimal; null when malformed. */
export function parseA64Number(text: string): bigint | null {
	if (/^0x[0-9a-f]+$/i.test(text)) return BigInt(text)
	if (/^0b[01]+$/i.test(text)) return BigInt(text)
	if (/^0[0-7]+$/.test(text)) return BigInt(`0o${text.slice(1)}`)
	if (/^(?:[1-9][0-9]*|0)$/.test(text)) return BigInt(text)
	return null
}

/** Reads one character of a quoted literal at `index`; returns it and where the next starts. */
function readQuoted(text: string, index: number): { character: string, next: number } {
	const character = text[index]
	if (character !== '\\') return { character, next: index + 1 }
	const escaped = text[index + 1]
	if (escaped === undefined) throw new Error('Unterminated escape sequence')
	if (escaped in escapes) return { character: escapes[escaped], next: index + 2 }
	if (/[0-7]/.test(escaped)) {
		let end = index + 1
		while (end < index + 4 && /[0-7]/.test(text[end] ?? '')) end++
		const value = parseInt(text.slice(index + 1, end), 8)
		if (value > 255) throw new Error(`Octal escape \\${text.slice(index + 1, end)} is larger than one byte`)
		return { character: String.fromCharCode(value), next: end }
	}
	if (escaped === 'x') {
		let end = index + 2
		while (/[0-9a-fA-F]/.test(text[end] ?? '')) end++
		if (end === index + 2) throw new Error('\\x needs hex digits')
		return { character: String.fromCharCode(parseInt(text.slice(index + 2, end), 16) & 0xFF), next: end }
	}
	throw new Error(`Unknown escape sequence \\${escaped}`)
}

/** Tokens of one line; `column` is where `text` starts on its source line. */
export function tokenizeA64Line(text: string, file: string, line: number, column = 1): A64Token[] {
	const tokens: A64Token[] = []
	let index = 0
	const push = (kind: number, start: number, value?: string): A64Token => {
		const token: A64Token = makeToken(kind, value ?? text.slice(start, index), file, line, column + start, index - start)
		tokens.push(token)
		return token
	}
	while (index < text.length) {
		const start = index
		const character = text[index]
		if (/\s/.test(character)) {
			index++
		} else if (character === ';') {
			index++
			push(Newline, start, '\n')
		} else if (identifierStart.test(character)) {
			while (index < text.length && identifierPart.test(text[index])) index++
			push(Identifier, start)
		} else if (/[0-9]/.test(character)) {
			while (index < text.length && identifierPart.test(text[index])) index++
			const spelled = text.slice(start, index)
			// `1f` and `1b` name the next and previous local label `1`.
			if (/^\d+[fb]$/.test(spelled)) {
				push(Identifier, start)
				continue
			}
			const value = parseA64Number(spelled)
			if (value === null && FLOAT_START.test(spelled)) {
				// A real such as 1.5, 2.5e-3 or 1e6, for floating-point immediates and data.
				if (/e$/i.test(spelled) && /[+-]/.test(text[index] ?? '') && /[0-9]/.test(text[index + 1] ?? '')) {
					index++
					while (index < text.length && /[0-9]/.test(text[index])) index++
				}
				const real = text.slice(start, index)
				if (FLOAT.test(real)) {
					const token = push(NumberToken, start)
					token.value = Number(real)
					token.real = true
					continue
				}
			}
			if (value === null) {
				tokens.push(makeToken(Invalid, `Malformed number ${spelled}`, file, line, column + start, index - start))
				continue
			}
			const token = push(NumberToken, start)
			token.value = Number(value)
			token.big = value
		} else if (character === '"') {
			index++
			let decoded = ''
			try {
				for (;;) {
					if (index >= text.length) throw new Error('Unterminated string')
					if (text[index] === '"') {
						index++
						break
					}
					const { character: next, next: after } = readQuoted(text, index)
					decoded += next
					index = after
				}
				push(StringToken, start).string = decoded
			} catch (error) {
				index = text.length
				tokens.push(makeToken(Invalid, (error as Error).message, file, line, column + start, index - start))
			}
		} else if (character === '\'') {
			// 'c', with GNU's optional closing quote.
			try {
				if (index + 1 >= text.length) throw new Error('Unterminated character constant')
				const { character: next, next: after } = readQuoted(text, index + 1)
				index = text[after] === '\'' ? after + 1 : after
				const token = push(NumberToken, start)
				token.value = next.charCodeAt(0)
				token.big = BigInt(token.value)
			} catch (error) {
				index = text.length
				tokens.push(makeToken(Invalid, (error as Error).message, file, line, column + start, index - start))
			}
		} else if (twoCharacterOperators.has(text.slice(index, index + 2))) {
			index += 2
			push(Operator, start)
		} else if (oneCharacterOperators.has(character)) {
			index++
			push(Operator, start)
		} else {
			index++
			tokens.push(makeToken(Invalid, `Unexpected character '${character}'`, file, line, column + start, 1))
		}
	}
	return tokens
}
