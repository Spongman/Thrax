import type { AssemblySource } from '../../../core/assembly/sources'
import { TokenKind, makeToken, type Token } from '../../../core/assembly/tokens'
import { INSN_BY_NAME } from '../isa'

const { Identifier, Number: NumberToken, String: StringToken, Operator, Newline, Invalid } = TokenKind

const identifierStart = /[A-Za-z_.@]/
const identifierPart = /[A-Za-z0-9_.@]/
const twoCharacterOperators = new Set(['<<', '>>', ':='])
const oneCharacterOperators = new Set(['+', '-', '*', '/', '&', '|', '^', '~', '<', '>', '(', ')', ',', ':', '=', '#'])
const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', '0': '\0', '"': '"', '\'': '\'', '\\': '\\' }

/** The spelling of the location counter in expressions. */
export const PC_SYMBOL = '*'

/**
 * Whether a `*` after `previous` on the same line is the location counter
 * rather than multiplication: at the start of a statement, after an operator
 * other than `)`, or straight after a mnemonic or directive.
 */
function startsOperand(previous: Token | undefined): boolean {
	if (!previous || previous.kind === Newline) return true
	if (previous.kind === Operator) return previous.text !== ')'
	if (previous.kind !== Identifier) return false
	return previous.text === PC_SYMBOL ? false : previous.text.startsWith('.') || INSN_BY_NAME.has(previous.text.toUpperCase())
}

/**
 * Tokenize ca65-style source: `;` comments, `$` hex, `%` binary, `0x` hex and
 * decimal numbers, `'c'` characters, `"..."` strings with C escapes, and `*`
 * as the location counter where an operand starts. Line breaks are tokens.
 */
export function tokenizeMos6502(source: AssemblySource): Token[] {
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
	const invalid = (message: string, start: number) =>
		tokens.push(makeToken(Invalid, message, file, line, start - lineStart + 1, Math.max(1, index - start)))
	const number = (text: string, value: number, start: number) => {
		if (Number.isNaN(value)) invalid(`Incomprehensible number ${text}; numbers are decimal, $hex, %binary or 0xhex`, start)
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
		} else if (identifierStart.test(character)) {
			while (index < code.length && identifierPart.test(code[index])) index += 1
			push(Identifier, code.slice(start, index), start)
		} else if (character === '$' || (character === '%' && /[01]/.test(code[index + 1] ?? ''))) {
			index += 1
			while (index < code.length && /[0-9A-Za-z_]/.test(code[index])) index += 1
			const text = code.slice(start, index)
			const digits = text.slice(1)
			const valid = character === '$' ? /^[0-9A-Fa-f]+$/.test(digits) : /^[01]+$/.test(digits)
			number(text, valid ? Number.parseInt(digits, character === '$' ? 16 : 2) : NaN, start)
		} else if (/[0-9]/.test(character)) {
			while (index < code.length && /[0-9A-Za-z_]/.test(code[index])) index += 1
			const text = code.slice(start, index)
			const value = /^0x[0-9a-f]+$/i.test(text) ? Number.parseInt(text.slice(2), 16) : /^[0-9]+$/.test(text) ? Number.parseInt(text, 10) : NaN
			number(text, value, start)
		} else if (character === '"' || character === '\'') {
			index += 1
			let text = ''
			let error: string | null = null
			for (;;) {
				const next = code[index]
				if (next === undefined || next === '\n') {
					error = character === '"' ? 'Unterminated string' : 'Unterminated character constant'
					break
				}
				index += 1
				if (next === character) break
				if (next !== '\\') {
					text += next
					continue
				}
				const escaped = code[index++]
				if (escaped !== undefined && escaped in escapes) text += escapes[escaped]
				else {
					error = `Unknown escape sequence \\${escaped ?? ''}`
					break
				}
			}
			if (error) {
				while (index < code.length && code[index] !== '\n') index += 1
				invalid(error, start)
			} else if (character === '"') {
				push(StringToken, code.slice(start, index), start).string = text
			} else if (text.length !== 1) {
				invalid('A character constant holds exactly one character; use .byte "..." for more', start)
			} else {
				push(NumberToken, code.slice(start, index), start).value = text.charCodeAt(0)
			}
		} else if (character === '*' && startsOperand(tokens[tokens.length - 1])) {
			index += 1
			push(Identifier, PC_SYMBOL, start)
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
