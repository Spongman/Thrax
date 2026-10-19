import { AssemblyError, type SourcePosition } from '../diagnostics'

/** Token classes shared by dialect tokenizers; punctuation and operators are `Operator` by text. */
export class TokenKind {
	static readonly Identifier = 0
	static readonly Number = 1
	static readonly String = 2
	static readonly Operator = 3
	static readonly Newline = 4
	/** A lexical fault, reported when a parser first looks at it. */
	static readonly Invalid = 5
	static readonly End = 6
}

const { Operator, Newline, Invalid, End } = TokenKind

export interface Token {
	kind: number
	/** Source text, or the message of an Invalid token. */
	text: string
	/** Numeric value of a Number token. */
	value: number
	/** Decoded contents of a String token. */
	string?: string
	file: string
	line: number
	column: number
	/** Source length, which can differ from `text` for Invalid tokens. */
	length: number
}

/** A position always naming its file, so it satisfies both SourcePosition and SourceLocation. */
export interface Position extends SourcePosition {
	file: string
	line: number
	column: number
}

export function positionOf(token: Token): Position {
	return { file: token.file, line: token.line, column: token.column, endColumn: token.column + Math.max(1, token.length) }
}

export function makeToken(kind: number, text: string, file: string, line: number, column: number, length = text.length): Token {
	return { kind, text, value: 0, file, line, column, length }
}

/** Reads a token stream; Invalid tokens throw their message when first inspected. */
export class TokenCursor {
	index = 0
	private readonly end: Token

	constructor(readonly tokens: readonly Token[]) {
		const last = tokens[tokens.length - 1]
		this.end = makeToken(End, '', last?.file ?? '', last?.line ?? 1, last ? last.column + last.length : 1, 0)
	}

	peek(offset = 0): Token {
		const token = this.tokens[this.index + offset] ?? this.end
		if (token.kind === Invalid) throw new AssemblyError(token.text, positionOf(token))
		return token
	}

	next(): Token {
		const token = this.peek()
		if (token.kind !== End) this.index += 1
		return token
	}

	isOperator(text: string, offset = 0): boolean {
		const token = this.tokens[this.index + offset]
		return token !== undefined && token.kind === Operator && token.text === text
	}

	accept(text: string): boolean {
		if (!this.isOperator(text)) return false
		this.index += 1
		return true
	}

	expect(text: string, message: string): Token {
		const token = this.peek()
		if (token.kind !== Operator || token.text !== text) throw new AssemblyError(message, positionOf(token))
		this.index += 1
		return token
	}

	atLineEnd(): boolean {
		const kind = (this.tokens[this.index] ?? this.end).kind
		return kind === Newline || kind === End
	}

	atEnd(): boolean {
		return this.index >= this.tokens.length
	}

	/** Error recovery: skip past the current line without inspecting tokens. */
	skipLine() {
		while (this.index < this.tokens.length && this.tokens[this.index].kind !== Newline) this.index += 1
	}
}
