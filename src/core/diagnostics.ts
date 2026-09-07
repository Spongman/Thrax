/**
 * One error type for every stage of assembly, carrying the source position the
 * editor marks up.  Every stage formats a position the same way, so a message
 * reads alike whether the lexer, the parser or the assembler raised it.
 */

import type { Diagnostic, MipsInstruction, TokenData } from './types'

/** Where a diagnostic points; a line is enough, a column narrows the marker. */
export interface SourcePosition {
	file?: string
	line?: number
	column?: number
	endColumn?: number
}

/** `at file:line:column`, or `at line N:C` when the program is one unnamed file. */
export function formatPosition(position: SourcePosition): string {
	if (position.line === undefined) return ''
	const column = position.column === undefined ? '' : `:${position.column}`
	return position.file ? `at ${position.file}:${position.line}${column}` : `at line ${position.line}${column}`
}

/**
 * A diagnostic the way gcc prints one: `file:line:column: error: message`.
 * The message already ends in the position, since the error carried it as
 * text; that tail is taken off so the position is said once, up front where a
 * reader (or a click) finds it.
 */
export function formatDiagnostic(diagnostic: Diagnostic): string {
	const where = formatPosition(diagnostic)
	const message = where && diagnostic.message.endsWith(` ${where}`)
		? diagnostic.message.slice(0, -where.length - 1)
		: diagnostic.message
	if (diagnostic.line === undefined) return `${diagnostic.severity}: ${message}`
	const column = diagnostic.column === undefined ? '' : `:${diagnostic.column}`
	return `${diagnostic.file ?? 'source'}:${diagnostic.line}${column}: ${diagnostic.severity}: ${message}`
}

/** Position of `token`, spanning the text it was lexed from. */
export function at(token: TokenData): SourcePosition {
	return {
		file: token.file || undefined,
		line: token.line,
		column: token.column,
		endColumn: token.column + Math.max(1, token.value.length),
	}
}

/** Position of an instruction, which knows its line and its mnemonic's column. */
export function atInstruction(instruction: MipsInstruction | null | undefined): SourcePosition {
	if (!instruction) return {}
	return {
		file: instruction.sourceFile || undefined,
		line: instruction.sourceLine,
		column: instruction.sourceColumn,
		endColumn: instruction.sourceColumn === undefined ? undefined : instruction.sourceColumn + instruction.name.length,
	}
}

/**
 * A fault in the source being assembled, as opposed to a bug in the assembler:
 * only these become diagnostics, so an internal exception still propagates.
 */
export class AssemblyError extends Error {
	file?: string
	line?: number
	column?: number
	endColumn?: number

	constructor(message: string, position: SourcePosition = {}) {
		const where = formatPosition(position)
		super(where ? `${message} ${where}` : message)
		this.name = 'AssemblyError'
		this.file = position.file
		this.line = position.line
		this.column = position.column
		this.endColumn = position.endColumn
	}

	get diagnostic(): Diagnostic {
		return {
			severity: 'error',
			message: this.message,
			file: this.file,
			line: this.line,
			column: this.column,
			endColumn: this.endColumn,
		}
	}
}

/** The first error in `diagnostics`, which is what a caller reports or throws. */
export function firstError(diagnostics: Diagnostic[]): Diagnostic | undefined {
	return diagnostics.find((diagnostic) => diagnostic.severity === 'error')
}

export function hasErrors(diagnostics: Diagnostic[]): boolean {
	return firstError(diagnostics) !== undefined
}
