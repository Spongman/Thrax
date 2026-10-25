/**
 * Lexical rules of the two ARM assembler dialects.  Line breaks are tokens, so
 * the parser works a line at a time.
 *
 * GNU as: `@` and `//` start comments, as does `#` first on a line; `/* *\/`
 * blocks; `;` separates statements on one line.  Numbers are C's (0x, 0b,
 * leading-zero octal) and `1b` or `2f` name the nearest local label `1` back
 * or `2` ahead.  `\name` is a macro parameter.
 *
 * armasm: `;` starts a comment.  `&FF` and `2_1010` are numbers besides the
 * C forms, `|name|` quotes a symbol, and `:AND:` style operators read as one
 * operator token, lower-cased.
 */

import type { AssemblySource } from '../../../../core/assembly/sources'
import { TokenKind, makeToken, type Token } from '../../../../core/assembly/tokens'
import { DIALECT_ARMASM } from './dialect'

const { Identifier, Number: NumberToken, String: StringToken, Operator, Newline, Invalid } = TokenKind

const GNU_START = /[A-Za-z_.$]/
const GNU_PART = /[A-Za-z0-9_.$]/
const ARMASM_START = /[A-Za-z_.]/
const ARMASM_PART = /[A-Za-z0-9_.]/
const TWO_CHARACTER = new Set(['<<', '>>'])
const ONE_CHARACTER = new Set(['+', '-', '*', '/', '%', '&', '|', '^', '~', '!', '(', ')', ',', ':', '=', '#', '[', ']', '{', '}'])
const ESCAPES: Record<string, string> = { a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '"': '"', '\'': '\'', '\\': '\\' }

/** C number syntax, plus armasm's `&hex` and `base_digits`; NaN when malformed. */
export function parseArmNumber(text: string, armasm: boolean): number {
	if (/^0x[0-9a-f]+$/i.test(text)) return parseInt(text.slice(2), 16)
	if (/^0b[01]+$/i.test(text)) return parseInt(text.slice(2), 2)
	if (armasm) {
		if (/^&[0-9a-f]+$/i.test(text)) return parseInt(text.slice(1), 16)
		const based = /^([2-9])_([0-9]+)$/.exec(text)
		if (based) {
			const base = Number(based[1])
			return [...based[2]].every((digit) => Number(digit) < base) ? parseInt(based[2], base) : NaN
		}
		if (/^[0-9]+$/.test(text)) return parseInt(text, 10)
		return NaN
	}
	if (/^0[0-7]+$/.test(text)) return parseInt(text, 8)
	if (/^(?:[1-9][0-9]*|0)$/.test(text)) return parseInt(text, 10)
	return NaN
}

/** Tokenizes one source in `dialect`. */
export function tokenizeArm(source: AssemblySource, dialect: number): Token[] {
	const armasm = dialect === DIALECT_ARMASM
	const start = armasm ? ARMASM_START : GNU_START
	const part = armasm ? ARMASM_PART : GNU_PART
	const { code, name: file } = source
	const tokens: Token[] = []
	let index = 0
	let line = 1
	let lineStart = 0
	/** Whether only blanks precede `index` on its line. */
	let lineEmpty = true
	const push = (kind: number, text: string, from: number) => {
		const token = makeToken(kind, text, file, line, from - lineStart + 1, index - from)
		tokens.push(token)
		lineEmpty = false
		return token
	}
	const invalid = (message: string, from: number) => {
		tokens.push(makeToken(Invalid, message, file, line, from - lineStart + 1, Math.max(1, index - from)))
		lineEmpty = false
	}
	const newline = () => {
		tokens.push(makeToken(Newline, '\n', file, line, index - lineStart + 1, 1))
		index += 1
		line += 1
		lineStart = index
		lineEmpty = true
	}
	const skipToLineEnd = () => {
		while (index < code.length && code[index] !== '\n') index += 1
	}

	/** One character of a quoted literal, or null at the closing quote. */
	const readQuoted = (quote: string): string | null => {
		const character = code[index++]
		if (character === quote) return null
		if (character !== '\\') return character
		const escaped = code[index++]
		if (escaped !== undefined && escaped in ESCAPES) return ESCAPES[escaped]
		if (escaped === 'x' && /[0-9a-f]/i.test(code[index] ?? '')) {
			let digits = ''
			while (digits.length < 2 && /[0-9a-f]/i.test(code[index] ?? '')) digits += code[index++]
			return String.fromCharCode(parseInt(digits, 16))
		}
		if (escaped !== undefined && /[0-7]/.test(escaped)) {
			let digits = escaped
			while (digits.length < 3 && /[0-7]/.test(code[index] ?? '')) digits += code[index++]
			return String.fromCharCode(parseInt(digits, 8) & 0xFF)
		}
		throw new Error(`Unknown escape sequence \\${escaped ?? ''}`)
	}

	const quoted = (quote: string, from: number) => {
		index += 1
		let text = ''
		try {
			for (;;) {
				if (index >= code.length || code[index] === '\n') throw new Error(quote === '"' ? 'Unterminated string' : 'Unterminated character constant')
				const next = readQuoted(quote)
				if (next === null) break
				text += next
			}
			if (quote === '"') {
				push(StringToken, code.slice(from, index), from).string = text
			} else if (text.length !== 1) {
				invalid('A character constant holds exactly one character', from)
			} else {
				push(NumberToken, code.slice(from, index), from).value = text.charCodeAt(0)
			}
		} catch (error) {
			skipToLineEnd()
			invalid((error as Error).message, from)
		}
	}

	while (index < code.length) {
		const from = index
		const character = code[index]
		if (character === '\n') {
			newline()
		} else if (/\s/.test(character)) {
			index += 1
		} else if (armasm ? character === ';' : character === '@' || code.startsWith('//', index) || (character === '#' && lineEmpty)) {
			skipToLineEnd()
		} else if (!armasm && character === ';') {
			// GNU's statement separator: a line break for the parser.
			tokens.push(makeToken(Newline, ';', file, line, index - lineStart + 1, 1))
			index += 1
		} else if (!armasm && code.startsWith('/*', index)) {
			const end = code.indexOf('*/', index + 2)
			const stop = end < 0 ? code.length : end + 2
			index += 2
			while (index < stop) {
				if (code[index] === '\n') newline()
				else index += 1
			}
			if (end < 0) invalid('Unclosed block comment', from)
		} else if (!armasm && character === '\\') {
			// A macro parameter, `\@` or `\()`; only meaningful inside a macro body.
			index += 1
			if (code.startsWith('()', index)) index += 2
			else if (code[index] === '@') index += 1
			else while (index < code.length && part.test(code[index])) index += 1
			push(Identifier, code.slice(from, index), from)
		} else if (armasm && character === '|') {
			const end = code.indexOf('|', index + 1)
			if (end < 0 || code.slice(index, end).includes('\n')) {
				skipToLineEnd()
				invalid('Unterminated |symbol|', from)
			} else {
				index = end + 1
				push(Identifier, code.slice(from + 1, end), from)
			}
		} else if (armasm && character === ':' && /^:[A-Za-z]+:/.test(code.slice(index, index + 8))) {
			index = code.indexOf(':', index + 1) + 1
			push(Operator, code.slice(from, index).toLowerCase(), from)
		} else if (start.test(character)) {
			// The first character is always taken, so a start that is not also a part cannot stall.
			index += 1
			while (index < code.length && part.test(code[index])) index += 1
			push(Identifier, code.slice(from, index), from)
		} else if (/[0-9]/.test(character) || (armasm && character === '&' && /[0-9a-f]/i.test(code[index + 1] ?? ''))) {
			index += 1
			while (index < code.length && /[0-9A-Za-z_]/.test(code[index])) index += 1
			const text = code.slice(from, index)
			if (!armasm && /^[0-9]+[bf]$/.test(text)) {
				push(Identifier, text, from)
				continue
			}
			const value = parseArmNumber(text, armasm)
			if (Number.isNaN(value)) invalid(`Malformed number ${text}`, from)
			else push(NumberToken, text, from).value = value
		} else if (character === '"' || character === '\'') {
			quoted(character, from)
		} else if (TWO_CHARACTER.has(code.slice(index, index + 2))) {
			index += 2
			push(Operator, code.slice(from, index), from)
		} else if (ONE_CHARACTER.has(character)) {
			index += 1
			push(Operator, character, from)
		} else {
			index += 1
			invalid(`Unexpected character '${character}'`, from)
		}
	}
	return tokens
}
