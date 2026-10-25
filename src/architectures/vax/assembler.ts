/**
 * VAX MACRO statements over the shared two-pass engine.  Layout sizes each
 * instruction from what it knows, so a backward reference takes the shortest
 * literal or displacement and a forward one the longword form; emission keeps
 * layout's choice.
 */
import { assembleStatements, defaultLimits, StatementKind as S, type HookContext, type Statement } from '../../core/assembly/assembler'
import { expressionParser } from '../../core/assembly/frontend'
import { integerArithmetic } from '../../core/assembly/integerArithmetic'
import { Op, type Expr } from '../../core/assembly/expressions'
import { visitSourceLines } from '../../core/assembly/sourceLines'
import { splitOperands, stripAssemblyComment } from '../../core/assembly/text'
import type { Position } from '../../core/assembly/tokens'
import { decimalToDec, type DecFormat } from '../../core/decFloat'
import { AssemblyError } from '../../core/diagnostics'
import type { AssemblySources, Diagnostic } from '../contracts'
import type { AssemblyImage } from '../../core/assembly/emitter'
import { ADDRESS, BRANCH, F, FIELD, MODIFY, opcodeOf, PC, TYPE_BYTES, WRITE } from './isa'
import { fromInteger, formatOf, imageOf, literalFor } from './float'

export const TEXT_BASE = 0x1000, DATA_BASE = 0x10000, MEMORY_BYTES = 0x100000

/* ------------------------------------------------------------ expressions */

const parse = expressionParser({
	syntax: {
		binary: new Map([['!', { op: Op.Or, precedence: 1 }], ['\\', { op: Op.Xor, precedence: 2 }], ['&', { op: Op.And, precedence: 3 }], ['+', { op: Op.Add, precedence: 5 }], ['-', { op: Op.Sub, precedence: 5 }], ['*', { op: Op.Mul, precedence: 6 }], ['/', { op: Op.Div, precedence: 6 }]]),
		unary: new Map([['-', Op.Neg], ['+', Op.Plus], ['~', Op.Not]]),
		dot: '.',
	},
	tokens: /\s+|0x[\da-f]+|0b[01]+|\d+|[A-Za-z_.$][\w.$]*|./gi,
	isNumber: part => /^\d/.test(part),
	number: part => Number(part),
})

/** Register names in operands: R0-R15, AP, FP, SP and PC. */
export function registerNumber(text: string): number | null {
	const name = text.trim().toUpperCase()
	const m = /^R(\d{1,2})$/.exec(name)
	if (m && Number(m[1]) < 16) return Number(m[1])
	const index = ['AP', 'FP', 'SP', 'PC'].indexOf(name)
	return index < 0 ? null : 12 + index
}

/** `^M<R2,R3>` names the registers an entry mask or PUSHR saves. */
function registerMask(list: string): number {
	let mask = 0
	for (const name of list.split(',').map(part => part.trim()).filter(Boolean)) {
		const n = registerNumber(name)
		if (n === null || n > 14) throw new Error(`^M names registers R0 through SP, not ${name}`)
		mask |= 1 << n
	}
	return mask
}

/** Radix and mask operators become plain numbers; angle brackets group. */
export function normalizeExpression(text: string): string {
	return text
		.replace(/\^M\s*<([^>]*)>/gi, (_, list: string) => String(registerMask(list)))
		.replace(/\^A(.)(.)\1/gi, (_, _delimiter, character: string) => String(character.charCodeAt(0)))
		.replace(/\^X\s*([\da-f]+)/gi, (_, digits: string) => String(parseInt(digits, 16)))
		.replace(/\^O\s*([0-7]+)/gi, (_, digits: string) => String(parseInt(digits, 8)))
		.replace(/\^B\s*([01]+)/gi, (_, digits: string) => String(parseInt(digits, 2)))
		.replace(/\^D\s*(\d+)/gi, '$1')
		.replace(/\^C/gi, '~')
		.replace(/</g, '(').replace(/>/g, ')')
}

/* --------------------------------------------------------------- operands */

const OPERAND_REGISTER = '(R\\d{1,2}|AP|FP|SP|PC)'
interface Operand {
	kind: 'register' | 'immediate' | 'deferred' | 'autoinc' | 'autodec' | 'displacement' | 'relative' | 'absolute'
	register: number
	expression: string
	/** 1, 2 or 4 when B^, W^ or L^ chose a width; 0 for S^ and 5 for I^. */
	forced?: number
	deferred: boolean
	index?: number
}

function register(text: string): number {
	const n = registerNumber(text)
	if (n === null) throw new Error(`Expected a register, got ${text}`)
	return n
}

export function parseOperand(source: string): Operand {
	let text = source.trim(), index: number | undefined
	const indexed = new RegExp(`^(.*)\\[\\s*${OPERAND_REGISTER}\\s*\\]$`, 'i').exec(text)
	if (indexed) { text = indexed[1].trim(); index = register(indexed[2]) }
	const immediate = /^([SI])\^\s*#(.*)$/i.exec(text) ?? /^()#(.*)$/.exec(text)
	if (immediate) return { kind: 'immediate', register: PC, expression: immediate[2].trim(), forced: immediate[1] ? immediate[1].toUpperCase() === 'S' ? 0 : 5 : undefined, deferred: false, index }
	if (/^@#/.test(text)) return { kind: 'absolute', register: PC, expression: text.slice(2).trim(), deferred: true, index }
	const deferred = text.startsWith('@')
	if (deferred) text = text.slice(1).trim()
	const n = registerNumber(text)
	if (n !== null) return deferred ? { kind: 'deferred', register: n, expression: '', deferred: false, index } : { kind: 'register', register: n, expression: '', deferred: false, index }
	let m = new RegExp(`^-\\(\\s*${OPERAND_REGISTER}\\s*\\)$`, 'i').exec(text)
	if (m) { if (deferred) throw new Error('Autodecrement has no deferred form'); return { kind: 'autodec', register: register(m[1]), expression: '', deferred: false, index } }
	m = new RegExp(`^\\(\\s*${OPERAND_REGISTER}\\s*\\)\\+$`, 'i').exec(text)
	if (m) return { kind: 'autoinc', register: register(m[1]), expression: '', deferred, index }
	m = new RegExp(`^\\(\\s*${OPERAND_REGISTER}\\s*\\)$`, 'i').exec(text)
	// @(Rn) is @B^0(Rn): register deferred has no further level of indirection.
	if (m) return deferred ? { kind: 'displacement', register: register(m[1]), expression: '0', forced: 1, deferred, index } : { kind: 'deferred', register: register(m[1]), expression: '', deferred: false, index }
	const width = /^([BWL])\^\s*(.*)$/i.exec(text)
	const forced = width ? ({ B: 1, W: 2, L: 4 } as Record<string, number>)[width[1].toUpperCase()] : undefined
	if (width) text = width[2].trim()
	m = new RegExp(`^(.+?)\\(\\s*${OPERAND_REGISTER}\\s*\\)$`, 'i').exec(text)
	if (m) return { kind: 'displacement', register: register(m[2]), expression: m[1].trim(), forced, deferred, index }
	if (!text) throw new Error(`Missing operand in '${source}'`)
	return { kind: 'relative', register: PC, expression: text, forced, deferred, index }
}

/* --------------------------------------------------------------- encoding */

/** Evaluates an operand expression; undefined while a forward reference is unknown. */
export type Evaluate = (text: string) => number | undefined

const FLOAT_TEXT = /^[+-]?(?:\d+\.\d*|\.\d+|\d+(?:\.\d*)?E[+-]?\d+)$/i
const little = (value: bigint, bytes: number) => Array.from({ length: bytes }, (_, i) => Number(value >> BigInt(8 * i) & 255n))
const fitsSigned = (value: number, bytes: number) => value >= -(2 ** (bytes * 8 - 1)) && value < 2 ** (bytes * 8 - 1)

/** A floating operand's image: decimal text exactly, an integer expression converted. */
function floatImage(text: string, format: DecFormat, evaluate: Evaluate): bigint | undefined {
	const trimmed = text.replace(/^\^F/i, '').trim()
	if (FLOAT_TEXT.test(trimmed)) {
		const packed = decimalToDec(trimmed, format)
		if (!packed || packed.overflow) throw new Error(`${text} cannot be represented in this floating format`)
		return packed.image
	}
	const value = evaluate(text)
	return value === undefined ? undefined : imageOf(fromInteger(BigInt(value), format))
}

/**
 * Bytes of one instruction.  `plan` records the form each operand took so
 * emission repeats layout's choice exactly; pass it back to reuse it.
 */
export function encodeInstruction(mnemonic: string, args: readonly string[], address: number, evaluate: Evaluate, plan: number[] = []): { bytes: number[], plan: number[] } {
	const entry = opcodeOf(mnemonic)
	if (!entry) throw new Error(`Unknown VAX instruction ${mnemonic}`)
	if (args.length !== entry.operands.length) throw new Error(`${entry.name} expects ${entry.operands.length} operand${entry.operands.length === 1 ? '' : 's'}`)
	const bytes: number[] = entry.code > 255 ? [0xfd, entry.code & 255] : [entry.code]
	const replay = plan.length > 0
	entry.operands.forEach(([access, type], i) => {
		const size = TYPE_BYTES[type]
		if (access === BRANCH) {
			const width = size === 1 ? 1 : 2, target = evaluate(args[i])
			const displacement = target === undefined ? 0 : target - (address + bytes.length + width)
			if (target !== undefined && !fitsSigned(displacement, width)) throw new Error(`Branch destination is ${displacement} bytes away, outside the ${width === 1 ? 'byte' : 'word'} displacement of ${entry.name}`)
			bytes.push(...little(BigInt(displacement), width))
			return
		}
		const operand = parseOperand(args[i])
		if (operand.index !== undefined) {
			if (operand.index === PC) throw new Error('PC cannot be an index register')
			if (operand.kind === 'register' || operand.kind === 'immediate') throw new Error('Index mode needs a memory operand as its base')
			bytes.push(0x40 | operand.index)
		}
		const n = operand.register, choose = (form: number) => { if (!replay) plan[i] = form; return plan[i] }
		const writes = access === WRITE || access === MODIFY
		switch (operand.kind) {
			case 'register':
				if (access === ADDRESS) throw new Error(`${entry.name} needs an address, not register ${args[i]}`)
				if (n === PC || n + Math.max(1, size / 4) - 1 >= PC) throw new Error(`${args[i]} cannot hold a ${size}-byte operand`)
				bytes.push(0x50 | n)
				return
			case 'immediate': {
				if (writes || access === FIELD) throw new Error(`${entry.name} cannot write to immediate ${args[i]}`)
				const floating = type >= F
				if (!floating && FLOAT_TEXT.test(operand.expression)) throw new Error(`${entry.name} takes an integer operand, not ${operand.expression}`)
				const image = floating ? floatImage(operand.expression, formatOf(type), evaluate) : undefined
				const value = floating ? undefined : evaluate(operand.expression)
				const literal = floating ? image === undefined ? null : literalFor(image, formatOf(type)) : value !== undefined && Number.isInteger(value) && value >= 0 && value < 64 ? value : null
				if (operand.forced === 0 && literal === null && (floating ? image : value) !== undefined) throw new Error(`S^#${operand.expression} does not fit a six-bit short literal`)
				const form = choose(operand.forced === 5 || access === ADDRESS ? 5 : operand.forced === 0 ? 0 : literal === null ? 5 : 0)
				if (form === 0) { bytes.push(literal ?? 0); return }
				bytes.push(0x8f)
				if (floating) bytes.push(...little(image ?? 0n, size))
				else {
					const v = value ?? 0
					if (!Number.isSafeInteger(v) || size <= 4 && (v < -(2 ** (size * 8 - 1)) || v >= 2 ** (size * 8))) throw new Error(`Immediate ${operand.expression} exceeds ${size * 8} bits`)
					bytes.push(...little(BigInt.asUintN(size * 8, BigInt(v)), size))
				}
				return
			}
			case 'deferred': if (n === PC) throw new Error('(PC) is a reserved addressing mode'); bytes.push(0x60 | n); return
			case 'autodec': if (n === PC) throw new Error('-(PC) is a reserved addressing mode'); bytes.push(0x70 | n); return
			case 'autoinc': if (n === PC) throw new Error('Use # for an immediate rather than (PC)+'); bytes.push((operand.deferred ? 0x90 : 0x80) | n); return
			case 'absolute': bytes.push(0x9f, ...little(BigInt.asUintN(32, BigInt(evaluate(operand.expression) ?? 0)), 4)); return
			case 'displacement': case 'relative': {
				const value = evaluate(operand.expression), relative = operand.kind === 'relative'
				const displacement = (width: number) => value === undefined ? undefined : relative ? value - (address + bytes.length + 1 + width) : value
				const shortest = [1, 2, 4].find(width => { const d = displacement(width); return d !== undefined && fitsSigned(d, width) }) ?? 4
				const width = choose(operand.forced ?? shortest), d = displacement(width) ?? 0
				if (!fitsSigned(d, width)) throw new Error(`Displacement ${d} does not fit ${['', 'a byte', 'a word', '', 'a longword'][width]}`)
				bytes.push(({ 1: 0xa0, 2: 0xc0, 4: 0xe0 } as Record<number, number>)[width] | (operand.deferred ? 0x10 : 0) | n, ...little(BigInt.asUintN(width * 8, BigInt(d)), width))
				return
			}
		}
	})
	return { bytes, plan }
}

/* ---------------------------------------------------------- the frontend */

const FLOAT_DIRECTIVES: Record<string, number> = { '.f_floating': F, '.float': F, '.d_floating': F + 1, '.double': F + 1, '.g_floating': F + 2, '.h_floating': F + 3 }
const DATA_DIRECTIVES: Record<string, number> = { '.byte': 1, '.word': 2, '.long': 4, '.address': 4 }
const BLOCK_DIRECTIVES: Record<string, number> = { '.blkb': 1, '.blkw': 2, '.blkl': 4, '.blka': 4, '.blkf': 4, '.blkq': 8, '.blkd': 8, '.blkg': 8, '.blko': 16, '.blkh': 16 }
const ALIGNMENTS: Record<string, number> = { byte: 0, word: 1, long: 2, quad: 3, octa: 4, page: 9 }
const IGNORED = new Set(['.title', '.ident', '.sbttl', '.subtitle', '.list', '.nlist', '.enable', '.disable', '.show', '.noshow', '.page', '.external', '.extrn', '.globl', '.global', '.default', '.dsabl', '.enabl', '.restore_psect', '.save_psect'])

export interface VaxAssembly { image: AssemblyImage | null, diagnostics: Diagnostic[] }

/** `/text/` or `"text"` with any delimiter, and `<expression>` bytes between. */
function stringPieces(text: string): (string | { expression: string })[] {
	const pieces: (string | { expression: string })[] = []
	let at = 0
	while (at < text.length) {
		const char = text[at]
		if (/\s/.test(char)) { at++; continue }
		if (char === '<') {
			const close = text.indexOf('>', at)
			if (close < 0) throw new Error('Unclosed < in string directive')
			pieces.push({ expression: text.slice(at + 1, close) })
			at = close + 1
			continue
		}
		const close = text.indexOf(char, at + 1)
		if (close < 0) throw new Error(`Unclosed ${char} string delimiter`)
		pieces.push(text.slice(at + 1, close))
		at = close + 1
	}
	return pieces
}

export function assembleVax(sources: AssemblySources): VaxAssembly {
	const thunks: (() => Statement)[] = []
	const canonical = new Map<string, string>()
	const entries = new Set<string>()
	let transfer: { name: string, at: Position } | null = null, ended = false, block = 0
	const define = (name: string) => { if (!canonical.has(name.toLowerCase())) canonical.set(name.toLowerCase(), name); return name }
	// Symbols are case-insensitive; every spelling resolves to the first definition's.
	const expression = (text: string, at: Position): Expr => {
		const normal = normalizeExpression(text).replace(/[A-Za-z_$][\w.$]*/g, name => canonical.get(name.toLowerCase()) ?? name)
		return parse(normal, at)
	}
	const value = (context: HookContext, text: string, at: Position, strict: boolean) => context.value(expression(text, at), strict)
	const localLabels = (text: string) => text.replace(/(^|[^\w.$])(\d+)\$(?![\w.$])/g, (_, before: string, digits: string) => `${before}L$${block}$${digits}`)
	try {
		const entry = sources.entries[0] ?? sources.files[0]?.name ?? 'main.asm'
		visitSourceLines(sources.files, entry, { expansions: 4096, depth: 64, lines: 200_000 }, ({ text, at }) => {
			if (ended) return
			let line = stripAssemblyComment(text, [';']).trim()
			for (;;) {
				const label = /^(\d+\$|[A-Za-z_.$][\w.$]*)\s*::?/.exec(line)
				if (!label) break
				if (/^[A-Za-z_.$]/.test(label[1])) block++
				const name = define(/^\d/.test(label[1]) ? localLabels(label[1]) : label[1])
				thunks.push(() => ({ kind: S.Label, name: canonical.get(name.toLowerCase())!, at }))
				line = line.slice(label[0].length).trim()
			}
			if (!line) return
			const assign = /^([A-Za-z_.$][\w.$]*)\s*==?\s*(.+)$/.exec(line)
			if (assign) {
				const right = localLabels(assign[2])
				if (assign[1] === '.') thunks.push(() => ({ kind: S.Origin, value: expression(right, at), at }))
				else { const name = define(assign[1]); thunks.push(() => ({ kind: S.Assign, name: canonical.get(name.toLowerCase())!, value: expression(right, at), at })) }
				return
			}
			const parts = /^(\S+)\s*(.*)$/.exec(line)!, name = parts[1].toLowerCase(), rest = parts[2]
			if (['.ascii', '.asciz', '.ascic'].includes(name)) {
				const pieces = stringPieces(rest), encoder = new TextEncoder()
				const length = pieces.reduce((total, piece) => total + (typeof piece === 'string' ? encoder.encode(piece).length : 1), 0)
				if (name === '.ascic' && length > 255) throw new AssemblyError('.ASCIC strings hold at most 255 bytes', at)
				const size = length + (name === '.ascii' ? 0 : 1)
				thunks.push(() => ({ kind: S.Fragment, size, provenance: 'data', at, encode: context => {
					const bytes = pieces.flatMap(piece => typeof piece === 'string' ? [...encoder.encode(piece)] : [value(context, piece.expression, at, true)! & 255])
					return name === '.ascic' ? [length, ...bytes] : name === '.asciz' ? [...bytes, 0] : bytes
				} }))
				return
			}
			// ^A/c/ may quote a delimiter, so it becomes a number before operands split.
			const args = splitOperands(localLabels(rest.replace(/\^A(.)(.)\1/gi, (_, _delimiter, character: string) => String(character.charCodeAt(0)))), { brackets: ['()', '[]', '<>'], unclosed: 'Unclosed operand delimiter' })
			if (name === '.include') {
				if (args.length !== 1 || !/^".*"$/.test(args[0])) throw new AssemblyError('Include needs one quoted filename', at)
				return JSON.parse(args[0]) as string
			}
			if (name === '.end') { ended = true; if (args[0]) transfer = { name: args[0], at }; return }
			if (IGNORED.has(name)) return
			if (name === '.text' || name === '.data' || name === '.psect') {
				const data = name === '.data' || name === '.psect' && (/data/i.test(args[0] ?? '') || args.some(arg => /^noexe$/i.test(arg)))
				thunks.push(() => ({ kind: S.Section, section: data ? 1 : 0, at }))
				if (name !== '.psect' && args.length) thunks.push(() => ({ kind: S.Origin, value: expression(args[0], at), at }))
				return
			}
			if (name === '.org') { if (args.length !== 1) throw new AssemblyError('.ORG needs one address', at); thunks.push(() => ({ kind: S.Origin, value: expression(args[0], at), at })); return }
			if (name === '.equ' || name === '.set') {
				if (args.length !== 2) throw new AssemblyError('Equate needs a name and value', at)
				const symbol = define(args[0])
				thunks.push(() => ({ kind: S.Assign, name: canonical.get(symbol.toLowerCase())!, value: expression(args[1], at), at }))
				return
			}
			if (name === '.entry') {
				if (args.length < 1 || args.length > 2) throw new AssemblyError('.ENTRY needs a name and an optional register mask', at)
				block++
				const symbol = define(args[0]), mask = args[1] ?? '0'
				entries.add(symbol.toLowerCase())
				thunks.push(() => ({ kind: S.Label, name: canonical.get(symbol.toLowerCase())!, at }))
				thunks.push(() => ({ kind: S.Fragment, size: 2, provenance: 'data', at, encode: context => {
					const bits = value(context, mask, at, true)!
					if (bits & ~0xcfff) throw new AssemblyError('An entry mask saves R0-R11 and sets IV (bit 14) or DV (bit 15)', at)
					return [bits & 255, bits >> 8 & 255]
				} }))
				return
			}
			if (name === '.align') {
				const key = (args[0] ?? '').toLowerCase()
				// .ALIGN n aligns to 2^n bytes; keywords name a data type's size.
				thunks.push(() => ({ kind: S.Align, boundary: (key in ALIGNMENTS ? { kind: 0, value: 2 ** ALIGNMENTS[key] } : { kind: 4, op: Op.Shl, left: { kind: 0, value: 1 }, right: expression(args[0], at), at }) as Expr, at }))
				return
			}
			if (name in BLOCK_DIRECTIVES) {
				const unit = BLOCK_DIRECTIVES[name], count = args[0] ?? '1'
				thunks.push(() => ({ kind: S.Fragment, size: context => unit * value(context, count, at, true)!, provenance: 'data', at, encode: (_context, size) => {
					if (size < 0 || size > MEMORY_BYTES) throw new AssemblyError('Reservation exceeds memory', at)
					return new Uint8Array(size)
				} }))
				return
			}
			if (name in DATA_DIRECTIVES) {
				if (!args.length) throw new AssemblyError('Data directive needs values', at)
				const size = DATA_DIRECTIVES[name]
				for (const arg of args) thunks.push(() => ({ kind: S.Emit, size, value: expression(arg, at), at }))
				return
			}
			if (name === '.quad' || name === '.octa') {
				const size = name === '.quad' ? 8 : 16
				for (const arg of args) thunks.push(() => ({ kind: S.Fragment, size, provenance: 'data', at, encode: context => [...Array.from({ length: size }, (_, i) => Number(BigInt.asUintN(size * 8, BigInt(value(context, arg, at, true)!)) >> BigInt(8 * i) & 255n))] }))
				return
			}
			if (name in FLOAT_DIRECTIVES) {
				const format = formatOf(FLOAT_DIRECTIVES[name])
				for (const arg of args) {
					const packed = FLOAT_TEXT.test(arg.trim()) || /^[+-]?\d+$/.test(arg.trim()) ? decimalToDec(arg.trim(), format) : null
					if (!packed || packed.overflow) throw new AssemblyError(`${arg} is not a representable floating constant`, at)
					const bytes = Uint8Array.from({ length: format.bytes }, (_, i) => Number(packed.image >> BigInt(8 * i) & 255n))
					thunks.push(() => ({ kind: S.Bytes, bytes, at }))
				}
				return
			}
			if (name.startsWith('.')) throw new AssemblyError(`Unsupported directive ${parts[1]}`, at)
			if (!opcodeOf(name)) throw new AssemblyError(`Unknown VAX instruction ${parts[1]}`, at)
			let plan: number[] = []
			thunks.push(() => ({ kind: S.Fragment, provenance: 'instruction', at,
				size: context => { plan = []; return encodeInstruction(name, args, context.dot, text => value(context, text, at, false), plan).bytes.length },
				encode: context => encodeInstruction(name, args, context.dot, text => value(context, text, at, true), plan).bytes,
			}))
		})
		const statements: Statement[] = []
		for (const thunk of thunks) statements.push(thunk())
		const outcome = assembleStatements(statements, {
			arithmetic: integerArithmetic, littleEndian: true,
			checkValue: (v, size, at) => {
				if (!Number.isInteger(v) || v < -(2 ** (size * 8 - 1)) || v >= 2 ** (size * 8)) throw new AssemblyError(`Value exceeds ${size * 8} bits`, at)
				return v < 0 ? v + 2 ** (size * 8) : v
			},
			defaultAlignment: 1, originMayDecrease: true, entryAddress: TEXT_BASE, isInstructionMacro: () => false,
			limits: { ...defaultLimits, addressLimit: MEMORY_BYTES, maxBytes: MEMORY_BYTES },
			sections: [{ start: TEXT_BASE }, { start: DATA_BASE }],
		})
		if (!outcome.image) return outcome
		let entryAddress = outcome.image.sourceMappings.find(row => row.kind === 'instruction')?.address ?? TEXT_BASE
		const start = transfer as { name: string, at: Position } | null
		if (start) {
			const symbol = outcome.symbols.lookup(canonical.get(start.name.toLowerCase()) ?? start.name)
			if (symbol === undefined) return { image: null, diagnostics: [new AssemblyError(`.END names undefined symbol ${start.name}`, start.at).diagnostic] }
			// A procedure starts past its entry mask, as CALLS would enter it.
			entryAddress = symbol + (entries.has(start.name.toLowerCase()) ? 2 : 0)
		}
		return { diagnostics: outcome.diagnostics, image: { ...outcome.image, entryAddress,
			symbols: [...outcome.symbols.entries()].filter((entry): entry is [string, number] => entry[1] !== undefined).map(([name, address]) => ({ name, address })) } }
	} catch (error) {
		return { image: null, diagnostics: [error instanceof AssemblyError ? error.diagnostic : { severity: 'error' as const, message: error instanceof Error ? error.message : String(error) }] }
	}
}
