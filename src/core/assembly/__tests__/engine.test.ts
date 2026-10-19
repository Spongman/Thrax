import { describe, expect, it } from 'vitest'
import { assembleStatements, defaultLimits, StatementKind, type AssemblerConfig, type Statement } from '../assembler'
import { Op, evaluate, parseExpression, type Arithmetic, type Expr, type ExpressionSyntax } from '../expressions'
import { SymbolScope } from '../symbols'
import { DiagnosticLog } from '../diagnosticLog'
import { MacroTable } from '../macroEngine'
import { AssemblyError } from '../../diagnostics'
import { TokenCursor, TokenKind, makeToken, type Position, type Token } from '../tokens'

// A deliberately non-UASM syntax: C precedence, '$' as the location counter.
const cSyntax: ExpressionSyntax = {
	binary: new Map([
		['|', { op: Op.Or, precedence: 1 }],
		['&', { op: Op.And, precedence: 2 }],
		['+', { op: Op.Add, precedence: 3 }], ['-', { op: Op.Sub, precedence: 3 }],
		['*', { op: Op.Mul, precedence: 4 }],
	]),
	unary: new Map([['-', Op.Neg]]),
	dot: '$',
}

const arithmetic: Arithmetic = {
	unary: (_op, value) => -value,
	binary(op, a, b) {
		switch (op) {
			case Op.Add: return a + b
			case Op.Sub: return a - b
			case Op.Mul: return a * b
			case Op.And: return a & b
			case Op.Or: return a | b
		}
		throw new Error(`op ${op}`)
	},
}

function tokens(text: string): Token[] {
	return [...text.matchAll(/\d+|[A-Za-z_$]+|\S/g)].map((match) => {
		const kind = /\d/.test(match[0]) ? TokenKind.Number : /[A-Za-z_$]/.test(match[0]) ? TokenKind.Identifier : TokenKind.Operator
		const token = makeToken(kind, match[0], 'test', 1, match.index + 1)
		token.value = Number(match[0])
		return token
	})
}

function expr(text: string): Expr {
	return parseExpression(new TokenCursor(tokens(text)), cSyntax)!
}

const at: Position = { file: 'test', line: 1, column: 1 }
const config = (overrides: Partial<AssemblerConfig> = {}): AssemblerConfig => ({
	arithmetic,
	checkValue: (value) => value,
	littleEndian: false,
	defaultAlignment: 2,
	originMayDecrease: true,
	entryAddress: null,
	isInstructionMacro: (macro) => macro.name === 'insn',
	limits: defaultLimits,
	...overrides,
})

const { Label, Assign, Origin, Emit, Invoke, Define, Align } = StatementKind
const line = (n: number): Position => ({ file: 'test', line: n, column: 1 })

describe('expression engine', () => {
	it('honours configured precedence and the location counter', () => {
		const scope = { lookup: (name: string) => (name === 'x' ? 5 : undefined), dot: 100 }
		expect(evaluate(expr('1+2*3'), scope, arithmetic, true)).toBe(7)
		expect(evaluate(expr('$-x*2|1'), scope, arithmetic, true)).toBe(91)
		expect(evaluate(expr('-(x+1)'), scope, arithmetic, true)).toBe(-6)
	})

	it('propagates unknown symbols unless strict', () => {
		const scope = { lookup: () => undefined, dot: 0 }
		expect(evaluate(expr('later+1'), scope, arithmetic, false)).toBeUndefined()
		expect(() => evaluate(expr('later+1'), scope, arithmetic, true)).toThrow('Symbol \'later\' is undefined')
	})

	it('reports a missing operand', () => {
		expect(() => expr('1+')).toThrow('Expected operand after operator \'+\'')
	})
})

describe('statement engine', () => {
	it('resolves forward references and emits multi-byte values in the configured byte order', () => {
		const program: Statement[] = [
			{ kind: Emit, value: expr('end'), size: 2, at: line(1) },
			{ kind: Origin, value: expr('16'), at: line(2) },
			{ kind: Label, name: 'end', at: line(3) },
			{ kind: Emit, value: expr('$'), size: 2, at: line(4) },
		]
		const { image, diagnostics } = assembleStatements(program, config())
		expect(diagnostics).toEqual([])
		expect(image!.sections.map((section) => [section.address, [...section.bytes]])).toEqual([[0, [0, 16]], [16, [0, 16]]])
		expect(image!.symbols).toEqual([{ name: 'end', address: 16 }])
	})

	it('overloads macros by arity, scopes symbols locally, and groups instruction bytes', () => {
		const insn = { name: 'insn', parameters: ['a'], body: [{ kind: Emit, value: expr('a'), size: 1, at: line(2) }, { kind: Emit, value: expr('a+1'), size: 1, at: line(2) }] as Statement[], at: line(2) }
		const pair = { name: 'insn', parameters: ['a', 'b'], body: [{ kind: Invoke, name: 'insn', args: [expr('a*b')], at: line(3) }] as Statement[], at: line(3) }
		const local = { name: 'local', parameters: [], body: [{ kind: Assign, name: 'k', value: expr('9'), at: line(4) }] as Statement[], at: line(4) }
		const program: Statement[] = [
			{ kind: Define, macro: insn, at: line(2) },
			{ kind: Define, macro: pair, at: line(3) },
			{ kind: Define, macro: local, at: line(4) },
			{ kind: Assign, name: 'k', value: expr('1'), at: line(5) },
			{ kind: Invoke, name: 'local', args: [], at: line(6) },
			{ kind: Invoke, name: 'insn', args: [expr('2'), expr('3')], at: line(7) },
			{ kind: Align, boundary: null, at: line(8) },
			{ kind: Emit, value: expr('k'), size: 1, at: line(9) },
		]
		const { image, diagnostics } = assembleStatements(program, config())
		expect(diagnostics).toEqual([])
		expect([...image!.sections[0].bytes]).toEqual([6, 7, 1])
		expect(image!.sourceMappings.map(({ address, byteLength, kind, source, expansion }) =>
			[address, byteLength, kind, source.line, expansion.map((frame) => frame.macro)])).toEqual([
			[0, 2, 'instruction', 7, ['insn']],
			[2, 1, 'data', 9, []],
		])
	})

	it('diagnoses overlapping output when origins may move backwards', () => {
		const program: Statement[] = [
			{ kind: Emit, value: expr('1'), size: 2, at },
			{ kind: Origin, value: expr('1'), at },
			{ kind: Emit, value: expr('2'), size: 1, at },
		]
		expect(assembleStatements(program, config()).diagnostics[0].message).toContain('overlap at address 0x1')
	})

	it('bounds emitted bytes', () => {
		const program: Statement[] = [{ kind: Emit, value: expr('1'), size: 4, at }]
		const result = assembleStatements(program, config({ limits: { ...defaultLimits, maxBytes: 3 } }))
		expect(result.diagnostics[0].message).toContain('more than 3 bytes')
	})
})

describe('symbol scopes', () => {
	it('shadows with local writes, including deliberate undefined values', () => {
		const global = new SymbolScope()
		global.assign('x', 1)
		const local = new SymbolScope(global)
		expect(local.lookup('x')).toBe(1)
		local.assign('x', undefined)
		expect(local.lookup('x')).toBeUndefined()
		expect(global.lookup('x')).toBe(1)
	})
})

describe('sections, scopes and fragments', () => {
	const { Section, Scope, Fragment } = StatementKind
	const sections = [{ start: 0x100 }, { start: 0x200, layer: 1 }]

	it('keeps a location counter per section and resolves fragments after layout', () => {
		const program: Statement[] = [
			{ kind: Fragment, size: 2, provenance: null, at, encode: (context) => [context.value(expr('tail'), true)! & 0xFF, context.dot & 0xFF] },
			{ kind: Section, section: 1, at },
			{ kind: Label, name: 'data', at },
			{ kind: Emit, value: expr('$'), size: 2, at },
			{ kind: Section, section: 0, at },
			{ kind: Label, name: 'tail', at },
		]
		const { image, diagnostics, symbols } = assembleStatements(program, config({ sections }))
		expect(diagnostics).toEqual([])
		expect(image!.sections.map((section) => [section.address, [...section.bytes]])).toEqual([[0x100, [0x02, 0x00]], [0x200, [0x02, 0x00]]])
		expect([symbols.lookup('data'), symbols.lookup('tail')]).toEqual([0x200, 0x102])
	})

	it('scopes labels by name, falling back to the global scope, and exports on request', () => {
		const program: Statement[] = [
			{ kind: Scope, scope: 'a', at },
			{ kind: Label, name: 'x', at },
			{ kind: Label, name: 'shared', exported: true, at },
			{ kind: Emit, value: expr('1'), size: 1, at },
			{ kind: Scope, scope: 'b', at },
			{ kind: Label, name: 'x', at },
			{ kind: Emit, value: expr('x+shared'), size: 1, at },
		]
		const { image, diagnostics, scopes, symbols } = assembleStatements(program, config())
		expect(diagnostics).toEqual([])
		expect([...image!.sections[0].bytes]).toEqual([1, 1])
		expect([scopes.get('a')!.own('x'), scopes.get('b')!.own('x'), symbols.own('x'), symbols.own('shared')]).toEqual([0, 1, undefined, 0])
		expect(image!.symbols).toEqual([{ name: 'shared', address: 0 }])
	})

	it('carries movable labels across a carrying alignment and can leave padding unwritten', () => {
		const program: Statement[] = [
			{ kind: Emit, value: expr('1'), size: 1, at },
			{ kind: Label, name: 'moved', movable: true, at },
			{ kind: Label, name: 'fixed', at },
			{ kind: Align, boundary: expr('4'), carry: true, skip: true, at },
			{ kind: Emit, value: expr('moved'), size: 1, at },
		]
		const { image, diagnostics, symbols } = assembleStatements(program, config())
		expect(diagnostics).toEqual([])
		expect([symbols.lookup('moved'), symbols.lookup('fixed')]).toEqual([4, 1])
		expect(image!.sections.map((section) => [section.address, [...section.bytes]])).toEqual([[0, [1]], [4, [4]]])
	})

	it('lets a higher layer win where overwriting is allowed', () => {
		const program: Statement[] = [
			{ kind: Section, section: 1, at },
			{ kind: Origin, value: expr('256'), at },
			{ kind: Emit, value: expr('9'), size: 1, at },
			{ kind: Section, section: 0, at },
			{ kind: Emit, value: expr('5'), size: 2, at },
		]
		expect(assembleStatements(program, config({ sections })).diagnostics[0].message).toContain('overlap')
		const { image } = assembleStatements(program, config({ sections, overwrite: true }))
		expect(image!.sections.map((section) => [section.address, [...section.bytes]])).toEqual([[0x100, [9, 5]]])
	})

	it('wraps emitted addresses to the configured modulus', () => {
		const program: Statement[] = [
			{ kind: Origin, value: expr('0-2'), at },
			{ kind: Fragment, size: 4, provenance: null, at, encode: () => [1, 2, 3, 4] },
		]
		const limits = { ...defaultLimits, addressBase: -16 }
		const { image } = assembleStatements(program, config({ limits, addressModulus: 256 }))
		expect(image!.sections.map((section) => [section.address, [...section.bytes]])).toEqual([[0, [3, 4]], [254, [1, 2]]])
	})

	it('keeps layout when a fragment fails and maps its provenance', () => {
		const provenance = { kind: 'instruction' as const, source: { file: 'test', line: 1 }, expansion: [] }
		const program: Statement[] = [
			{ kind: Fragment, size: 2, provenance: null, at: line(1), encode: () => { throw new AssemblyError('bad', line(1)) } },
			{ kind: Label, name: 'after', at: line(2) },
			{ kind: Fragment, size: 2, provenance, at: line(3), encode: () => [1, 2] },
		]
		const { diagnostics, symbols } = assembleStatements(program, config())
		expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual(['bad at test:1:1'])
		expect(symbols.lookup('after')).toBe(2)
		const mapped = assembleStatements(program.slice(1), config()).image!.sourceMappings
		expect(mapped.map(({ address, byteLength, kind }) => [address, byteLength, kind])).toEqual([[0, 2, 'instruction']])
	})
})

describe('fragments that choose their size', () => {
	const { Fragment } = StatementKind
	/** One byte where `target` is known in layout and below 256, else two, as a zero-page operand. */
	const short = (target: string, line: Position): Statement => ({
		kind: Fragment, at: line, provenance: 'instruction',
		size: (context) => {
			const value = context.value(expr(target), false)
			return value !== undefined && value < 256 ? 1 : 2
		},
		encode: (context, size) => {
			const value = context.value(expr(target), true)!
			return size === 1 ? [value] : [value & 0xFF, value >> 8]
		},
	})

	it('keeps the size layout chose once a forward reference resolves', () => {
		const program: Statement[] = [
			{ kind: Label, name: 'back', at: line(1) },
			short('back', line(2)),
			short('ahead', line(3)),
			{ kind: Label, name: 'ahead', at: line(4) },
		]
		const { image, diagnostics, symbols } = assembleStatements(program, config())
		expect(diagnostics).toEqual([])
		// `ahead` is 3, small enough for one byte, but layout could not know that.
		expect(symbols.lookup('ahead')).toBe(3)
		expect([...image!.sections[0].bytes]).toEqual([0, 3, 0])
	})

	it('maps each execution of a kind apart, at the invoking line', () => {
		const macro = { name: 'twice', parameters: [], body: [short('1', line(9))], at: line(8) }
		const program: Statement[] = [
			{ kind: Define, macro, at: line(8) },
			{ kind: Invoke, name: 'twice', args: [], at: line(1) },
			{ kind: Invoke, name: 'twice', args: [], at: line(2) },
		]
		const { image, diagnostics } = assembleStatements(program, config())
		expect(diagnostics).toEqual([])
		expect(image!.sourceMappings.map(({ address, byteLength, kind, source }) => [address, byteLength, kind, source.line])).toEqual([
			[0, 1, 'instruction', 1],
			[1, 1, 'instruction', 2],
		])
	})
})

describe('macro table policy', () => {
	const body: Statement[] = []
	it('can keep the first of two same-arity definitions and allow repeated parameters', () => {
		const table = new MacroTable<Statement>({ keepFirst: true, uniqueParameters: false })
		table.define({ name: 'm', parameters: ['a', 'a'], body, at })
		table.define({ name: 'm', parameters: ['b', 'c'], body, at })
		expect(table.find('m', 2)!.parameters).toEqual(['a', 'a'])
		expect(table.find('m', 1)).toBeUndefined()
		expect(() => new MacroTable<Statement>().define({ name: 'm', parameters: ['a', 'a'], body, at })).toThrow('Duplicate parameter')
	})
})

describe('diagnostic log', () => {
	const diagnostic = (message: string, file: string | undefined, line: number, severity: 'error' | 'warning' = 'error') =>
		({ severity, message, file, line, column: 1 })

	it('orders by phase, deduplicates by message, file and line, and sorts in reading order', () => {
		const log = new DiagnosticLog()
		log.add(diagnostic('late', 'b', 1), 2)
		log.add(diagnostic('warn', 'a', 5, 'warning'), 0, false)
		log.add(diagnostic('early', 'a', 9), 1)
		log.add(diagnostic('late', 'b', 1), 1)
		expect(log.collect({ promoteWarnings: false, sort: false }).map((item) => item.message)).toEqual(['warn', 'early', 'late'])
		expect(log.collect({ promoteWarnings: true, sort: true }).map((item) => [item.file, item.line, item.severity])).toEqual([
			['a', 5, 'error'], ['a', 9, 'error'], ['b', 1, 'error'],
		])
		expect(() => log.record(new Error('bug'), 0)).toThrow('bug')
	})
})
