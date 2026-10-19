import type { AssemblySource } from '../../../core/assembly/sources'
import { TokenKind, makeToken, type Token } from '../../../core/assembly/tokens'

const { Identifier, Number: NumberToken, String: StringToken, Operator, Newline, Invalid } = TokenKind

const identifierStart = /[$.@A-Za-z_]/
const identifierPart = /[$.@A-Za-z0-9_]/
const twoCharacterOperators = new Set(['<<', '>>'])
const oneCharacterOperators = new Set(['+', '-', '*', '/', '%', '&', '|', '~', '(', ')', ',', ':', '=', '{', '}'])
const escapes: Record<string, string> = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', '"': '"', '\'': '\'', '\\': '\\' }

/** BSim number syntax: 0x hex, 0b binary, leading-zero octal, otherwise decimal. */
export function parseUasmNumber(text: string): number {
	if (/^0x[0-9a-f]+$/i.test(text)) return parseInt(text, 16)
	if (/^0b[01]+$/i.test(text)) return parseInt(text.slice(2), 2)
	if (/^0[0-7]+$/.test(text)) return parseInt(text, 8)
	if (/^(?:[1-9][0-9]*|0)$/.test(text)) return parseInt(text, 10)
	return NaN
}

/** Tokenize UASM source following BSim's lexical rules; line breaks are tokens. */
export function tokenizeUasm(source: AssemblySource): Token[] {
	const { code, name: file } = source
	const tokens: Token[] = []
	let index = 0
	let line = 1
	let lineStart = 0
	const column = () => index - lineStart + 1
	const push = (kind: number, text: string, start: number, startLine = line, startColumn = start - lineStart + 1) => {
		const token = makeToken(kind, text, file, startLine, startColumn, index - start)
		tokens.push(token)
		return token
	}
	const invalid = (message: string, start: number, startLine = line, startColumn = start - lineStart + 1) =>
		tokens.push(makeToken(Invalid, message, file, startLine, startColumn, Math.max(1, index - start)))
	const newline = () => {
		tokens.push(makeToken(Newline, '\n', file, line, column(), 1))
		index += 1
		line += 1
		lineStart = index
	}

	// Reads one character of a quoted literal, or returns null at the closing quote.
	const readQuoted = (quote: string): string | null => {
		const character = code[index++]
		if (character === quote) return null
		if (character !== '\\') return character
		const escaped = code[index++]
		if (escaped !== undefined && escaped in escapes) return escapes[escaped]
		if (escaped !== undefined && /[0-7]/.test(escaped)) {
			let digits = escaped
			while (digits.length < 3 && /[0-7]/.test(code[index] ?? '')) digits += code[index++]
			const value = parseInt(digits, 8)
			if (value > 255) throw new Error(`Octal escape sequence \\${digits} is larger than one byte (max is \\377)`)
			return String.fromCharCode(value)
		}
		throw new Error(`Unknown escape sequence \\${escaped ?? ''}`)
	}

	while (index < code.length) {
		const start = index
		const character = code[index]
		if (character === '\n') {
			newline()
		} else if (/\s/.test(character)) {
			index += 1
		} else if (code.startsWith('//', index)) {
			while (index < code.length && code[index] !== '\n') index += 1
		} else if (code.startsWith('/*', index)) {
			const startLine = line
			const startColumn = column()
			const end = code.indexOf('*/', index + 2)
			const stop = end < 0 ? code.length : end + 2
			index += 2
			// Line breaks inside a block comment still end statements.
			while (index < stop) {
				if (code[index] === '\n') newline()
				else index += 1
			}
			if (end < 0) invalid('Unclosed block comment', start, startLine, startColumn)
		} else if (identifierStart.test(character)) {
			while (index < code.length && identifierPart.test(code[index])) index += 1
			push(Identifier, code.slice(start, index), start)
		} else if (/[0-9]/.test(character)) {
			while (index < code.length && identifierPart.test(code[index])) index += 1
			const text = code.slice(start, index)
			const value = parseUasmNumber(text)
			if (Number.isNaN(value)) {
				invalid(`Incomprehensible number ${text}; acceptable bases are hex (0x...), octal (0...), binary (0b...) and decimal`, start)
			} else {
				push(NumberToken, text, start).value = value
			}
		} else if (character === '\'' || character === '"') {
			const startColumn = column()
			index += 1
			let text = ''
			try {
				for (;;) {
					if (index >= code.length || code[index] === '\n') throw new Error(character === '"' ? 'Unterminated string constant' : 'Unterminated character constant')
					const next = readQuoted(character)
					if (next === null) break
					text += next
				}
				if (character === '"') {
					push(StringToken, code.slice(start, index), start).string = text
				} else if (text.length !== 1) {
					invalid('Character constants must have exactly one character (for more, try .ascii or .text)', start, line, startColumn)
				} else {
					push(NumberToken, code.slice(start, index), start).value = text.charCodeAt(0)
				}
			} catch (error) {
				invalid((error as Error).message, start, line, startColumn)
				while (index < code.length && code[index] !== '\n') index += 1
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
