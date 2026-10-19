/**
 * Z80 source in the common zasm/sjasmplus spelling: `;` comments, `$FF`,
 * `#FF`, `0xFF`, `0FFh`, `%1010`, `0b1010` and `1010b` numbers, `'A'` and
 * `"text"` literals, and `$` alone for the current address.
 */

import type { AssemblySource } from '../../../core/assembly/sources'
import { TokenKind, makeToken, type Token } from '../../../core/assembly/tokens'
import { MNEMONICS } from './encoder'
import { DIRECTIVES } from './parser'

const { Identifier, Number: NumberToken, String: StringToken, Operator, Newline, Invalid } = TokenKind

const identifierStart = /[A-Za-z_.?@]/
const identifierPart = /[A-Za-z0-9_.?@]/
const twoCharacterOperators = new Set(['<<', '>>', '==', '!=', '<=', '>=', '&&', '||'])
const oneCharacterOperators = new Set(['+', '-', '*', '/', '%', '&', '|', '^', '~', '!', '(', ')', ',', ':', '=', '<', '>'])
const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', '0': '\0', '"': '"', '\'': '\'', '\\': '\\' }

/** A number spelled with a prefix or suffix base, or NaN. */
export function parseZ80Number(text: string): number {
	const lower = text.toLowerCase().replace(/_/g, '')
	let match: RegExpExecArray | null
	if ((match = /^(?:\$|#|0x)([0-9a-f]+)$/.exec(lower))) return parseInt(match[1], 16)
	if ((match = /^([0-9][0-9a-f]*)h$/.exec(lower))) return parseInt(match[1], 16)
	if ((match = /^(?:%|0b)([01]+)$/.exec(lower))) return parseInt(match[1], 2)
	if ((match = /^([01]+)b$/.exec(lower))) return parseInt(match[1], 2)
	if ((match = /^([0-7]+)[oq]$/.exec(lower))) return parseInt(match[1], 8)
	if ((match = /^([0-9]+)d?$/.exec(lower))) return parseInt(match[1], 10)
	return NaN
}

const isKeyword = (text: string) => {
	const upper = text.toUpperCase()
	return MNEMONICS.has(upper) || DIRECTIVES.has(upper.startsWith('.') ? upper.slice(1) : upper)
}

/** Whether a token ends an operand, so a following `%` is modulo rather than binary. */
const endsOperand = (token: Token | undefined) =>
	token !== undefined && ((token.kind === Identifier && !isKeyword(token.text)) || token.kind === NumberToken || (token.kind === Operator && token.text === ')'))

export function tokenizeZ80(source: AssemblySource): Token[] {
	const { code, name: file } = source
	const tokens: Token[] = []
	let index = 0
	let line = 1
	let lineStart = 0
	const push = (kind: number, text: string, start: number) => {
		const token = makeToken(kind, text, file, line, start - lineStart + 1, index - start)
		tokens.push(token)
		return token
	}
	const invalid = (message: string, start: number) => {
		tokens.push(makeToken(Invalid, message, file, line, start - lineStart + 1, Math.max(1, index - start)))
	}
	const number = (start: number) => {
		const text = code.slice(start, index)
		const value = parseZ80Number(text)
		if (Number.isNaN(value)) invalid(`Incomprehensible number ${text}`, start)
		else push(NumberToken, text, start).value = value
	}

	while (index < code.length) {
		const start = index
		const character = code[index]
		if (character === '\n') {
			tokens.push(makeToken(Newline, '\n', file, line, index - lineStart + 1, 1))
			index += 1
			line += 1
			lineStart = index
		} else if (/\s/.test(character)) {
			index += 1
		} else if (character === ';') {
			while (index < code.length && code[index] !== '\n') index += 1
		} else if ((character === '$' || character === '#') && /[0-9A-Fa-f]/.test(code[index + 1] ?? '')) {
			index += 1
			while (index < code.length && /[0-9A-Fa-f_]/.test(code[index])) index += 1
			number(start)
		} else if (character === '$') {
			index += 1
			push(Identifier, '$', start)
		} else if (character === '%' && /[01]/.test(code[index + 1] ?? '') && !endsOperand(tokens[tokens.length - 1])) {
			index += 1
			while (index < code.length && /[01_]/.test(code[index])) index += 1
			number(start)
		} else if (identifierStart.test(character)) {
			while (index < code.length && identifierPart.test(code[index])) index += 1
			// AF' is the alternate pair, not AF followed by a character literal.
			if (code.slice(start, index).toUpperCase() === 'AF' && code[index] === '\'') index += 1
			push(Identifier, code.slice(start, index), start)
		} else if (/[0-9]/.test(character)) {
			while (index < code.length && /[0-9A-Za-z_]/.test(code[index])) index += 1
			number(start)
		} else if (character === '"' || character === '\'') {
			index += 1
			let text = ''
			let closed = false
			while (index < code.length && code[index] !== '\n') {
				const next = code[index++]
				if (next === character) {
					closed = true
					break
				}
				// Only double-quoted strings take escapes, as sjasmplus has it.
				if (next === '\\' && character === '"' && index < code.length) {
					const escaped = code[index++]
					text += escapes[escaped] ?? escaped
				} else {
					text += next
				}
			}
			if (!closed) {
				invalid(character === '"' ? 'Unterminated string' : 'Unterminated character constant', start)
			} else if (text.length === 1) {
				// One character is a number wherever a value goes, and a byte in DB.
				const token = push(NumberToken, code.slice(start, index), start)
				token.value = text.charCodeAt(0) & 0xFF
				token.string = text
			} else {
				push(StringToken, code.slice(start, index), start).string = text
			}
		} else if (twoCharacterOperators.has(code.slice(index, index + 2))) {
			index += 2
			push(Operator, code.slice(start, index), start)
		} else if (oneCharacterOperators.has(character)) {
			index += 1
			push(Operator, character, start)
		} else {
			index += 1
			invalid(`Unexpected character '${character}'`, start)
		}
	}
	return tokens
}
