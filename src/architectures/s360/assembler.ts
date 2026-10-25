/**
 * An IBM Assembler (H/HLASM) style two-pass assembler: fixed name/operation/
 * operand/remarks fields, CSECT/DSECT, USING/DROP base resolution, DC/DS
 * constants, literals with LTORG, EQU, ORG, CNOP and END.
 */
import type { AssemblySources, Diagnostic, SourceLocation } from '../contracts'
import { ByteEmitter, type AssemblyImage, type Provenance } from '../../core/assembly/emitter'
import { encodeEbcdic } from './ebcdic'
import { packDecimal } from './decimal'
import * as hfp from './hfp'
import { hasFeatures, lengthOf, opcodes, RR, RR1, RRI, RRX, RS, RSH, RX, RXX, SI, SI1, SSL, SSLL, SSRP, DECIMAL, FLOAT, S370, type Model, type Opcode } from './isa'

/** A value and its relocatability: section -1 is absolute, 0 the program, others a DSECT. */
interface Value { value: number, section: number, length?: number }
const ABSOLUTE = -1, PROGRAM = 0

interface SymbolEntry { name: string, value: number, section: number, length: number, file: string, line: number }

interface Statement {
	file: string, line: number, text: string
	label: string, op: string, opColumn: number
	operands: string, operandColumn: number
}

class AssemblyError extends Error {
	constructor(message: string, readonly column?: number) { super(message) }
}
/** Raised in pass one for a symbol not yet defined; pass two reports it. */
class Undefined extends AssemblyError {}

const SYMBOL = /^[A-Za-z@#$_][\w@#$]*/
const isSymbolStart = (char: string | undefined) => !!char && /[A-Za-z@#$_]/.test(char)
const isSymbolChar = (char: string | undefined) => !!char && /[\w@#$]/.test(char)

/** Directives the assembler accepts, for completions and help. */
export const DIRECTIVES = ['CSECT', 'DSECT', 'START', 'USING', 'DROP', 'DC', 'DS', 'EQU', 'ORG', 'LTORG', 'CNOP', 'END', 'COPY', 'TITLE', 'EJECT', 'SPACE', 'PRINT'] as const
const IGNORED = new Set(['TITLE', 'EJECT', 'SPACE', 'PRINT', 'AMODE', 'RMODE'])

/** An attribute reference such as L'NAME, rather than the start of a quoted string. */
const isAttribute = (text: string, quote: number) =>
	/[Ll]/.test(text[quote - 1] ?? '') && !isSymbolChar(text[quote - 2]) && isSymbolStart(text[quote + 1])

/** Index past a quoted string starting at `start`; '' is an escaped quote. */
function quoteEnd(text: string, start: number): number {
	let i = start + 1
	for (; i < text.length; i++) {
		if (text[i] !== "'") continue
		if (text[i + 1] === "'") { i++; continue }
		return i + 1
	}
	throw new AssemblyError('Unterminated quoted string', start + 1)
}

/** Split name, operation, operands and remarks; blanks inside quotes belong to the operand. */
function parseLine(file: string, line: number, raw: string): Statement | null {
	const text = raw.replace(/\r$/, '').replace(/\t/g, ' ')
	if (!text.trim() || text[0] === '*' || text.startsWith('.*')) return null
	const gnu = /^\s*\.(?:equ|set)\s+([A-Za-z@#$_][\w@#$]*)\s*,\s*(\S.*?)\s*$/i.exec(text)
	if (gnu) return { file, line, text, label: gnu[1], op: 'EQU', opColumn: text.indexOf('.') + 1, operands: gnu[2], operandColumn: text.indexOf(gnu[2]) + 1 }
	let i = 0
	while (i < text.length && text[i] !== ' ') i++
	const label = text.slice(0, i)
	while (text[i] === ' ') i++
	const opStart = i
	while (i < text.length && text[i] !== ' ') i++
	const op = text.slice(opStart, i)
	while (text[i] === ' ') i++
	const operandStart = i
	while (i < text.length && text[i] !== ' ') {
		if (text[i] === "'" && !isAttribute(text, i)) i = quoteEnd(text, i)
		else i++
	}
	return { file, line, text, label, op: op.toUpperCase(), opColumn: opStart + 1, operands: text.slice(operandStart, i), operandColumn: operandStart + 1 }
}

/** Split at top-level commas, outside parentheses and quoted strings. */
function splitOperands(text: string): { text: string, offset: number }[] {
	const parts: { text: string, offset: number }[] = []
	let depth = 0, start = 0
	for (let i = 0; i < text.length; i++) {
		const char = text[i]
		if (char === "'" && !isAttribute(text, i)) { i = quoteEnd(text, i) - 1; continue }
		if (char === '(') depth++
		else if (char === ')') depth--
		else if (char === ',' && depth === 0) { parts.push({ text: text.slice(start, i), offset: start }); start = i + 1 }
	}
	if (text.length) parts.push({ text: text.slice(start), offset: start })
	return parts
}

/** Self-defining term value of a quoted C, X or B term. */
function selfDefining(type: string, body: string): number {
	let bytes: number[]
	if (type === 'C') {
		const encoded = encodeEbcdic(body.replace(/''/g, "'").replace(/&&/g, '&'))
		if (!encoded) throw new AssemblyError(`C'${body}' has a character outside EBCDIC code page 037`)
		bytes = encoded
	} else if (type === 'X') {
		if (!/^[\da-f]+$/i.test(body)) throw new AssemblyError(`Invalid hexadecimal term X'${body}'`)
		return parseInt(body, 16) >>> 0
	} else {
		if (!/^[01]+$/.test(body)) throw new AssemblyError(`Invalid binary term B'${body}'`)
		return parseInt(body, 2) >>> 0
	}
	if (bytes.length > 4) throw new AssemblyError('A character term holds at most four characters')
	return bytes.reduce((value, byte) => value * 256 + byte, 0)
}

interface Scope {
	symbol(name: string): SymbolEntry | undefined
	location: Value
	/** Pass one tolerates undefined symbols by raising Undefined. */
	final: boolean
}

/** Expression with + - * / and parentheses; relocatable terms follow the assembler's pairing rules. */
function evaluate(text: string, scope: Scope): Value {
	let i = 0
	const fail = (message: string): never => { throw new AssemblyError(message) }
	const space = () => { while (text[i] === ' ') i++ }
	let first: number | undefined
	function term(): Value {
		space()
		const char = text[i]
		if (char === '(') {
			i++
			const value = sum()
			space()
			if (text[i] !== ')') fail(`Missing ) in ${text}`)
			i++
			return value
		}
		if (char === '+' || char === '-') {
			i++
			const value = term()
			if (char === '+') return value
			if (value.section !== ABSOLUTE) fail('A relocatable term cannot be negated')
			return { value: -value.value, section: ABSOLUTE }
		}
		if (char === '*') { i++; first ??= scope.location.length ?? 1; return { ...scope.location } }
		if (/\d/.test(char ?? '')) {
			const match = /^\d+/.exec(text.slice(i))!
			i += match[0].length
			first ??= 1
			return { value: Number(match[0]), section: ABSOLUTE }
		}
		const typed = /^([CXBcxb])'/.exec(text.slice(i))
		if (typed) {
			const end = quoteEnd(text, i + 1)
			const value = selfDefining(typed[1].toUpperCase(), text.slice(i + 2, end - 1))
			i = end
			first ??= 1
			return { value, section: ABSOLUTE }
		}
		if (/^[Ll]'/.test(text.slice(i))) {
			i += 2
			const name = SYMBOL.exec(text.slice(i))
			if (!name) fail('L\' needs a symbol')
			i += name![0].length
			const entry = scope.symbol(name![0])
			if (!entry) { if (scope.final) fail(`Undefined symbol ${name![0]}`); throw new Undefined(`Undefined symbol ${name![0]}`) }
			first ??= 1
			return { value: entry!.length, section: ABSOLUTE }
		}
		const name = SYMBOL.exec(text.slice(i))
		if (!name) fail(`Unexpected ${text.slice(i) || 'end of expression'} in ${text}`)
		i += name![0].length
		const entry = scope.symbol(name![0])
		if (!entry) {
			if (scope.final) fail(`Undefined symbol ${name![0]}`)
			throw new Undefined(`Undefined symbol ${name![0]}`)
		}
		first ??= entry!.length
		return { value: entry!.value, section: entry!.section }
	}
	function product(): Value {
		let left = term()
		for (;;) {
			space()
			const op = text[i]
			if (op !== '*' && op !== '/') return left
			i++
			const right = term()
			if (left.section !== ABSOLUTE || right.section !== ABSOLUTE) fail('Multiplication and division need absolute terms')
			if (op === '/' && right.value === 0) left = { value: 0, section: ABSOLUTE }
			else left = { value: op === '*' ? left.value * right.value : Math.trunc(left.value / right.value), section: ABSOLUTE }
		}
	}
	function sum(): Value {
		let left = product()
		for (;;) {
			space()
			const op = text[i]
			if (op !== '+' && op !== '-') return left
			i++
			const right = product()
			if (op === '+') {
				if (left.section !== ABSOLUTE && right.section !== ABSOLUTE) fail('Two relocatable terms cannot be added')
				left = { value: left.value + right.value, section: left.section !== ABSOLUTE ? left.section : right.section }
			} else {
				if (right.section !== ABSOLUTE && right.section !== left.section) fail('Complexly relocatable expression')
				left = { value: left.value - right.value, section: right.section !== ABSOLUTE ? ABSOLUTE : left.section }
			}
		}
	}
	const result = sum()
	space()
	if (i < text.length) fail(`Unexpected ${text.slice(i)} in ${text}`)
	return { ...result, length: first ?? 1 }
}

/* ------------------------------------------------------------- constants */

interface Constant {
	type: string
	duplication: number
	/** Explicit length modifier, or the implied length of each value. */
	lengths: number[]
	explicit: boolean
	values: string[]
	/** Address constants hold expressions; the rest hold nominal text. */
	address: boolean
}

const implicitLengths: Record<string, number> = { F: 4, H: 2, A: 4, Y: 2, E: 4, D: 8, L: 16 }
const alignments: Record<string, number> = { F: 4, H: 2, A: 4, Y: 2, E: 4, D: 8, L: 8 }
const valueTypes = new Set(['C', 'X', 'B', 'F', 'H', 'A', 'Y', 'E', 'D', 'L', 'P', 'Z'])

/** Parse one DC/DS operand at `start`; returns the constant and the index after it. */
function parseConstant(text: string, start: number, scope: Scope, storage: boolean): { constant: Constant, end: number } {
	let i = start
	let duplication = 1
	if (text[i] === '(') {
		const close = matchParen(text, i)
		duplication = absolute(evaluate(text.slice(i + 1, close), scope), 'Duplication factor')
		i = close + 1
	} else {
		const digits = /^\d+/.exec(text.slice(i))
		if (digits) { duplication = Number(digits[0]); i += digits[0].length }
	}
	const type = (text[i] ?? '').toUpperCase()
	if (!valueTypes.has(type)) throw new AssemblyError(`Unsupported constant type ${text[i] ?? '(none)'}`)
	i++
	let length: number | undefined
	if ((text[i] ?? '').toUpperCase() === 'L') {
		i++
		if (text[i] === '(') {
			const close = matchParen(text, i)
			length = absolute(evaluate(text.slice(i + 1, close), scope), 'Length modifier')
			i = close + 1
		} else {
			const digits = /^\d+/.exec(text.slice(i))
			if (!digits) throw new AssemblyError('Length modifier needs a value')
			length = Number(digits[0]); i += digits[0].length
		}
		if (length < 1 || length > (type === 'C' || type === 'X' || type === 'B' ? 65535 : type === 'P' || type === 'Z' ? 16 : 8)) throw new AssemblyError(`Length modifier ${length} is out of range for type ${type}`)
		if ((type === 'A' || type === 'Y') && length > (type === 'Y' ? 2 : 4)) throw new AssemblyError(`${type}-type constants are at most ${type === 'Y' ? 2 : 4} bytes`)
	}
	const address = type === 'A' || type === 'Y'
	let values: string[] = []
	if (address && text[i] === '(') {
		const close = matchParen(text, i)
		values = splitOperands(text.slice(i + 1, close)).map(part => part.text)
		i = close + 1
	} else if (!address && text[i] === "'") {
		const end = quoteEnd(text, i)
		const body = text.slice(i + 1, end - 1)
		values = type === 'C' ? [body.replace(/''/g, "'").replace(/&&/g, '&')] : body.split(',')
		i = end
	} else if (!storage && duplication !== 0) throw new AssemblyError(`DC ${type} needs a nominal value`)
	const lengths = values.length ? values.map(value => length ?? implied(type, value)) : [length ?? implicitLengths[type] ?? 1]
	return { constant: { type, duplication, lengths, explicit: length !== undefined, values, address }, end: i }
}

function implied(type: string, value: string): number {
	switch (type) {
		case 'C': return Math.max(1, value.length)
		case 'X': return Math.max(1, Math.ceil(value.replace(/\s/g, '').length / 2))
		case 'B': return Math.max(1, Math.ceil(value.replace(/\s/g, '').length / 8))
		case 'P': return Math.ceil((value.replace(/[^\d]/g, '').length + 1) / 2)
		case 'Z': return Math.max(1, value.replace(/[^\d]/g, '').length)
		default: return implicitLengths[type]
	}
}

function matchParen(text: string, open: number): number {
	let depth = 0
	for (let i = open; i < text.length; i++) {
		if (text[i] === "'" && !isAttribute(text, i)) { i = quoteEnd(text, i) - 1; continue }
		if (text[i] === '(') depth++
		else if (text[i] === ')' && --depth === 0) return i
	}
	throw new AssemblyError(`Missing ) in ${text.slice(open)}`)
}

function absolute(value: Value, what: string): number {
	if (value.section !== ABSOLUTE) throw new AssemblyError(`${what} must be absolute`)
	return value.value
}

const constantAlignment = (constant: Constant) => constant.explicit ? 1 : alignments[constant.type] ?? 1
const constantSize = (constant: Constant) => constant.duplication * constant.lengths.reduce((total, length) => total + length, 0)

function bigEndian(value: bigint, length: number): number[] {
	const bytes = new Array<number>(length)
	for (let i = length - 1; i >= 0; i--) { bytes[i] = Number(value & 255n); value >>= 8n }
	return bytes
}

/** The bytes of one value of a constant, padded or truncated to `length` as the type requires. */
function constantBytes(type: string, value: string, length: number, scope: Scope): number[] {
	switch (type) {
		case 'C': {
			const encoded = encodeEbcdic(value)
			if (!encoded) throw new AssemblyError(`C'${value}' has a character outside EBCDIC code page 037`)
			return Array.from({ length }, (_, i) => encoded[i] ?? 0x40)
		}
		case 'X': case 'B': {
			const digits = value.replace(/\s/g, '')
			if (!(type === 'X' ? /^[\da-f]+$/i : /^[01]+$/).test(digits)) throw new AssemblyError(`Invalid ${type} constant '${value}'`)
			return bigEndian(BigInt(`0${type === 'X' ? 'x' : 'b'}${digits}`), length)
		}
		case 'F': case 'H': {
			if (!/^[+-]?\d+$/.test(value.trim())) throw new AssemblyError(`Invalid ${type} constant '${value}'`)
			const number = BigInt(value.trim()), bits = BigInt(8 * length)
			if (number >= 1n << bits || number < -(1n << bits - 1n)) throw new AssemblyError(`${value} does not fit ${length} bytes`)
			return bigEndian(BigInt.asUintN(8 * length, number), length)
		}
		case 'A': case 'Y': {
			const result = evaluate(value, scope)
			if (result.section > PROGRAM) throw new AssemblyError('An address constant cannot name a DSECT location')
			return bigEndian(BigInt.asUintN(8 * length, BigInt(result.value)), length)
		}
		case 'E': case 'D': case 'L': {
			const digits = type === 'E' ? hfp.SHORT : type === 'D' ? hfp.LONG : hfp.EXTENDED
			const number = hfp.fromDecimal(value, digits)
			if (!number) throw new AssemblyError(`Invalid or out of range floating-point constant '${value}'`)
			const bytes = type === 'E' ? bigEndian(BigInt(hfp.toShort(number)), 4) : type === 'D' ? bigEndian(hfp.toLong(number), 8)
				: hfp.toExtended(number).flatMap(part => bigEndian(part, 8))
			return Array.from({ length }, (_, i) => bytes[i] ?? 0)
		}
		case 'P': case 'Z': {
			const text = value.trim()
			if (!/^[+-]?\d+(?:\.\d*)?$|^[+-]?\.\d+$/.test(text)) throw new AssemblyError(`Invalid ${type} constant '${value}'`)
			const digits = text.replace(/[^\d]/g, ''), negative = text.startsWith('-')
			if (type === 'P') return packDecimal(BigInt(negative ? `-${digits}` : digits), length, negative).bytes
			const zoned = Array.from({ length }, (_, i) => 0xf0 | Number(digits[digits.length - length + i] ?? 0))
			zoned[length - 1] = zoned[length - 1] & 15 | (negative ? 0xd0 : 0xc0)
			return zoned
		}
	}
	throw new AssemblyError(`Unsupported constant type ${type}`)
}

/* -------------------------------------------------------------- assembler */

interface Section { name: string, id: number, location: number }
interface Using { base: Value, register: number }
interface Literal { text: string, constant: Constant, address: number, size: number, alignment: number }
interface Pool { literals: Literal[], statement: Statement }

const requirementText = (requires: number) => [requires & S370 ? 'System/370' : '', requires & DECIMAL ? 'the decimal feature' : '', requires & FLOAT ? 'the floating-point feature' : ''].filter(Boolean).join(' and ')

export interface AssemblerOptions { model: Model, origin: number, modelName: string }

export function assemble(sources: AssemblySources, options: AssemblerOptions): { image: AssemblyImage | null, diagnostics: Diagnostic[] } {
	const diagnostics: Diagnostic[] = []
	const report = (statement: { file: string, line: number }, error: unknown, column?: number) => {
		const message = error instanceof Error ? error.message : String(error)
		const at = error instanceof AssemblyError && error.column !== undefined ? error.column : column
		diagnostics.push({ severity: 'error', message, file: statement.file, line: statement.line, ...(at ? { column: at } : {}) })
	}

	// Statements, with COPY members inlined.
	const files = new Map(sources.files.map(file => [file.name, file.code]))
	const statements: Statement[] = []
	const read = (name: string, code: string, depth: number) => {
		code.split('\n').forEach((raw, index) => {
			let statement: Statement | null
			try { statement = parseLine(name, index + 1, raw) } catch (error) { report({ file: name, line: index + 1 }, error); return }
			if (!statement) return
			if (statement.op === 'COPY') {
				const member = statement.operands.trim()
				const found = [member, `${member}.asm`, `${member}.cpy`, `${member}.mac`].find(candidate => files.has(candidate))
				if (!found) { report(statement, new AssemblyError(`COPY member ${member} not found`), statement.operandColumn); return }
				if (depth > 8) { report(statement, new AssemblyError('COPY nesting is too deep'), statement.operandColumn); return }
				read(found, files.get(found)!, depth + 1)
				return
			}
			statements.push(statement)
		})
	}
	const entry = sources.entries[0] ?? sources.files[0]?.name
	if (entry !== undefined && files.has(entry)) read(entry, files.get(entry)!, 0)

	const symbols = new Map<string, SymbolEntry>()
	const sections = new Map<string, Section>()
	const literalSites = new Map<Statement, Literal[]>()
	const pools = new Map<Statement, Pool>()
	const statementLocation = new Map<Statement, number>()
	const statementSection = new Map<Statement, number>()
	let program: Section = { name: '', id: PROGRAM, location: options.origin }
	let current = program
	let programEnd = options.origin
	let nextDsect = 1
	let pending: Literal[] = []
	let entryText: { statement: Statement, text: string } | null = null
	const deferred: { statement: Statement, key: string }[] = []
	const cnopEnds = new Map<Statement, number>()

	const scopeAt = (location: number, section: number, final: boolean, length?: number): Scope => ({
		symbol: name => symbols.get(name.toUpperCase()),
		location: { value: location, section, length }, final,
	})
	const define = (statement: Statement, name: string, value: number, section: number, length: number) => {
		const key = name.toUpperCase()
		if (!SYMBOL.test(name) || SYMBOL.exec(name)![0] !== name || name.length > 63) throw new AssemblyError(`Invalid symbol ${name}`, 1)
		const existing = symbols.get(key)
		if (existing && !(existing.file === statement.file && existing.line === statement.line)) throw new AssemblyError(`Symbol ${name} is already defined at line ${existing.line}`, 1)
		symbols.set(key, { name, value, section, length, file: statement.file, line: statement.line })
	}
	const align = (value: number, alignment: number) => Math.ceil(value / alignment) * alignment
	const advance = (bytes: number) => {
		current.location += bytes
		if (current.id === PROGRAM) programEnd = Math.max(programEnd, current.location)
	}
	const flushLiterals = (statement: Statement) => {
		const literals = pending
		pending = []
		if (!literals.length) return
		current.location = align(current.location, 8)
		for (const alignment of [8, 4, 2, 1]) for (const literal of literals) {
			if (literal.alignment !== alignment) continue
			literal.address = current.location
			advance(literal.size)
		}
		pools.set(statement, { literals, statement })
	}
	const literalOf = (text: string): Literal => {
		const existing = pending.find(literal => literal.text === text)
		if (existing) return existing
		const scope = scopeAt(current.location, current.id, false)
		const { constant, end } = parseConstant(text, 1, scope, false)
		if (end !== text.length) throw new AssemblyError(`Unexpected ${text.slice(end)} after literal`)
		if (constant.duplication === 0) throw new AssemblyError('A literal cannot have a zero duplication factor')
		const literal = { text, constant, address: -1, size: constantSize(constant), alignment: constantAlignment(constant) }
		pending.push(literal)
		return literal
	}

	/* Pass one: locations, symbols and literal pools. */
	for (const statement of statements) {
		const { op, label } = statement
		try {
			if (IGNORED.has(op)) continue
			if (op === 'CSECT' || op === 'START') {
				const name = label.toUpperCase()
				const existing = sections.get(name)
				if (existing && existing.id === PROGRAM) { current = program; current.location = existing.location; continue }
				if (op === 'START' && statement.operands) {
					const origin = absolute(evaluate(statement.operands, scopeAt(0, ABSOLUTE, false)), 'START origin')
					if (origin) programEnd = Math.max(programEnd, origin)
				}
				program = current = { name, id: PROGRAM, location: align(programEnd, 8) }
				if (label) { sections.set(name, current); define(statement, label, current.location, PROGRAM, 1) }
				continue
			}
			if (op === 'DSECT') {
				if (!label) throw new AssemblyError('DSECT needs a name', 1)
				const existing = sections.get(label.toUpperCase())
				if (existing) { current = existing; continue }
				current = { name: label.toUpperCase(), id: nextDsect++, location: 0 }
				sections.set(current.name, current)
				define(statement, label, 0, current.id, 1)
				continue
			}
			statementLocation.set(statement, current.location)
			statementSection.set(statement, current.id)
			if (op === 'EQU') {
				const parts = splitOperands(statement.operands)
				if (!label) throw new AssemblyError('EQU needs a name', 1)
				try {
					const value = evaluate(parts[0]?.text ?? '', scopeAt(current.location, current.id, false))
					const length = parts[1] ? absolute(evaluate(parts[1].text, scopeAt(current.location, current.id, false)), 'EQU length') : value.length ?? 1
					define(statement, label, value.value, value.section, length)
				} catch (error) {
					if (!(error instanceof Undefined)) throw error
					deferred.push({ statement, key: label.toUpperCase() })
				}
				continue
			}
			if (op === 'USING' || op === 'DROP') continue
			if (op === 'ORG') {
				if (!statement.operands) { current.location = current.id === PROGRAM ? programEnd : current.location; continue }
				const target = evaluate(statement.operands, scopeAt(current.location, current.id, false))
				if (target.section !== current.id) throw new AssemblyError('ORG must name a location in the current section', statement.operandColumn)
				current.location = target.value
				if (label) define(statement, label, current.location, current.id, 1)
				continue
			}
			if (op === 'LTORG') {
				flushLiterals(statement)
				if (label) define(statement, label, pools.get(statement)?.literals[0]?.address ?? current.location, current.id, 1)
				continue
			}
			if (op === 'CNOP') {
				const [byte, word] = splitOperands(statement.operands).map(part => absolute(evaluate(part.text, scopeAt(current.location, current.id, false)), 'CNOP operand'))
				if (![4, 8].includes(word) || byte % 2 || byte < 0 || byte >= word) throw new AssemblyError('CNOP needs an even byte offset within a 4 or 8 byte boundary', statement.operandColumn)
				current.location = align(current.location, 2)
				while (current.location % word !== byte) advance(2)
				cnopEnds.set(statement, current.location)
				if (label) define(statement, label, current.location, current.id, 1)
				continue
			}
			if (op === 'END') {
				flushLiterals(statement)
				if (statement.operands) entryText = { statement, text: statement.operands }
				break
			}
			if (op === 'DC' || op === 'DS') {
				const scope = scopeAt(current.location, current.id, false)
				const constants: Constant[] = []
				for (let i = 0; i < statement.operands.length;) {
					const { constant, end } = parseConstant(statement.operands, i, scope, op === 'DS')
					constants.push(constant)
					i = end
					if (i < statement.operands.length && statement.operands[i++] !== ',') throw new AssemblyError(`Unexpected ${statement.operands.slice(i - 1)}`, statement.operandColumn + i - 1)
				}
				if (!constants.length) throw new AssemblyError(`${op} needs an operand`, statement.operandColumn)
				current.location = align(current.location, constantAlignment(constants[0]))
				statementLocation.set(statement, current.location)
				if (label) define(statement, label, current.location, current.id, constants[0].lengths[0])
				for (const [index, constant] of constants.entries()) {
					if (index) current.location = align(current.location, constantAlignment(constant))
					advance(constantSize(constant))
				}
				continue
			}
			const opcode = opcodes.get(op)
			if (!opcode) throw new AssemblyError(op ? `Unknown operation ${op}` : 'Missing operation', statement.opColumn)
			current.location = align(current.location, 2)
			statementLocation.set(statement, current.location)
			const size = lengthOf(opcode.op)
			if (label) define(statement, label, current.location, current.id, size)
			const sites: Literal[] = []
			for (const part of splitOperands(statement.operands)) {
				if (!part.text.startsWith('=')) continue
				sites.push(literalOf(part.text.slice(0, literalEnd(part.text))))
			}
			literalSites.set(statement, sites)
			advance(size)
		} catch (error) {
			if (error instanceof Undefined) report(statement, new AssemblyError(`${error.message}: this symbol must be defined before it is used here`), statement.operandColumn)
			else report(statement, error, statement.operandColumn)
		}
	}
	if (pending.length) {
		const last = statements[statements.length - 1]
		const pool: Statement = { ...last, label: '', op: 'LTORG', operands: '' }
		statementLocation.set(pool, current.location)
		statementSection.set(pool, current.id)
		flushLiterals(pool)
		statements.push(pool)
	}

	// EQUs naming later symbols.
	for (let progress = true; progress && deferred.length;) {
		progress = false
		for (const item of [...deferred]) {
			const { statement } = item
			try {
				const parts = splitOperands(statement.operands)
				const scope = scopeAt(statementLocation.get(statement)!, statementSection.get(statement)!, false)
				const value = evaluate(parts[0].text, scope)
				define(statement, statement.label, value.value, value.section, parts[1] ? absolute(evaluate(parts[1].text, scope), 'EQU length') : value.length ?? 1)
				deferred.splice(deferred.indexOf(item), 1)
				progress = true
			} catch (error) {
				if (!(error instanceof Undefined)) { report(statement, error, statement.operandColumn); deferred.splice(deferred.indexOf(item), 1) }
			}
		}
	}
	for (const { statement } of deferred) {
		try { evaluate(splitOperands(statement.operands)[0].text, scopeAt(0, PROGRAM, true)) } catch (error) { report(statement, error, statement.operandColumn) }
	}

	/* Pass two: encode with the USING table in source order. */
	const emitter = new ByteEmitter()
	let usings: Using[] = []
	const provenance = (statement: Statement, kind: 'instruction' | 'data'): Provenance => ({ kind, source: { file: statement.file, line: statement.line, column: statement.opColumn } as SourceLocation, expansion: [] })
	const emitConstant = (constant: Constant, address: number, scope: (at: number) => Scope, into: number[]) => {
		let at = address
		for (let copy = 0; copy < constant.duplication; copy++) {
			constant.values.forEach((value, index) => {
				const bytes = constantBytes(constant.type, value, constant.lengths[index], scope(at))
				into.push(...bytes)
				at += bytes.length
			})
		}
	}
	for (const statement of statements) {
		const { op } = statement
		const location = statementLocation.get(statement)
		const section = statementSection.get(statement) ?? PROGRAM
		if (location === undefined) continue
		const scope = (length?: number) => scopeAt(location, section, true, length)
		try {
			if (op === 'USING') {
				const parts = splitOperands(statement.operands)
				if (parts.length < 2) throw new AssemblyError('USING needs a base address and a register', statement.operandColumn)
				const base = evaluate(parts[0].text, scope())
				parts.slice(1).forEach((part, index) => {
					const register = absolute(evaluate(part.text, scope()), 'USING register')
					if (register < 1 || register > 15) throw new AssemblyError('USING registers are 1 through 15', statement.operandColumn + part.offset)
					usings = usings.filter(using => using.register !== register)
					usings.push({ base: { value: base.value + 4096 * index, section: base.section }, register })
				})
				continue
			}
			if (op === 'DROP') {
				if (!statement.operands) { usings = []; continue }
				for (const part of splitOperands(statement.operands)) {
					const register = absolute(evaluate(part.text, scope()), 'DROP register')
					if (!usings.some(using => using.register === register)) diagnostics.push({ severity: 'warning', message: `Register ${register} is not in use`, file: statement.file, line: statement.line, column: statement.operandColumn + part.offset })
					usings = usings.filter(using => using.register !== register)
				}
				continue
			}
			const pool = pools.get(statement)
			if (pool && section === PROGRAM) {
				for (const literal of pool.literals) {
					const bytes: number[] = []
					emitConstant(literal.constant, literal.address, at => scopeAt(at, PROGRAM, true), bytes)
					emitter.emitBytes(literal.address, bytes, provenance(statement, 'data'))
				}
				continue
			}
			if (op === 'END') break
			if (op === 'CNOP' && section === PROGRAM) {
				const end = cnopEnds.get(statement) ?? location
				const fill: number[] = []
				for (let at = align(location, 2); at < end; at += 2) fill.push(0x07, 0x00)
				if (fill.length) emitter.emitBytes(align(location, 2), fill, provenance(statement, 'instruction'))
				continue
			}
			if (op === 'DC') {
				if (section !== PROGRAM) continue
				const bytes: number[] = []
				let at = location
				for (let i = 0; i < statement.operands.length;) {
					const { constant, end } = parseConstant(statement.operands, i, scope(), false)
					const aligned = bytes.length ? align(at, constantAlignment(constant)) : at
					for (; at < aligned; at++) bytes.push(0)
					const before = bytes.length
					emitConstant(constant, at, address => scopeAt(address, PROGRAM, true), bytes)
					at += bytes.length - before
					i = end + 1
				}
				emitter.emitBytes(location, bytes, provenance(statement, 'data'))
				continue
			}
			const opcode = opcodes.get(op)
			if (!opcode) continue
			if (!hasFeatures(options.model, opcode.requires)) throw new AssemblyError(`${op} requires ${requirementText(opcode.requires & ~options.model.features)}, which ${options.modelName} does not have`, statement.opColumn)
			const literals = literalSites.get(statement) ?? []
			const bytes = encodeOperands(opcode, splitOperands(statement.operands), {
				evaluate: (text: string) => {
					if (text.startsWith('=')) {
						const literal = literals.find(candidate => candidate.text === text)
						if (!literal || literal.address < 0) throw new AssemblyError(`Literal ${text} has no pool`)
						return { value: literal.address, section: PROGRAM, length: literal.constant.lengths[0] }
					}
					return evaluate(text, scope(lengthOf(opcode.op)))
				},
				base: value => resolveBase(value, usings),
			}, statement.operandColumn)
			if (section === PROGRAM) emitter.emitBytes(location, bytes, provenance(statement, 'instruction'))
		} catch (error) {
			report(statement, error, statement.operandColumn)
		}
	}
	const { sections: imageSections, overlap } = emitter.sections(true)
	if (overlap !== null) diagnostics.push({ severity: 'error', message: `ORG overlaps code or data at ${overlap.toString(16).toUpperCase()}` })
	let entryAddress = options.origin
	if (entryText) {
		try {
			const value = evaluate(entryText.text, scopeAt(0, PROGRAM, true))
			if (value.section !== PROGRAM && value.section !== ABSOLUTE) throw new AssemblyError('END must name a program location')
			entryAddress = value.value
		} catch (error) { report(entryText.statement, error, entryText.statement.operandColumn) }
	}
	if (diagnostics.some(d => d.severity === 'error')) return { image: null, diagnostics }
	return {
		image: {
			sections: imageSections, entryAddress,
			symbols: [...symbols.values()].filter(symbol => symbol.section <= PROGRAM).map(symbol => ({ name: symbol.name, address: symbol.value >>> 0 })),
			sourceMappings: emitter.sourceMappings(),
		},
		diagnostics,
	}
}

/** The using with the smallest displacement; on a tie the highest register (GC26-4037, "USING"). */
function resolveBase(value: Value, usings: readonly Using[]): { base: number, displacement: number } {
	if (value.section === ABSOLUTE && value.value >= 0 && value.value <= 4095) return { base: 0, displacement: value.value }
	let best: { base: number, displacement: number } | null = null
	for (const using of usings) {
		if (using.base.section !== value.section) continue
		const displacement = value.value - using.base.value
		if (displacement < 0 || displacement > 4095) continue
		if (!best || displacement < best.displacement || (displacement === best.displacement && using.register > best.base)) best = { base: using.register, displacement }
	}
	if (!best) throw new AssemblyError(value.section === ABSOLUTE ? `Displacement ${value.value} is outside 0-4095 and no USING covers it` : 'No active USING for operand')
	return best
}

interface Operands {
	evaluate(text: string): Value
	base(value: Value): { base: number, displacement: number }
}

/** Index after the constant of a literal such as =F'5', =CL8'X' or =A(NAME). */
function literalEnd(text: string): number {
	let i = 1
	if (text[i] === '(') i = matchParen(text, i) + 1
	else while (/\d/.test(text[i] ?? '')) i++
	i++
	if (/[Ll]/.test(text[i] ?? '')) {
		i++
		if (text[i] === '(') i = matchParen(text, i) + 1
		else while (/\d/.test(text[i] ?? '')) i++
	}
	if (text[i] === "'") return quoteEnd(text, i)
	if (text[i] === '(') return matchParen(text, i) + 1
	return i
}

/** Split `expr(a,b)` into the expression and its trailing parenthesized fields. */
function addressParts(text: string): { expression: string, fields: string[] | null } {
	const split = (open: number) => open <= 0 ? { expression: text, fields: null } : { expression: text.slice(0, open), fields: text.slice(open + 1, -1).split(',') }
	if (text.startsWith('=')) {
		const end = literalEnd(text)
		return end >= text.length ? { expression: text, fields: null } : text[end] === '(' && text.endsWith(')') ? split(end) : { expression: text, fields: null }
	}
	if (!text.endsWith(')')) return { expression: text, fields: null }
	let depth = 0, open = -1
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "'" && !isAttribute(text, i)) { i = quoteEnd(text, i) - 1; continue }
		if (text[i] === '(') { if (depth++ === 0) open = i }
		else if (text[i] === ')') depth--
	}
	return split(open)
}

function register(operands: Operands, text: string | undefined, what = 'Register'): number {
	if (text === undefined || text.trim() === '') throw new AssemblyError(`${what} operand is missing`)
	const value = absolute(operands.evaluate(text), what)
	if (value < 0 || value > 15) throw new AssemblyError(`${what} ${value} is outside 0-15`)
	return value
}
function immediate(operands: Operands, text: string | undefined, limit: number, what: string): number {
	if (text === undefined || text.trim() === '') throw new AssemblyError(`${what} operand is missing`)
	const value = absolute(operands.evaluate(text), what)
	if (value < 0 || value > limit) throw new AssemblyError(`${what} ${value} is outside 0-${limit}`)
	return value
}

/** Base and displacement of a storage operand, with an optional index and length field. */
function storageOperand(operands: Operands, text: string | undefined, form: 'index' | 'base' | 'length'): { base: number, displacement: number, index: number, length: number | null, implied: number } {
	if (text === undefined || text === '') throw new AssemblyError('Storage operand is missing')
	const { expression, fields } = addressParts(text)
	const value = operands.evaluate(expression)
	const implied = value.length ?? 1
	if (!fields) return { ...operands.base(value), index: 0, length: null, implied }
	if (form === 'index') {
		if (fields.length > 2) throw new AssemblyError(`Too many fields in ${text}`)
		const index = fields[0].trim() ? register(operands, fields[0], 'Index register') : 0
		if (fields.length === 2) {
			const base = fields[1].trim() ? register(operands, fields[1], 'Base register') : 0
			return { base, displacement: displacement(value), index, length: null, implied }
		}
		return value.section === ABSOLUTE ? { base: 0, displacement: displacement(value), index, length: null, implied } : { ...operands.base(value), index, length: null, implied }
	}
	if (form === 'base') {
		if (fields.length !== 1) throw new AssemblyError(`${text} takes a base register only`)
		return { base: register(operands, fields[0], 'Base register'), displacement: displacement(value), index: 0, length: null, implied }
	}
	if (fields.length > 2) throw new AssemblyError(`Too many fields in ${text}`)
	const length = absolute(operands.evaluate(fields[0]), 'Length')
	if (fields.length === 2) return { base: register(operands, fields[1], 'Base register'), displacement: displacement(value), index: 0, length, implied }
	return value.section === ABSOLUTE ? { base: 0, displacement: displacement(value), index: 0, length, implied } : { ...operands.base(value), index: 0, length, implied }
}
function displacement(value: Value): number {
	const d = absolute(value, 'Displacement with an explicit base')
	if (d < 0 || d > 4095) throw new AssemblyError(`Displacement ${d} is outside 0-4095`)
	return d
}

/** Machine instruction bytes; exported for the configured encoder and tests. */
export function encodeOperands(opcode: Opcode, parts: readonly { text: string, offset: number }[], operands: Operands, column = 0): number[] {
	const texts = parts.map(part => part.text)
	const at = (index: number, run: () => number[]): number[] => {
		try { return run() } catch (error) {
			if (error instanceof AssemblyError && error.column === undefined && parts[index]) throw new AssemblyError(error.message, column + parts[index].offset)
			throw error
		}
	}
	const count = (min: number, max = min) => {
		if (texts.length < min || texts.length > max) throw new AssemblyError(`${opcode.name} takes ${min === max ? min : `${min} to ${max}`} operand${max === 1 ? '' : 's'}`, column)
	}
	const op = opcode.op
	const rx = (r1: number, text: string, index: number) => at(index, () => {
		const s = storageOperand(operands, text, 'index')
		return [op, r1 << 4 | s.index, s.base << 4 | s.displacement >> 8, s.displacement & 255]
	})
	const rs = (r1: number, r3: number, text: string, index: number) => at(index, () => {
		const s = storageOperand(operands, text, 'base')
		return [op, r1 << 4 | r3, s.base << 4 | s.displacement >> 8, s.displacement & 255]
	})
	const lengthField = (s: ReturnType<typeof storageOperand>, limit: number) => {
		const length = s.length ?? s.implied
		if (length < (s.length === null ? 1 : 0) || length > limit) throw new AssemblyError(`Length ${length} is outside 1-${limit}`)
		return Math.max(0, length - 1)
	}
	const bd = (s: { base: number, displacement: number }) => [s.base << 4 | s.displacement >> 8, s.displacement & 255]
	switch (opcode.shape) {
		case RR: count(2); return [op, at(0, () => [register(operands, texts[0])])[0] << 4 | at(1, () => [register(operands, texts[1])])[0]]
		case RR1: count(1); return [op, at(0, () => [register(operands, texts[0])])[0] << 4]
		case RRI: count(1); return [op, at(0, () => [immediate(operands, texts[0], 255, 'SVC number')])[0]]
		case RRX: count(1); return [op, opcode.mask! << 4 | at(0, () => [register(operands, texts[0])])[0]]
		case RX: count(2); return rx(at(0, () => [register(operands, texts[0])])[0], texts[1], 1)
		case RXX: count(1); return rx(opcode.mask!, texts[0], 0)
		case RS: count(3); return rs(at(0, () => [register(operands, texts[0])])[0], at(1, () => [register(operands, texts[1], op >= 0xbd ? 'Mask' : 'Register')])[0], texts[2], 2)
		case RSH: count(2); return rs(at(0, () => [register(operands, texts[0])])[0], 0, texts[1], 1)
		case SI: case SI1: {
			count(opcode.shape === SI ? 2 : 1)
			const value = opcode.shape === SI ? at(1, () => [immediate(operands, texts[1], 255, 'Immediate byte')])[0] : 0
			const s = at(0, () => bd(storageOperand(operands, texts[0], 'base')))
			return [op, value, ...s]
		}
		case SSL: {
			count(2)
			const first = storageOperand(operands, texts[0], 'length')
			const length = at(0, () => [lengthField(first, 256)])[0]
			const second = at(1, () => bd(storageOperand(operands, texts[1], 'base')))
			return [op, length, ...bd(first), ...second]
		}
		case SSLL: {
			count(2)
			const first = at(0, () => { const s = storageOperand(operands, texts[0], 'length'); return [lengthField(s, 16), ...bd(s)] })
			const second = at(1, () => { const s = storageOperand(operands, texts[1], 'length'); return [lengthField(s, 16), ...bd(s)] })
			return [op, first[0] << 4 | second[0], first[1], first[2], second[1], second[2]]
		}
		case SSRP: {
			count(3)
			const first = at(0, () => { const s = storageOperand(operands, texts[0], 'length'); return [lengthField(s, 16), ...bd(s)] })
			const second = at(1, () => bd(storageOperand(operands, texts[1], 'base')))
			const rounding = at(2, () => [immediate(operands, texts[2], 9, 'Rounding digit')])[0]
			return [op, first[0] << 4 | rounding, first[1], first[2], ...second]
		}
	}
	throw new AssemblyError(`Unsupported operand shape for ${opcode.name}`)
}

/** Absolute-operand encoder for callers outside a program, such as the configured encode hook. */
export function encodeAbsolute(mnemonic: string, operands: readonly string[], value: (text: string) => number): number[] {
	const opcode = opcodes.get(mnemonic.toUpperCase())
	if (!opcode) throw new Error(`Unknown operation ${mnemonic}`)
	let offset = 0
	const parts = operands.map(text => { const part = { text, offset }; offset += text.length + 1; return part })
	return encodeOperands(opcode, parts, {
		evaluate: text => evaluate(text, { symbol: name => ({ name, value: value(name), section: ABSOLUTE, length: 1, file: '', line: 0 }), location: { value: 0, section: ABSOLUTE }, final: true }),
		base: v => resolveBase(v, []),
	})
}
