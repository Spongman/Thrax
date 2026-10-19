/**
 * The A64 dialect of GNU as on the shared assembler engine.
 *
 * The parser reads logical lines (comments gone, macros and `.rept` expanded
 * as text, `.include` read in place) and turns each statement into engine
 * statements: an instruction is a 4-byte fragment encoded once layout is
 * settled, and data directives are fragments or bytes. `.text` and `.data`
 * are the engine's two sections, at TEXT_BASE and DATA_BASE.
 *
 * Numbers are exact to 64 bits when written as a literal; arithmetic on
 * symbols is exact within 2^53.
 */

import { assembleStatements, defaultLimits, StatementKind, type AssemblerConfig, type AssemblerLimits, type HookContext, type Statement } from '../../../../core/assembly/assembler'
import type { AssemblyImage, Provenance } from '../../../../core/assembly/emitter'
import { evaluate, Op, type Arithmetic } from '../../../../core/assembly/expressions'
import { location, type ExpansionFrame } from '../../../../core/assembly/macroEngine'
import type { AssemblySource } from '../../../../core/assembly/sources'
import { TokenKind, positionOf, type Position } from '../../../../core/assembly/tokens'
import { AssemblyError } from '../../../../core/diagnostics'
import type { Diagnostic } from '../../../../core/types'
import { DATA_BASE, TEXT_BASE } from '../layout'
import { encoderFor, isMnemonic, type EncodeContext, type PoolSlot } from './encoder'
import { parseOperands, parseValue, type Value } from './operands'
import { LineReader, linesOf, type LogicalLine } from './source'
import { tokenizeA64Line, type A64Token } from './tokenizer'

export { A64_MNEMONICS } from './encoder'

const { Label, Assign, Align, Bytes, Hook, Section, Fragment } = StatementKind
const { Add, Sub, Mul, Div, Mod, And, Or, Xor, Shl, Shr, Sar, Neg, Not, Plus } = Op

export const SECTION_TEXT = 0
export const SECTION_DATA = 1

/** GNU arithmetic on 64-bit integers, carried as numbers. */
export const a64Arithmetic: Arithmetic = {
	unary(op, value) {
		switch (op) {
			case Neg: return -value
			case Not: return Number(BigInt.asIntN(64, ~BigInt(Math.trunc(value))))
			case Plus: return value
		}
		throw new Error(`Unsupported unary operator ${op}`)
	},
	binary(op, left, right, at) {
		const a = BigInt(Math.trunc(left))
		const b = BigInt(Math.trunc(right))
		const back = (value: bigint) => Number(BigInt.asIntN(64, value))
		switch (op) {
			case Add: return left + right
			case Sub: return left - right
			case Mul: return back(a * b)
			case Div:
				if (b === 0n) throw new AssemblyError('Division by zero', at)
				return back(a / b)
			case Mod:
				if (b === 0n) throw new AssemblyError('Modulo by zero', at)
				return back(a % b)
			case And: return back(a & b)
			case Or: return back(a | b)
			case Xor: return back(a ^ b)
			case Shl: return back(a << (b & 63n))
			case Shr: case Sar: return back(BigInt.asIntN(64, a) >> (b & 63n))
		}
		throw new Error(`Unsupported binary operator ${op}`)
	},
}

export function a64Config(limits: AssemblerLimits = { ...defaultLimits, addressLimit: 2 ** 48 }): AssemblerConfig {
	return {
		arithmetic: a64Arithmetic,
		checkValue: (value) => value,
		littleEndian: true,
		defaultAlignment: 4,
		originMayDecrease: false,
		entryAddress: TEXT_BASE,
		isInstructionMacro: () => false,
		limits,
		sections: [{ start: TEXT_BASE }, { start: DATA_BASE }],
	}
}

export interface A64AssemblyOptions {
	/** Workspace documents that `.include` may name. */
	files?: readonly AssemblySource[]
	limits?: AssemblerLimits
}

export interface A64AssemblyResult {
	image: AssemblyImage | null
	diagnostics: Diagnostic[]
	/** Every symbol's value, labels and `.equ` alike. */
	values: ReadonlyMap<string, number>
	/** Symbols declared `.global`. */
	globals: ReadonlySet<string>
}

interface Macro {
	name: string
	parameters: { name: string, fallback: string }[]
	body: LogicalLine[]
	at: Position
}

const DATA_SIZES: Readonly<Record<string, number>> = {
	'.byte': 1, '.hword': 2, '.short': 2, '.half': 2, '.2byte': 2, '.word': 4, '.long': 4, '.int': 4, '.4byte': 4,
	'.quad': 8, '.xword': 8, '.dword': 8, '.8byte': 8,
}

/** Directives GNU uses for object files and debugging, which mean nothing here. */
const IGNORED = new Set([
	'.type', '.size', '.file', '.ident', '.arch', '.cpu', '.local', '.weak', '.hidden', '.protected', '.loc', '.func', '.endfunc',
	'.cfi_startproc', '.cfi_endproc', '.cfi_def_cfa', '.cfi_def_cfa_offset', '.cfi_offset', '.cfi_restore', '.cfi_sections',
])

export const A64_DIRECTIVES: readonly string[] = Object.freeze([
	'.text', '.data', '.bss', '.rodata', '.section', '.global', '.globl', ...Object.keys(DATA_SIZES), '.ascii', '.asciz', '.string',
	'.align', '.p2align', '.balign', '.space', '.skip', '.zero', '.fill', '.equ', '.set', '.ltorg', '.pool', '.include', '.end',
	'.macro', '.endm', '.rept', '.endr', '.inst', '.error', ...IGNORED,
].sort())

const MAX_DEPTH = 64
const MAX_EXPANDED_LINES = 200_000
const LOCAL_REFERENCE = /^(\d+)([fb])$/

const isOperator = (token: A64Token | undefined, text: string) => token?.kind === TokenKind.Operator && token.text === text

/** `count` bytes of `value`, little-endian. */
function littleEndian(value: bigint, count: number): number[] {
	const bytes: number[] = []
	for (let index = 0; index < count; index++) bytes.push(Number((value >> BigInt(index * 8)) & 0xFFn))
	return bytes
}

function contextOf(hook: HookContext): EncodeContext {
	return {
		dot: hook.dot,
		value(value) {
			const raw = value.exact ?? BigInt(Math.trunc(hook.value(value.expr, true)!))
			return value.lo12 ? raw & 0xFFFn : raw
		},
		slot: (slot) => slot.address,
	}
}

/** The name the `index`th definition of local label `label` takes. */
const localName = (label: string, index: number) => `.L${label}.${index}`

class Parser {
	readonly statements: Statement[] = []
	readonly diagnostics: Diagnostic[] = []
	readonly globals = new Set<string>()
	private readonly reader = new LineReader()
	private readonly macros = new Map<string, Macro>()
	/** `.equ` values known while parsing, for sizes that layout needs. */
	private readonly constants = new Map<string, number>()
	private section = SECTION_TEXT
	/** Literal pool entries not yet placed, per section. */
	private readonly pools: PoolSlot[][] = [[], []]
	/** Definitions of each numeric local label so far. */
	private readonly locals = new Map<string, number>()
	/** Forward references to numeric labels, checked once every line is read. */
	private readonly forward: { label: string, index: number, at: Position }[] = []
	private expansions = 0
	private expandedLines = 0

	constructor(private readonly files: Map<string, AssemblySource>, private readonly limit: number) {}

	parse(main: AssemblySource) {
		this.reader.push(linesOf(main.name, main.code))
		for (let line = this.reader.next(); line; line = this.reader.next()) {
			try {
				this.parseLine(line)
			} catch (error) {
				if (!(error instanceof AssemblyError)) throw error
				this.diagnostics.push(error.diagnostic)
				if (this.diagnostics.length >= this.limit) return
			}
		}
		for (const [section, pool] of this.pools.entries()) {
			if (pool.length === 0) continue
			this.statements.push({ kind: Section, section, at: this.endPosition(main) })
			this.flushPool(section, null, this.endPosition(main))
		}
		for (const reference of this.forward) {
			if (reference.index >= (this.locals.get(reference.label) ?? 0)) {
				this.diagnostics.push(new AssemblyError(`Local label ${reference.label} is not defined after this reference`, reference.at).diagnostic)
			}
		}
	}

	private endPosition(main: AssemblySource): Position {
		return { file: main.name, line: main.code.split('\n').length, column: 1 }
	}

	private parseLine(line: LogicalLine) {
		const tokens = tokenizeA64Line(line.text, line.file, line.line)
		// A macro body or a repeat is read as text, so it is caught before its lines are parsed.
		const head = this.firstWord(tokens)
		if (head?.text.toLowerCase() === '.macro') return this.defineMacro(line, tokens, head)
		if (head?.text.toLowerCase() === '.rept') return this.repeat(tokens, head)
		let start = 0
		for (let index = 0; index <= tokens.length; index++) {
			if (index < tokens.length && tokens[index].kind !== TokenKind.Newline) continue
			// A macro takes the rest of the line with it, so what follows comes after its body.
			if (index > start && this.statement(tokens.slice(start, index), line, tokens[index])) return
			start = index + 1
		}
	}

	/** The first token after any labels. */
	private firstWord(tokens: readonly A64Token[]): A64Token | undefined {
		let index = 0
		while (tokens[index + 1] && isOperator(tokens[index + 1], ':') && (tokens[index].kind === TokenKind.Identifier || tokens[index].kind === TokenKind.Number)) index += 2
		return tokens[index]?.kind === TokenKind.Identifier ? tokens[index] : undefined
	}

	/** Parses one statement; true when a macro expansion took the rest of the line. */
	private statement(tokens: A64Token[], line: LogicalLine, separator: A64Token | undefined): boolean {
		let index = 0
		// Labels, any number of them, before the statement proper.
		while (index + 1 < tokens.length && isOperator(tokens[index + 1], ':')) {
			const token = tokens[index]
			if (token.kind === TokenKind.Number) {
				const label = token.text
				const count = this.locals.get(label) ?? 0
				this.locals.set(label, count + 1)
				this.label(localName(label, count), positionOf(token))
			} else if (token.kind === TokenKind.Identifier) {
				this.label(token.text, positionOf(token))
			} else {
				break
			}
			index += 2
		}
		const rest = tokens.slice(index)
		if (rest.length === 0) return false
		const head = rest[0]
		const at = positionOf(head)
		if (head.kind !== TokenKind.Identifier) throw new AssemblyError(`Unexpected '${head.text}'`, at)
		if (isOperator(rest[1], '=')) {
			this.assign(head.text, rest.slice(2), at)
			return false
		}
		const name = head.text.toLowerCase()
		const macro = this.macros.get(name)
		if (macro && !isMnemonic(name)) {
			this.expand(macro, line, head, separator)
			return true
		}
		const operands = this.renameLocals(rest.slice(1))
		if (name === '.inst') {
			const values = this.values(operands, at)
			if (values.length !== 1) throw new AssemblyError('.inst takes one word', at)
			this.instruction(at, line, (context) => Number(BigInt.asUintN(32, context.value(values[0]))))
		} else if (name.startsWith('.')) {
			this.directive(name, operands, at, line, head)
		} else {
			const environment = { pool: (size: number, value: Value) => this.poolSlot(size, value) }
			this.instruction(at, line, encoderFor(head.text, parseOperands(operands, at), at, environment))
		}
		return false
	}

	private label(name: string, at: Position) {
		this.statements.push({ kind: Label, name, at, movable: true })
	}

	/** Numeric local label references take the name of the definition they mean. */
	private renameLocals(tokens: A64Token[]): A64Token[] {
		return tokens.map((token) => {
			const match = token.kind === TokenKind.Identifier ? LOCAL_REFERENCE.exec(token.text) : null
			if (!match) return token
			const [, label, direction] = match
			const defined = this.locals.get(label) ?? 0
			if (direction === 'b') {
				if (defined === 0) throw new AssemblyError(`Local label ${label} is not defined before this reference`, positionOf(token))
				return { ...token, text: localName(label, defined - 1) }
			}
			this.forward.push({ label, index: defined, at: positionOf(token) })
			return { ...token, text: localName(label, defined) }
		})
	}

	private instruction(at: Position, line: LogicalLine, encode: (context: EncodeContext) => number) {
		const provenance: Provenance = { kind: 'instruction', source: location(at), expansion: line.expansion }
		// Instructions are word aligned; a label just before one moves with it.
		this.statements.push({ kind: Align, boundary: { kind: 0, value: 4 }, at, carry: true })
		this.statements.push({
			kind: Fragment, size: 4, provenance, at,
			encode: (hook) => littleEndian(BigInt(encode(contextOf(hook)) >>> 0), 4),
		})
	}

	private poolSlot(size: number, value: Value): PoolSlot {
		const pool = this.pools[this.section]
		if (value.exact !== null) {
			const same = pool.find((slot) => slot.size === size && slot.value.exact === value.exact && !slot.value.lo12 && !value.lo12)
			if (same) return same
		}
		const slot: PoolSlot = { size, value, address: 0 }
		pool.push(slot)
		return slot
	}

	/** Places the current section's pending literals here, doublewords first. */
	private flushPool(section: number, line: LogicalLine | null, at: Position) {
		const pool = this.pools[section]
		if (pool.length === 0) return
		this.pools[section] = []
		const ordered = [...pool].sort((left, right) => right.size - left.size)
		this.statements.push({ kind: Align, boundary: { kind: 0, value: ordered[0].size }, at })
		const provenance: Provenance | null = line ? { kind: 'data', source: location(at), expansion: line.expansion } : null
		for (const slot of ordered) {
			this.statements.push({ kind: Hook, run: (context) => { slot.address = context.dot }, at })
			this.statements.push({
				kind: Fragment, size: slot.size, provenance, at,
				encode: (hook) => littleEndian(BigInt.asUintN(slot.size * 8, contextOf(hook).value(slot.value)), slot.size),
			})
		}
	}

	private assign(name: string, tokens: A64Token[], at: Position) {
		const value = parseValue(this.renameLocals(tokens), at)
		this.statements.push({ kind: Assign, name, value: value.expr, at })
		const known = this.tryConstant(value)
		if (known === null) this.constants.delete(name)
		else this.constants.set(name, known)
	}

	/** A value from symbols already assigned, or null where it needs layout. */
	private tryConstant(value: Value): number | null {
		if (value.exact !== null) return Number(BigInt.asIntN(64, value.exact))
		try {
			const result = evaluate(value.expr, { lookup: (name) => this.constants.get(name), dot: NaN }, a64Arithmetic, true)
			return result === undefined || Number.isNaN(result) ? null : result
		} catch {
			return null
		}
	}

	/** A value the parser needs now, such as a size. */
	private constant(tokens: readonly A64Token[], at: Position, what: string): number {
		const value = this.tryConstant(parseValue(tokens, at))
		if (value === null) throw new AssemblyError(`${what} must be a constant known at this point`, at)
		return value
	}

	/** Comma-separated values. */
	private values(tokens: A64Token[], at: Position): Value[] {
		const groups: A64Token[][] = [[]]
		let depth = 0
		for (const token of tokens) {
			if (isOperator(token, '(')) depth++
			if (isOperator(token, ')')) depth--
			if (isOperator(token, ',') && depth === 0) groups.push([])
			else groups[groups.length - 1].push(token)
		}
		return groups.map((group) => {
			if (group.length === 0) throw new AssemblyError('Expected a value', at)
			return parseValue(group, positionOf(group[0]))
		})
	}

	private directive(name: string, tokens: A64Token[], at: Position, line: LogicalLine, head: A64Token) {
		const size = DATA_SIZES[name]
		if (size !== undefined) return this.data(size, tokens, at, line)
		if (IGNORED.has(name) || name.startsWith('.cfi_')) return
		switch (name) {
			case '.text': return this.select(SECTION_TEXT, at)
			case '.data': case '.bss': case '.rodata': return this.select(SECTION_DATA, at)
			case '.section': {
				const section = tokens[0]?.kind === TokenKind.Identifier || tokens[0]?.kind === TokenKind.String ? (tokens[0].string ?? tokens[0].text) : ''
				if (/^\.text/.test(section)) return this.select(SECTION_TEXT, at)
				if (/^\.(data|rodata|bss)/.test(section)) return this.select(SECTION_DATA, at)
				throw new AssemblyError(`Unknown section ${section || '(none)'}; use .text, .data, .rodata or .bss`, at)
			}
			case '.global': case '.globl':
				for (const token of tokens) if (token.kind === TokenKind.Identifier) this.globals.add(token.text)
				return
			case '.ascii': case '.asciz': case '.string': {
				const bytes: number[] = []
				for (const [index, token] of tokens.entries()) {
					if (index % 2 === 1) {
						if (!isOperator(token, ',')) throw new AssemblyError('Expected a comma between strings', positionOf(token))
						continue
					}
					if (token.kind !== TokenKind.String) throw new AssemblyError(`${name} takes quoted strings`, positionOf(token))
					for (const character of token.string!) bytes.push(character.charCodeAt(0) & 0xFF)
					if (name !== '.ascii') bytes.push(0)
				}
				if (tokens.length === 0) throw new AssemblyError(`${name} takes quoted strings`, at)
				this.statements.push({ kind: Bytes, bytes: Uint8Array.from(bytes), at })
				return
			}
			case '.align': case '.p2align': case '.balign': {
				const [boundary, fill] = this.split(tokens)
				if (!boundary?.length) throw new AssemblyError(`${name} takes an alignment`, at)
				if (fill?.length && this.constant(fill, at, 'The fill') !== 0) throw new AssemblyError('Only zero fill is supported', at)
				const value = this.constant(boundary, at, 'The alignment')
				const bytes = name === '.balign' ? value : 2 ** value
				if (!Number.isInteger(bytes) || bytes < 1 || bytes > 65536 || (bytes & (bytes - 1)) !== 0) throw new AssemblyError(`Alignment ${bytes} is not a power of two up to 65536`, at)
				this.statements.push({ kind: Align, boundary: { kind: 0, value: bytes }, at })
				return
			}
			case '.space': case '.skip': case '.zero': {
				const [length, fill] = this.split(tokens)
				if (!length?.length) throw new AssemblyError(`${name} takes a size`, at)
				const count = this.constant(length, at, 'The size')
				const byte = fill?.length ? this.constant(fill, at, 'The fill') : 0
				if (!Number.isSafeInteger(count) || count < 0 || count > 16 * 1024 * 1024) throw new AssemblyError(`Size ${count} is out of range`, at)
				this.statements.push({ kind: Bytes, bytes: new Uint8Array(count).fill(byte & 0xFF), at })
				return
			}
			case '.fill': {
				const [repeat, each, fill] = this.split(tokens)
				const count = this.constant(repeat ?? [], at, 'The repeat count')
				const width = each?.length ? this.constant(each, at, 'The size') : 1
				const value = fill?.length ? BigInt(this.constant(fill, at, 'The value')) : 0n
				if (!Number.isSafeInteger(count) || count < 0 || count * width > 16 * 1024 * 1024 || width < 0 || width > 8) throw new AssemblyError('Fill size out of range', at)
				const element = littleEndian(BigInt.asUintN(Math.min(width, 4) * 8, value), width)
				this.statements.push({ kind: Bytes, bytes: Uint8Array.from({ length: count * width }, (_, index) => element[index % width]), at })
				return
			}
			case '.equ': case '.set': {
				const [symbol, ...value] = this.split(tokens)
				if (symbol?.length !== 1 || symbol[0].kind !== TokenKind.Identifier || value.length !== 1) throw new AssemblyError(`${name} takes a symbol and a value`, at)
				return this.assign(symbol[0].text, value[0], at)
			}
			case '.ltorg': case '.pool': return this.flushPool(this.section, line, at)
			case '.include': {
				const file = tokens[0]
				if (file?.kind !== TokenKind.String || tokens.length !== 1) throw new AssemblyError('.include takes a quoted file name', at)
				const source = this.files.get(normalize(file.string!)) ?? this.files.get(normalize(directory(line.file) + file.string!))
				if (!source) throw new AssemblyError(`File not found: ${file.string}`, positionOf(file))
				if (this.reader.depth >= MAX_DEPTH) throw new AssemblyError('Includes and macros nest too deeply', at)
				this.reader.push(linesOf(source.name, source.code))
				return
			}
			case '.end':
				while (this.reader.next()) { /* everything after .end is ignored */ }
				return
			case '.endm': case '.endr': throw new AssemblyError(`${head.text} without a matching ${name === '.endm' ? '.macro' : '.rept'}`, at)
			case '.error': case '.err': {
				const message = tokens[0]?.kind === TokenKind.String ? tokens[0].string! : '.error directive'
				throw new AssemblyError(message, at)
			}
		}
		throw new AssemblyError(`Unknown directive ${head.text}`, at)
	}

	/** Tokens split at the commas outside parentheses. */
	private split(tokens: A64Token[]): A64Token[][] {
		const groups: A64Token[][] = [[]]
		let depth = 0
		for (const token of tokens) {
			if (isOperator(token, '(')) depth++
			if (isOperator(token, ')')) depth--
			if (isOperator(token, ',') && depth === 0) groups.push([])
			else groups[groups.length - 1].push(token)
		}
		return groups.length === 1 && groups[0].length === 0 ? [] : groups
	}

	private select(section: number, at: Position) {
		this.section = section
		this.statements.push({ kind: Section, section, at })
	}

	private data(size: number, tokens: A64Token[], at: Position, line: LogicalLine) {
		const values = this.values(tokens, at)
		const provenance: Provenance = { kind: 'data', source: location(at), expansion: line.expansion }
		const bits = BigInt(size * 8)
		this.statements.push({
			kind: Fragment, size: size * values.length, provenance, at,
			encode: (hook) => {
				const context = contextOf(hook)
				return values.flatMap((value) => {
					const result = context.value(value)
					if (size < 8 && (result < -(1n << (bits - 1n)) || result >= 1n << bits)) {
						throw new AssemblyError(`Value ${result} does not fit in ${size} byte${size === 1 ? '' : 's'}`, value.at)
					}
					return littleEndian(BigInt.asUintN(size * 8, result), size)
				})
			},
		})
	}

	/* --------------------------------------------------------- macros */

	/** Reads a body up to the matching end directive; nested definitions of the same kind count. */
	private body(open: RegExp, close: RegExp, what: string, at: Position): LogicalLine[] {
		const lines: LogicalLine[] = []
		let depth = 1
		for (let line = this.reader.next(); line; line = this.reader.next()) {
			if (open.test(line.text)) depth++
			else if (close.test(line.text) && --depth === 0) return lines
			lines.push(line)
		}
		throw new AssemblyError(`${what} has no end`, at)
	}

	private defineMacro(line: LogicalLine, tokens: A64Token[], head: A64Token) {
		const at = positionOf(head)
		const body = this.body(/^\s*\.macro\b/i, /^\s*\.endm\b/i, '.macro', at)
		const after = tokens.slice(tokens.indexOf(head) + 1)
		const nameToken = after[0]
		if (nameToken?.kind !== TokenKind.Identifier) throw new AssemblyError('.macro needs a name', at)
		let list = after.slice(1)
		if (isOperator(list[0], ',')) list = list.slice(1)
		const parameters: Macro['parameters'] = []
		for (const group of this.split(list)) {
			const equals = group.findIndex((token) => isOperator(token, '='))
			const names = equals < 0 ? group : group.slice(0, equals)
			if (names.length === 0 || names.some((token) => token.kind !== TokenKind.Identifier)) {
				throw new AssemblyError('Expected parameter names', group[0] ? positionOf(group[0]) : at)
			}
			// `a b c` names three parameters; `a=1` gives one a default.
			for (const token of names) parameters.push({ name: token.text, fallback: '' })
			const first = group[equals + 1]
			if (equals >= 0 && first) {
				const last = group[group.length - 1]
				parameters[parameters.length - 1].fallback = line.text.slice(first.column - 1, last.column - 1 + last.length)
			}
		}
		this.macros.set(nameToken.text.toLowerCase(), { name: nameToken.text, parameters, body, at: positionOf(nameToken) })
	}

	private repeat(tokens: A64Token[], head: A64Token) {
		const at = positionOf(head)
		const body = this.body(/^\s*\.rept\b/i, /^\s*\.endr\b/i, '.rept', at)
		const times = this.constant(this.renameLocals(tokens.slice(tokens.indexOf(head) + 1)), at, 'The repeat count')
		if (!Number.isSafeInteger(times) || times < 0) throw new AssemblyError(`Repeat count ${times} is out of range`, at)
		this.push(Array.from({ length: times }, () => body).flat(), at)
	}

	/** Reads expanded lines next, within the limits. */
	private push(lines: LogicalLine[], at: Position) {
		this.expandedLines += lines.length
		if (this.expandedLines > MAX_EXPANDED_LINES) throw new AssemblyError(`Expansion exceeds ${MAX_EXPANDED_LINES} lines`, at)
		if (this.reader.depth >= MAX_DEPTH) throw new AssemblyError('Includes and macros nest too deeply (is a macro recursive?)', at)
		this.reader.push(lines)
	}

	private expand(macro: Macro, line: LogicalLine, head: A64Token, separator: A64Token | undefined) {
		const at = positionOf(head)
		const text = line.text
		const start = head.column - 1 + head.length
		const end = separator ? separator.column - 1 : text.length
		const supplied = splitArguments(text.slice(start, end))
		const values = new Map(macro.parameters.map((parameter) => [parameter.name, parameter.fallback]))
		let position = 0
		for (const argument of supplied) {
			const keyword = /^([A-Za-z_.$][\w.$]*)\s*=(?!=)\s*(.*)$/s.exec(argument)
			if (keyword && values.has(keyword[1])) {
				values.set(keyword[1], keyword[2].trim())
				continue
			}
			const parameter = macro.parameters[position++]
			if (!parameter) throw new AssemblyError(`Too many arguments to macro ${macro.name}`, at)
			if (argument !== '') values.set(parameter.name, argument)
		}
		const count = this.expansions++
		const frame: ExpansionFrame = { macro: macro.name, invocation: location(at), definition: location(macro.at) }
		const expansion = [...line.expansion, frame]
		const names = [...values.keys()].sort((left, right) => right.length - left.length)
		const substitute = (body: string) => body.replace(/\\(@|\(\)|[A-Za-z_.$][\w.$]*)/g, (whole, name: string) => {
			if (name === '@') return String(count)
			if (name === '()') return ''
			const known = names.find((candidate) => name.startsWith(candidate))
			return known === undefined ? whole : values.get(known)! + name.slice(known.length)
		})
		const lines: LogicalLine[] = macro.body.map((bodyLine) => ({ text: substitute(bodyLine.text), file: line.file, line: line.line, expansion }))
		// What followed on the line, read once the body has been.
		if (separator) lines.push({ ...line, text: ' '.repeat(separator.column) + text.slice(separator.column) })
		this.push(lines, at)
	}
}

/** Macro arguments: split at commas outside quotes and brackets, trimmed. */
function splitArguments(text: string): string[] {
	if (text.trim() === '') return []
	const parts: string[] = []
	let depth = 0
	let quoted = false
	let current = ''
	for (let index = 0; index < text.length; index++) {
		const character = text[index]
		if (quoted) {
			current += character
			if (character === '\\') current += text[++index] ?? ''
			else if (character === '"') quoted = false
			continue
		}
		if (character === '"') quoted = true
		else if ('[({'.includes(character)) depth++
		else if ('])}'.includes(character)) depth--
		else if (character === ',' && depth === 0) {
			parts.push(current.trim())
			current = ''
			continue
		}
		current += character
	}
	parts.push(current.trim())
	return parts
}

const directory = (path: string) => path.slice(0, path.lastIndexOf('/') + 1)

function normalize(path: string): string {
	const parts: string[] = []
	for (const part of path.split('/')) {
		if (part === '..') parts.pop()
		else if (part !== '.' && part !== '') parts.push(part)
	}
	return parts.join('/')
}

/** The entry point: `_start`, else `main`, else the start of the text. */
function entryOf(symbols: AssemblyImage['symbols']): number {
	return symbols.find((symbol) => symbol.name === '_start')?.address ?? symbols.find((symbol) => symbol.name === 'main')?.address ?? TEXT_BASE
}

/** Assembles one translation unit; other files take part only through `.include`. */
export function assembleA64(main: AssemblySource, options: A64AssemblyOptions = {}): A64AssemblyResult {
	const files = new Map((options.files ?? []).map((file) => [normalize(file.name), file]))
	files.set(normalize(main.name), main)
	const config = a64Config(options.limits)
	const parser = new Parser(files, config.limits.diagnostics)
	parser.parse(main)
	const none = { image: null, values: new Map<string, number>(), globals: parser.globals }
	if (parser.diagnostics.length) return { ...none, diagnostics: parser.diagnostics }
	const outcome = assembleStatements(parser.statements, config)
	if (!outcome.image) return { ...none, diagnostics: outcome.diagnostics }
	const values = new Map<string, number>()
	for (const [name, value] of outcome.symbols.entries()) if (value !== undefined) values.set(name, value)
	const image: AssemblyImage = { ...outcome.image, entryAddress: entryOf(outcome.image.symbols) }
	return { image, diagnostics: outcome.diagnostics, values, globals: parser.globals }
}
