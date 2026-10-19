import { StatementKind, type HookContext, type Statement } from '../../../core/assembly/assembler'
import { Op, parseExpression, type Expr, type ExpressionSyntax } from '../../../core/assembly/expressions'
import { TokenCursor, TokenKind, positionOf, type Position, type Token } from '../../../core/assembly/tokens'
import { AssemblyError } from '../../../core/diagnostics'
import type { Diagnostic } from '../../../core/types'

const { Label, Assign, Origin, Emit, Invoke, Define, Align, Bytes, Hook } = StatementKind
const { Identifier, String: StringToken, Newline, End } = TokenKind

/** BSim evaluates operators strictly left to right, with no precedence. */
export const uasmExpressionSyntax: ExpressionSyntax = {
	binary: new Map([
		['+', Op.Add], ['-', Op.Sub], ['*', Op.Mul], ['/', Op.Div], ['%', Op.Mod],
		['&', Op.And], ['|', Op.Or], ['<<', Op.Shl], ['>>', Op.Shr],
	].map(([text, op]) => [text as string, { op: op as number, precedence: 1 }])),
	unary: new Map([['-', Op.Neg], ['~', Op.Not], ['+', Op.Plus]]),
	dot: '.',
}

/** BSim simulator settings carried beside the image for the machine profile. */
export interface UasmDirectives {
	breakpoints: number[]
	/** Half-open address ranges; an open range ends at Infinity. */
	protection: { start: number; end: number }[]
	options: Record<string, boolean>
}

const optionNames: Record<string, [string, boolean]> = {
	tty: ['tty', true], notty: ['tty', false],
	clock: ['clock', true], clk: ['clock', true], noclock: ['clock', false], noclk: ['clock', false],
	annotate: ['annotate', true], noannotate: ['annotate', false],
	kalways: ['kalways', true], nokalways: ['kalways', false],
	segmentation: ['segmentation', true], nosegmentation: ['segmentation', false],
	div: ['div', true], nodiv: ['div', false],
	mul: ['mul', true], nomul: ['mul', false],
}

/** BSim's checkoff directives only talk to the course server; their lines are skipped. */
const checkoffDirectives = new Set(['pcheckoff', 'tcheckoff', 'verify'])

/** Where a `.segment` starts a user-mode segment: at `index` of the top-level statements. */
export interface UasmSegment {
	name: string
	index: number
	at: Position
}

/**
 * Where hook directives such as `.breakpoint` record: a segment's statements
 * assemble from virtual address 0, so `offset` is the base it is loaded at;
 * `record` is off while a layout is only measured.
 */
export interface UasmRelocation {
	offset: number
	record: boolean
}

// Closes a block body; End terminates the file.
const LineBody = 0
const BlockBody = 1
const FileBody = 2

export interface UasmParse {
	statements: Statement[]
	segments: UasmSegment[]
	relocation: UasmRelocation
	diagnostics: Diagnostic[]
}

/** Parse an include-expanded token stream into engine statements. */
export function parseUasm(tokens: readonly Token[], directives: UasmDirectives): UasmParse {
	const parser = new Parser(new TokenCursor(tokens), directives)
	const statements = parser.statements(FileBody, null)
	return { statements, segments: parser.segments, relocation: parser.relocation, diagnostics: parser.diagnostics }
}

class Parser {
	readonly diagnostics: Diagnostic[] = []
	readonly segments: UasmSegment[] = []
	readonly relocation: UasmRelocation = { offset: 0, record: true }
	/** The statement list a top-level directive appends to, null inside a macro. */
	private topLevel: Statement[] | null = null

	constructor(private readonly cursor: TokenCursor, private readonly directives: UasmDirectives) {}

	statements(body: number, open: Position | null): Statement[] {
		const cursor = this.cursor
		const result: Statement[] = []
		if (body === FileBody) this.topLevel = result
		for (;;) {
			try {
				const token = cursor.peek()
				if (token.kind === End) {
					if (body === BlockBody) throw new AssemblyError('Expected closing brace to end block macro declaration', open!)
					return result
				}
				if (token.kind === Newline) {
					if (body === LineBody) return result
					cursor.next()
					continue
				}
				if (body === BlockBody && cursor.isOperator('}')) {
					cursor.next()
					return result
				}
				this.statement(result)
			} catch (error) {
				if (!(error instanceof AssemblyError)) throw error
				this.diagnostics.push(error.diagnostic)
				if (cursor.atEnd() && body === BlockBody) return result
				cursor.skipLine()
				if (body === LineBody) return result
			}
		}
	}

	private statement(out: Statement[]) {
		const cursor = this.cursor
		const token = cursor.peek()
		const at = positionOf(token)
		if (token.kind === Identifier) {
			if (token.text.length > 1 && token.text[0] === '.') {
				cursor.next()
				this.directive(token.text.slice(1), at, out)
				return
			}
			if (cursor.isOperator(':', 1)) {
				if (token.text === '.') throw new AssemblyError('Cannot use . as a label', at)
				cursor.index += 2
				out.push({ kind: Label, name: token.text, at })
				return
			}
			if (cursor.isOperator('=', 1)) {
				cursor.index += 2
				const value = this.expression('Expected an expression after =')
				out.push(token.text === '.' ? { kind: Origin, value, at } : { kind: Assign, name: token.text, value, at })
				return
			}
			if (cursor.isOperator('(', 1) && token.text !== '.') {
				cursor.index += 2
				out.push({ kind: Invoke, name: token.text, args: this.arguments(), at })
				return
			}
		}
		const value = parseExpression(cursor, uasmExpressionSyntax)
		if (value) {
			out.push({ kind: Emit, value, size: 1, at })
			return
		}
		if (cursor.isOperator('=')) throw new AssemblyError('Cannot assign to integer literals or expressions', at)
		if (cursor.isOperator('{')) throw new AssemblyError('An opening brace { is only permitted at the beginning of a macro definition', at)
		if (cursor.isOperator('}')) throw new AssemblyError('Unexpected closing brace } without matching open brace {', at)
		throw new AssemblyError(`Unexpected '${token.text}'`, at)
	}

	private expression(message: string): Expr {
		const value = parseExpression(this.cursor, uasmExpressionSyntax)
		if (!value) throw new AssemblyError(message, positionOf(this.cursor.peek()))
		return value
	}

	private arguments(): Expr[] {
		const cursor = this.cursor
		const args: Expr[] = []
		if (cursor.accept(')')) return args
		for (;;) {
			args.push(this.expression('Missing expression in macro argument list'))
			if (cursor.accept(')')) return args
			if (!cursor.accept(',')) {
				const next = cursor.peek()
				throw new AssemblyError(`Unexpected '${next.kind === Newline || next.kind === End ? 'end of line' : next.text}'; expecting ',' or ')'`, positionOf(next))
			}
		}
	}

	private directive(name: string, at: Position, out: Statement[]) {
		const cursor = this.cursor
		switch (name) {
			case 'include':
				// Includes are spliced before parsing, so one left here lacks a name.
				throw new AssemblyError('.include expects a file name in double quotes', at)
			case 'macro':
				out.push({ kind: Define, macro: this.macro(at), at })
				return
			case 'align':
				out.push({ kind: Align, boundary: parseExpression(cursor, uasmExpressionSyntax), at })
				return
			case 'ascii':
			case 'text': {
				const text = this.string(`.${name} expects a string in double quotes`)
				const bytes = Uint8Array.from(text, (character) => character.charCodeAt(0))
				out.push({ kind: Bytes, bytes: name === 'text' ? Uint8Array.from([...bytes, 0]) : bytes, at })
				if (name === 'text') out.push({ kind: Align, boundary: { kind: 0, value: 4 }, at })
				return
			}
			case 'breakpoint':
				out.push(this.hook(at, (dot) => this.directives.breakpoints.push(dot)))
				return
			case 'protect':
				out.push(this.hook(at, (dot) => {
					const { protection } = this.directives
					const last = protection[protection.length - 1]
					if (!last || last.end !== Infinity) protection.push({ start: dot, end: Infinity })
				}))
				return
			case 'unprotect':
				out.push(this.hook(at, (dot) => {
					const { protection } = this.directives
					const last = protection[protection.length - 1]
					if (last && last.end === Infinity) last.end = dot
				}))
				return
			case 'segment': {
				if (out !== this.topLevel) throw new AssemblyError('.segment cannot be used inside a macro', at)
				const name = cursor.peek()
				if (name.kind !== Identifier || name.text[0] === '.') throw new AssemblyError('.segment expects a segment name', positionOf(name))
				cursor.next()
				this.segments.push({ name: name.text, index: out.length, at })
				return
			}
			case 'options': {
				const settings: [string, boolean][] = []
				while (!cursor.atLineEnd()) {
					const option = cursor.next()
					const setting = option.kind === Identifier ? optionNames[option.text] : undefined
					if (!setting) throw new AssemblyError(`Unrecognised option '${option.text}'`, positionOf(option))
					settings.push(setting)
				}
				out.push(this.hook(at, () => {
					for (const [option, enabled] of settings) this.directives.options[option] = enabled
				}))
				return
			}
		}
		if (checkoffDirectives.has(name)) {
			while (!cursor.atLineEnd()) cursor.next()
			return
		}
		throw new AssemblyError(`Unrecognised directive '.${name}'`, at)
	}

	/** Runs only while emitting a recorded layout, at the physical address. */
	private hook(at: Position, run: (dot: number) => void): Statement {
		const relocation = this.relocation
		return { kind: Hook, run: (context: HookContext) => { if (context.emitting && relocation.record) run(context.dot + relocation.offset) }, at }
	}

	private string(message: string): string {
		const token = this.cursor.peek()
		if (token.kind !== StringToken) throw new AssemblyError(message, positionOf(token))
		this.cursor.next()
		return token.string!
	}

	private macro(directive: Position) {
		const cursor = this.cursor
		const nameToken = cursor.peek()
		if (nameToken.kind !== Identifier) throw new AssemblyError('Macro definitions must include a name', positionOf(nameToken))
		cursor.next()
		cursor.expect('(', 'Macro definitions must include a parenthesised argument list')
		const parameters: string[] = []
		if (!cursor.accept(')')) {
			for (;;) {
				const parameter = cursor.peek()
				if (parameter.kind !== Identifier) throw new AssemblyError('Macro arguments must be valid symbol names', positionOf(parameter))
				cursor.next()
				parameters.push(parameter.text)
				if (cursor.accept(')')) break
				cursor.expect(',', 'Expected comma , or close parenthesis ) after macro argument')
			}
		}
		const block = cursor.accept('{')
		const body = this.statements(block ? BlockBody : LineBody, directive)
		return { name: nameToken.text, parameters, body, at: positionOf(nameToken) }
	}
}
