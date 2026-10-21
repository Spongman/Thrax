import { visitSourceLines, type SourceLine } from '../../core/assembly/sourceLines'
import { integerArithmetic } from '../../core/assembly/integerArithmetic'
import { splitOperands, stripAssemblyComment } from '../../core/assembly/text'
import { assembleStatements, defaultLimits, StatementKind as K, type Statement } from '../../core/assembly/assembler'
import { Op, parseExpression, type Arithmetic, type Expr } from '../../core/assembly/expressions'
import { makeToken, TokenCursor, TokenKind, type Position } from '../../core/assembly/tokens'
import { AssemblyError } from '../../core/diagnostics'
import type { AssemblySources, Diagnostic } from '../contracts'
import { encodeInstruction } from './encoding'
import { DATA_BASE, MEMORY_BYTES, TEXT_BASE, wordsToBytes } from './isa'
import { M68kAssembly } from './program'
import type { CpuModel } from './settings'

const arithmetic: Arithmetic = integerArithmetic
const syntax = {
	binary: new Map([
		['|', { op: Op.Or, precedence: 1 }],
		['^', { op: Op.Xor, precedence: 2 }],
		['&', { op: Op.And, precedence: 3 }],
		['<<', { op: Op.Shl, precedence: 4 }],
		['>>', { op: Op.Sar, precedence: 4 }],
		['+', { op: Op.Add, precedence: 5 }],
		['-', { op: Op.Sub, precedence: 5 }],
		['*', { op: Op.Mul, precedence: 6 }],
		['/', { op: Op.Div, precedence: 6 }],
		['%', { op: Op.Mod, precedence: 6 }]
	]),
	unary: new Map([
		['-', Op.Neg],
		['+', Op.Plus],
		['~', Op.Not]
	]),
	dot: '.'
}
function expression(text: string, at: Position): Expr {
	const tokens = (
		text.match(/'(?:\\.|[^'\\])'|\$[\da-fA-F]+|0[xX][\da-fA-F]+|0[bB][01]+|\d+|[A-Za-z_.$][\w.$]*|<<|>>|[^\s]/g) ?? []
	).map((part) => {
		const number = /^\d|^\$[\da-f]|^'/i.test(part),
			token = makeToken(
				number ? TokenKind.Number : /^[\w.$]/.test(part) ? TokenKind.Identifier : TokenKind.Operator,
				part,
				at.file,
				at.line,
				1
			)
		token.value = part.startsWith('$')
			? parseInt(part.slice(1), 16)
			: part.startsWith("'")
				? JSON.parse(`"${part.slice(1, -1)}"`).charCodeAt(0)
				: Number(part)
		return token
	})
	const cursor = new TokenCursor(tokens),
		value = parseExpression(cursor, syntax)
	if (!value || !cursor.atEnd()) throw new AssemblyError(`Invalid expression '${text}'`, at)
	return value
}
/** Commas in effective addresses and strings belong to that operand. */
const operands = (text: string) => splitOperands(text, { brackets: ['()'], unclosed: 'Unclosed string or effective address' })
const stripComment = (text: string) => stripAssemblyComment(text, [';'])
export function assembleM68k(sources: AssemblySources, model: CpuModel): M68kAssembly {
	const statements: Statement[] = [],
		diagnostics: Diagnostic[] = []
	let reserved = 0
	const reserve = (size: number) => {
		reserved += size
		if (reserved > MEMORY_BYTES) throw new Error('Assembly exceeds 1 MiB output limit')
	}
	const visit = ({ text: original, at }: SourceLine): string | undefined => {
		if (diagnostics.length >= 100) return
		if (statements.length > 100000) throw new Error('Expanded source statement limit exceeded')
		try {
			let line = stripComment(original).trim()
			if (!line || line.startsWith('*')) return
			const equate = /^([\w.$]+)\s+(?:equ|=)\s+(.+)$/i.exec(line)
			if (equate) {
				statements.push({ kind: K.Assign, name: equate[1], value: expression(equate[2], at), at })
				return
			}
			while (/^[\w.$]+:/.test(line)) {
				const label = /^[\w.$]+/.exec(line)![0]
				statements.push({ kind: K.Label, name: label, at })
				line = line.slice(label.length + 1).trim()
				if (statements.length > 100000) throw new Error('Statement limit exceeded')
			}
			if (!line) return
			const parsed = /^(\S+)\s*(.*)$/.exec(line)!,
				operation = parsed[1].toLowerCase(),
				rest = parsed[2],
				args = operands(rest)
			if (['.globl', '.global', 'global', 'xdef', '.type', '.size', 'end'].includes(operation)) return
			if (operation === 'include' || operation === '.include') {
				const include = JSON.parse(rest)
				if (typeof include !== 'string') throw new Error('Expected quoted include path')
				return include
			}
			if (['.text', '.data', '.bss', '.section', 'section'].includes(operation)) {
				const section =
					operation === 'section' || operation === '.section'
						? args[0].toLowerCase().replace(/^\./, '')
						: operation.slice(1)
				if (!['text', 'data', 'rodata', 'bss'].includes(section)) throw new Error('Unsupported section')
				statements.push({ kind: K.Section, section: section === 'text' ? 0 : 1, at })
				return
			}
			if (['.equ', '.set'].includes(operation)) {
				if (args.length !== 2) throw new Error('Expected name,value')
				statements.push({ kind: K.Assign, name: args[0], value: expression(args[1], at), at })
				return
			}
			if (operation === 'org' || operation === '.org') {
				statements.push({ kind: K.Origin, value: expression(rest, at), at })
				return
			}
			if (['even', '.even', '.align', '.balign'].includes(operation)) {
				const value = operation.endsWith('even') ? 2 : Number(rest)
				if (!Number.isInteger(value) || value < 1 || value > 4096 || value & (value - 1))
					throw new Error('Alignment must be a power of two <=4096')
				statements.push({ kind: K.Align, boundary: { kind: 0, value }, at })
				return
			}
			if (['.ascii', '.asciz', '.string'].includes(operation)) {
				const decoded = args.map((arg) => JSON.parse(arg))
				if (decoded.some((value) => typeof value !== 'string')) throw new Error('Expected quoted strings')
				const bytes = new TextEncoder().encode(decoded.join('') + (operation === '.ascii' ? '' : '\0'))
				reserve(bytes.length)
				statements.push({ kind: K.Bytes, bytes, at })
				return
			}
			const ds = /^(?:ds|dcb)\.(b|w|l)$/.exec(operation)
			if (ds || operation === '.space' || operation === '.zero') {
				const count = Number(args[0]),
					size = ds?.[1] === 'w' ? 2 : ds?.[1] === 'l' ? 4 : 1,
					bytes = count * size
				if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MEMORY_BYTES || args.length > 1)
					throw new Error('Reservation requires a bounded literal count')
				reserve(bytes)
				statements.push({ kind: K.Bytes, bytes: new Uint8Array(bytes), at })
				return
			}
			const size = (
				{ '.byte': 1, '.word': 2, '.short': 2, '.long': 4, 'dc.b': 1, 'dc.w': 2, 'dc.l': 4 } as Record<string, number>
			)[operation]
			if (size) {
				if (!args.length) throw new Error('Data directive needs values')
				reserve(size * args.length)
				for (const arg of args) {
					if (size === 1 && arg.startsWith('"')) {
						const string = JSON.parse(arg),
							bytes = new TextEncoder().encode(string)
						reserve(bytes.length - 1)
						statements.push({ kind: K.Bytes, bytes, at })
					} else statements.push({ kind: K.Emit, size, value: expression(arg, at), at })
				}
				return
			}
			const encode = (context: import('../../core/assembly/assembler').HookContext) => {
				try {
					if (context.dot % 2) throw new Error('Instructions must be even aligned')
					return wordsToBytes(
						encodeInstruction(operation, args, {
							pc: context.dot,
							emitting: context.emitting,
							model,
							value: (text) => context.value(expression(text, at), context.emitting) ?? 0
						})
					)
				} catch (error) {
					throw new AssemblyError((error as Error).message, at)
				}
			}
			reserve(12)
			statements.push({ kind: K.Fragment, size: (c) => encode(c).length, encode, provenance: 'instruction', at })
		} catch (error) {
			diagnostics.push({ severity: 'error', message: (error as Error).message, ...at })
		}
	}
	try {
		visitSourceLines(sources.files, sources.entries[0] ?? sources.files[0]?.name ?? '', { expansions: 4096, depth: 64, lines: 100000 }, visit)
	} catch (error) {
		diagnostics.push(error instanceof AssemblyError ? error.diagnostic : { severity: 'error', message: (error as Error).message })
	}
	if (diagnostics.length) return new M68kAssembly(sources.entries[0] ?? '', null, diagnostics, model)
	const result = assembleStatements(statements, {
		arithmetic,
		littleEndian: false,
		defaultAlignment: 1,
		originMayDecrease: false,
		entryAddress: TEXT_BASE,
		checkValue(value, size, at) {
			if (!Number.isInteger(value) || value < -(2 ** (size * 8 - 1)) || value >= 2 ** (size * 8))
				throw new AssemblyError('Data value out of range', at)
			return value
		},
		isInstructionMacro: () => false,
		limits: { ...defaultLimits, addressLimit: MEMORY_BYTES, maxBytes: MEMORY_BYTES },
		sections: [{ start: TEXT_BASE }, { start: DATA_BASE }]
	})
	if (result.image)
		result.image.entryAddress = result.symbols.lookup('_start') ?? result.symbols.lookup('main') ?? TEXT_BASE
	return new M68kAssembly(sources.entries[0] ?? '', result.image, result.diagnostics, model)
}
