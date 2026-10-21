/**
 * MARS lexical rules: `#` comments, strings and character literals, decimal,
 * octal, hexadecimal and floating-point numbers, and mnemonics classified
 * against the isa table.
 */

import { AssemblyError, formatPosition } from '../../../core/diagnostics'
import { isInstructionMnemonic } from '../core/isa'
import type { Diagnostic, TokenData, TokenType } from '../core/types'

export class Token implements TokenData {
	constructor(
		public type: TokenType,
		public value: string,
		public line: number,
		public column: number,
		public file = '',
	) {
	}
}

export class Lexer {
	source: string
	pos: number
	line: number
	column: number
	tokens: Token[]
	/** Warnings the lexer records rather than throws; an error still throws. */
	diagnostics: Diagnostic[]

	constructor(source: string, public file = '') {
		this.source = source
		this.pos = 0
		this.line = 1
		this.column = 1
		this.tokens = []
		this.diagnostics = []
	}


	tokenize() {
		while (this.pos < this.source.length) {
			this.skipWhitespace()
			if (this.pos >= this.source.length) break

			// Skip comments
			if (this.peek() === '#') {
				this.skipComment()
				continue
			}

			const token = this.nextToken()
			if (token) {
				token.file = this.file
				this.tokens.push(token)
			}
		}

		this.tokens.push(new Token('EOF', '', this.line, this.column, this.file))
		return this.tokens
	}

	/** A lexical error, positioned in the file being read. */
	error(message: string, line: number, column: number): AssemblyError {
		return new AssemblyError(message, { file: this.file || undefined, line, column, endColumn: column + 1 })
	}

	nextToken(): Token | null {
		const char = this.peek()

		if (!char) return null

		// Labels: identifier followed by colon
		if (this.isAlpha(char)) {
			return this.readIdentifierOrKeyword()
		}

		// Numbers
		if (this.isDigit(char)) {
			return this.readNumber()
		}

		// Strings
		if (char === '"') {
			return this.readString()
		}

		// Character literals, which are just their code point
		if (char === "'") {
			return this.readCharacter()
		}

		// Macro parameters, e.g. %count
		if (char === '%') {
			return this.readMacroParameter()
		}

		// Operators and punctuation
		const line = this.line
		const col = this.column
		this.advance()

		switch (char) {
			case ',':
				return new Token('COMMA', ',', line, col)
			case '(':
				return new Token('LPAREN', '(', line, col)
			case ')':
				return new Token('RPAREN', ')', line, col)
			case ':':
				return new Token('COLON', ':', line, col)
			case '$':
				return new Token('DOLLAR', '$', line, col)
			case '-':
				return new Token('MINUS', '-', line, col)
			case '+':
				return new Token('PLUS', '+', line, col)
			case '\n':
				return new Token('NEWLINE', '\n', line, col)
			default:
				throw this.error(`Unexpected character: ${char}`, line, col)
		}
	}

	readIdentifierOrKeyword(): Token {
		const line = this.line
		const col = this.column
		let value = ''

		while (this.pos < this.source.length && this.isAlphaNumeric(this.peek())) {
			value += this.peek()
			this.advance()
		}

		// Check if it's a label (followed by colon)
		if (this.peek() === ':') {
			return new Token('LABEL', value, line, col)
		}

		// Mnemonics match without regard to case, but the token keeps the source
		// spelling: the same word may be naming a label.
		if (this.isInstruction(value.toUpperCase())) {
			return new Token('INSTRUCTION', value, line, col)
		}

		// Check if it's a directive
		if (value.startsWith('.')) {
			return new Token('DIRECTIVE', value, line, col)
		}

		return new Token('IDENTIFIER', value, line, col)
	}

	/** A macro formal parameter or argument reference, kept as `%name`. */
	readMacroParameter(): Token {
		const line = this.line
		const col = this.column
		let value = '%'
		this.advance()

		while (this.pos < this.source.length && this.isAlphaNumeric(this.peek())) {
			value += this.peek()
			this.advance()
		}

		return new Token('IDENTIFIER', value, line, col)
	}

	readNumber(): Token {
		const line = this.line
		const col = this.column
		let value = ''
		// Either case of the `0x` prefix starts a hexadecimal literal; there is
		// no binary prefix.
		const isHex = this.peek() === '0' && /[xX]/.test(this.peekNext())

		if (isHex) {
			value += this.peek()
			this.advance()
			value += this.peek()
			this.advance()
		}

		const prefix = value.length
		const validChars = isHex
			? (c: string) => /[0-9a-fA-F]/.test(c)
			: (c: string) => this.isDigit(c)

		while (this.pos < this.source.length && validChars(this.peek())) {
			value += this.peek()
			this.advance()
		}

		if (isHex) {
			if (value.length === prefix) throw this.error(`Hexadecimal literal "${value}" has no digits`, line, col)
		} else {
			value += this.readFraction()
			this.warnLeadingZero(value, line, col)
		}

		return new Token('NUMBER', value, line, col)
	}

	/**
	 * A leading zero means octal (`parser.parseNumber`).  A digit above 7
	 * makes the literal decimal rather than an error, since rejecting it
	 * would break existing source.  Warned, not silent.
	 */
	warnLeadingZero(value: string, line: number, column: number) {
		if (!/^0[0-9]*[89][0-9]*$/.test(value)) return
		const position = { file: this.file || undefined, line, column, endColumn: column + value.length }
		this.diagnostics.push({
			severity: 'warning',
			code: 'leading-zero-literal',
			message: `Leading-zero literal "${value}" is read as decimal ${Number.parseInt(value, 10)}; ` +
				`a leading zero otherwise means octal ${formatPosition(position)}`,
			...position,
		})
	}

	/** Fractional and exponent digits of a floating-point literal, if present. */
	readFraction(): string {
		let value = ''

		if (this.peek() === '.' && this.isDigit(this.peekNext())) {
			value += this.peek()
			this.advance()
			while (this.isDigit(this.peek())) {
				value += this.peek()
				this.advance()
			}
		}

		const exponentSign = /[+-]/.test(this.peek(1)) ? this.peek(1) : ''
		if (/[eE]/.test(this.peek()) && this.isDigit(this.peek(exponentSign ? 2 : 1))) {
			value += this.peek() + exponentSign
			this.advance()
			if (exponentSign) this.advance()
			while (this.isDigit(this.peek())) {
				value += this.peek()
				this.advance()
			}
		}

		return value
	}

	readString(): Token {
		const line = this.line
		const col = this.column
		let value = ''
		this.advance() // Skip opening quote

		while (this.pos < this.source.length && this.peek() !== '"') {
			value += this.peek() === '\\' ? this.readEscape() : this.readSourceCharacter()
		}

		if (this.peek() !== '"') {
			throw this.error('Unterminated string', line, col)
		}
		this.advance() // Skip closing quote

		return new Token('STRING', value, line, col)
	}

	/** `'a'` and `'\n'` are integers, so they lex as ordinary numbers. */
	readCharacter(): Token {
		const line = this.line
		const col = this.column
		this.advance() // Skip opening quote

		if (this.pos >= this.source.length || this.peek() === "'") {
			throw this.error('Empty character literal', line, col)
		}
		const value = this.peek() === '\\' ? this.readOctalEscape() ?? this.readEscape() : this.readSourceCharacter()

		if (this.peek() !== "'") {
			throw this.error('Unterminated character literal', line, col)
		}
		this.advance() // Skip closing quote

		return new Token('NUMBER', String(value.charCodeAt(0)), line, col)
	}

	/**
	 * `'\\377'`, an octal code point: exactly three octal digits, and only
	 * inside a character literal, never inside a string.
	 */
	readOctalEscape(): string | null {
		const digits = this.peek(1) + this.peek(2) + this.peek(3)
		if (!/^[0-7]{3}$/.test(digits) || this.peek(4) !== "'") return null
		const value = Number.parseInt(digits, 8)
		if (value > 255) return null
		for (let skipped = 0; skipped < 4; skipped++) this.advance()
		return String.fromCharCode(value)
	}

	readSourceCharacter(): string {
		const char = this.peek()
		this.advance()
		return char
	}

	/** Decodes one backslash escape, shared by strings and character literals. */
	readEscape(): string {
		this.advance() // Skip the backslash
		const escaped = this.readSourceCharacter()
		switch (escaped) {
			case 'n': return '\n'
			case 't': return '\t'
			case 'r': return '\r'
			case 'b': return '\b'
			case 'f': return '\f'
			case '0': return '\0'
			default: return escaped
		}
	}

	skipWhitespace() {
		while (this.pos < this.source.length && /[ \t\r]/.test(this.peek())) {
			this.advance()
		}
	}

	/**
	 * Runs to the end of the line but leaves the terminator, so the newline still
	 * becomes a token, so a comment can never swallow a line boundary.
	 */
	skipComment() {
		while (this.pos < this.source.length && this.peek() !== '\n') {
			this.advance()
		}
	}

	/**
	 * The union of the basic and pseudo mnemonics (`isa.ts`), including `bal`,
	 * `li.s` and `li.d`, which would otherwise lex as identifiers.
	 */
	isInstruction(word: string): boolean {
		return isInstructionMnemonic(word)
	}

	isAlpha(char: string): boolean {
		return /[a-zA-Z_.]/.test(char)
	}

	isAlphaNumeric(char: string): boolean {
		return /[a-zA-Z0-9_.$]/.test(char)
	}

	isDigit(char: string): boolean {
		return /[0-9]/.test(char)
	}

	peek(offset = 0): string {
		const pos = this.pos + offset
		return pos < this.source.length ? this.source[pos] : ''
	}

	peekNext() {
		return this.peek(1)
	}

	advance() {
		if (this.pos < this.source.length) {
			if (this.source[this.pos] === '\n') {
				this.line++
				this.column = 1
			} else {
				this.column++
			}
			this.pos++
		}
	}
}
