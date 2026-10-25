import type { CpuContext, CpuInstruction } from '../../core/configuredCpu'
import { decToNumber } from '../../core/decFloat'
import { arithmetic, compare, convert, floatLiteral, formatOf, fromInteger, imageOf, isNegative, isZero, negate, toInteger, VaxFault } from './float'

export const reference = 'https://bitsavers.org/pdf/dec/vax/archSpec/EY-3459E-DP_VAX_Architecture_Reference_Manual_1987.pdf'

/** Native register columns: R0-R14 (AP, FP, SP are R12-R14), then the PSL. PC is the shared one. */
export const AP = 12, FP = 13, SP = 14, PC = 15, PSL = 15
export const C = 1, V = 2, Z = 4, N = 8, T = 0x10, IV = 0x20, FU = 0x40, DV = 0x80
/** Kernel mode, interrupt stack clear, IPL 31: a console-booted program. */
export const RESET_PSL = 0x001f0000
/** Writable PSL bits; mode, IS and FPD are fixed in this kernel-only machine. */
export const PSL_WRITABLE = 0x401f00ff

/** Data types; floating types follow the integers. */
export const B = 0, W = 1, L = 2, Q = 3, O = 4, F = 5, D = 6, G = 7, H = 8
export const TYPE_BYTES = [1, 2, 4, 8, 16, 4, 8, 8, 16] as const
const TYPE_LETTERS = 'bwlqofdgh'
/** Operand access: read, write, modify, address, variable bit field base, branch displacement. */
export const READ = 0, WRITE = 1, MODIFY = 2, ADDRESS = 3, FIELD = 4, BRANCH = 5
const ACCESS_LETTERS = 'rwmavb'

/** CPU models; the decoder gates instructions each omits. */
export const VAX780 = 0, MICROVAX2 = 1, MICROVAX2_NO_FPU = 2
export type Model = typeof VAX780 | typeof MICROVAX2 | typeof MICROVAX2_NO_FPU
/** Instruction groups gated by model. */
const BASE = 0, FLOAT = 1, HFLOAT = 2

export const registerNames = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R11', 'AP', 'FP', 'SP', 'PC']

type Value = number | bigint
interface Operands {
	/** Read and modify values; ADDRESS operands give the address, BRANCH ones the target. */
	readonly v: Value[]
	readonly field: (FieldBase | undefined)[]
	put(index: number, value: Value): void
	/** First byte past the instruction, where a CASE table starts. */
	readonly end: number
}
type Handler = (c: CpuContext, o: Operands) => void
type Kind = NonNullable<CpuInstruction['kind']>
interface Opcode { name: string, code: number, operands: readonly (readonly [number, number])[], run: Handler, group: number, kind?: Kind, call?: boolean }

const opcodes: Opcode[] = []
export const byName = new Map<string, Opcode>()
const byCode = new Map<number, Opcode>()
function op(name: string, code: number, operands: string, run: Handler, extra: { group?: number, kind?: Kind, call?: boolean, aliases?: string[] } = {}) {
	const parsed = operands ? operands.split(' ').map(text => [ACCESS_LETTERS.indexOf(text[0]), TYPE_LETTERS.indexOf(text[1])] as const) : []
	const entry: Opcode = { name, code, operands: parsed, run, group: extra.group ?? BASE, kind: extra.kind, call: extra.call }
	opcodes.push(entry)
	for (const alias of [name, ...extra.aliases ?? []]) byName.set(alias, { ...entry, name: alias })
	if (byCode.has(code)) throw new Error(`Duplicate VAX opcode ${code.toString(16)}`)
	byCode.set(code, entry)
}

/* ------------------------------------------------------------- arithmetic */

const MASKS = [0xff, 0xffff, 0xffffffff]
const signed = (value: number, type: number) => type === B ? value << 24 >> 24 : type === W ? value << 16 >> 16 : value | 0
const unsigned = (value: number, type: number) => type === L ? value >>> 0 : value & MASKS[type]
const signBit = (value: number, type: number) => (value >>> (TYPE_BYTES[type] * 8 - 1) & 1) === 1
function setFlags(c: CpuContext, n: boolean, z: boolean, v: boolean, carry: boolean | null) {
	const old = c.r[PSL]
	c.r[PSL] = (old & ~(carry === null ? N | Z | V : N | Z | V | C) | (n ? N : 0) | (z ? Z : 0) | (v ? V : 0) | (carry ? C : 0)) >>> 0
	if (v && old & IV) throw new VaxFault('Integer overflow trap: PSW<IV> is set')
}
/** N and Z of an integer result; V cleared; C cleared or kept. */
const logical = (c: CpuContext, value: number, type: number, carry: boolean | null) => setFlags(c, signBit(value, type), unsigned(value, type) === 0, false, carry)
/** Leaves C unchanged. */
const KEEP = null

function add(c: CpuContext, a: number, b: number, carryIn: number, type: number): number {
	const ua = unsigned(a, type), ub = unsigned(b, type), total = ua + ub + carryIn, result = unsigned(total, type)
	setFlags(c, signBit(result, type), result === 0, signBit(ua, type) === signBit(ub, type) && signBit(result, type) !== signBit(ua, type), total > MASKS[type])
	return result
}
/** `a - b - borrow`; C is the borrow. */
function subtract(c: CpuContext, a: number, b: number, borrow: number, type: number): number {
	const ua = unsigned(a, type), ub = unsigned(b, type), result = unsigned(ua - ub - borrow, type)
	setFlags(c, signBit(result, type), result === 0, signBit(ua, type) !== signBit(ub, type) && signBit(result, type) !== signBit(ua, type), ua < ub + borrow)
	return result
}
function compareIntegers(c: CpuContext, a: number, b: number, type: number) {
	const sa = signed(a, type), sb = signed(b, type)
	setFlags(c, sa < sb, sa === sb, false, unsigned(a, type) < unsigned(b, type))
}
function fits(value: number | bigint, type: number) {
	const bits = BigInt(TYPE_BYTES[type] * 8), v = BigInt(value)
	return v >= -(1n << (bits - 1n)) && v < 1n << (bits - 1n)
}
const quadSigned = (value: Value) => BigInt.asIntN(64, BigInt(value))
function quadFlags(c: CpuContext, value: bigint, carry: boolean | null, bits = 64) {
	setFlags(c, BigInt.asIntN(bits, value) < 0n, BigInt.asUintN(bits, value) === 0n, false, carry)
}

/* ------------------------------------------------------------ bit fields */

/** Register mode names Rn (and Rn+1); otherwise a byte address. */
interface FieldBase { register?: number, address: number }
function fieldSize(size: number) { if (size > 32) throw new VaxFault('Reserved operand fault: bit field size exceeds 32'); return size }
function readField(c: CpuContext, base: FieldBase, position: number, size: number): number {
	fieldSize(size)
	if (!size) return 0
	if (base.register !== undefined) {
		if (position >>> 0 > 31) throw new VaxFault('Reserved operand fault: register bit field position exceeds 31')
		const pair = BigInt(c.r[base.register]) | (position + size > 32 ? BigInt(c.r[base.register + 1]) << 32n : 0n)
		return Number(pair >> BigInt(position) & (1n << BigInt(size)) - 1n)
	}
	const address = base.address + Math.floor((position | 0) / 8), shift = (position | 0) & 7, count = Math.ceil((shift + size) / 8)
	let bits = 0n
	for (let i = 0; i < count; i++) bits |= BigInt(c.read(address + i, 1)) << BigInt(8 * i)
	return Number(bits >> BigInt(shift) & (1n << BigInt(size)) - 1n)
}
function writeField(c: CpuContext, base: FieldBase, position: number, size: number, value: number) {
	fieldSize(size)
	if (!size) return
	const mask = (1n << BigInt(size)) - 1n
	if (base.register !== undefined) {
		if (position >>> 0 > 31) throw new VaxFault('Reserved operand fault: register bit field position exceeds 31')
		const two = position + size > 32, n = base.register
		let pair = BigInt(c.r[n]) | (two ? BigInt(c.r[n + 1]) << 32n : 0n)
		pair = pair & ~(mask << BigInt(position)) | (BigInt(value >>> 0) & mask) << BigInt(position)
		c.r[n] = Number(pair & 0xffffffffn)
		if (two) c.r[n + 1] = Number(pair >> 32n & 0xffffffffn)
		return
	}
	const address = base.address + Math.floor((position | 0) / 8), shift = (position | 0) & 7, count = Math.ceil((shift + size) / 8)
	let bits = 0n
	for (let i = 0; i < count; i++) bits |= BigInt(c.read(address + i, 1)) << BigInt(8 * i)
	bits = bits & ~(mask << BigInt(shift)) | (BigInt(value >>> 0) & mask) << BigInt(shift)
	for (let i = 0; i < count; i++) c.write(address + i, Number(bits >> BigInt(8 * i) & 255n), 1)
}

/* ---------------------------------------------------------- stack, calls */

function push(c: CpuContext, value: number) { c.r[SP] = c.r[SP] - 4 >>> 0; c.write(c.r[SP], value >>> 0, 4) }
function pop(c: CpuContext) { const value = c.read(c.r[SP], 4); c.r[SP] = c.r[SP] + 4 >>> 0; return value }

/** CALLS and CALLG: save the masked registers, PC, FP, AP and the mask/PSW longword. */
function call(c: CpuContext, target: number, argumentList: number | null, count: number) {
	if (argumentList === null) push(c, count)
	const ap = argumentList ?? c.r[SP], alignment = c.r[SP] & 3
	c.r[SP] = c.r[SP] & ~3 >>> 0
	const mask = c.read(target, 2)
	if (mask & 0x3000) throw new VaxFault('Reserved operand fault: entry mask bits 13:12 must be zero')
	for (let i = 11; i >= 0; i--) if (mask & 1 << i) push(c, c.r[i])
	push(c, c.pc); push(c, c.r[FP]); push(c, c.r[AP])
	push(c, (alignment << 30 | (argumentList === null ? 1 << 29 : 0) | (mask & 0xfff) << 16 | c.r[PSL] & 0xffe0) >>> 0)
	push(c, 0)
	c.r[FP] = c.r[SP]; c.r[AP] = ap
	c.r[PSL] = (c.r[PSL] & ~0xff | c.r[PSL] & T | (mask & 0x8000 ? DV : 0) | (mask & 0x4000 ? IV : 0)) >>> 0
	c.call(target + 2 >>> 0, c.pc)
}
function returnFromCall(c: CpuContext) {
	c.r[SP] = c.r[FP] + 4 >>> 0
	const saved = pop(c)
	c.r[AP] = pop(c); c.r[FP] = pop(c)
	const target = pop(c)
	for (let i = 0; i < 12; i++) if (saved & 1 << (16 + i)) c.r[i] = pop(c)
	c.r[SP] = c.r[SP] + (saved >>> 30) >>> 0
	c.r[PSL] = (c.r[PSL] & ~0xffff | saved & 0xffff) >>> 0
	if (saved & 1 << 29) { const count = pop(c) & 0xff; c.r[SP] = c.r[SP] + 4 * count >>> 0 }
	c.ret(target)
}

/* ----------------------------------------------------- console and IPRs */

/** Console IPRs (VAX ARM chapter 12) and the system identification register. */
export const RXCS = 32, RXDB = 33, TXCS = 34, TXDB = 35, SID = 62
const SIDS = [0x01000000, 0x08000000, 0x08000000]

/** CHMK codes the THRAX console monitor serves in place of an operating system. */
export const PRINT_INTEGER = 1, PRINT_STRING = 4, READ_INTEGER = 5, EXIT = 10, PRINT_CHARACTER = 11
function monitor(c: CpuContext, code: number) {
	switch (code) {
		case PRINT_INTEGER: c.output(String(c.r[0] | 0)); break
		case PRINT_STRING: { let at = c.r[0], text = ''; for (let i = 0; i < 65536; i++) { const b = c.read(at++, 1); if (!b) break; text += String.fromCharCode(b) } c.output(text); break }
		case READ_INTEGER: c.r[0] = c.inputInteger(32) >>> 0; break
		case EXIT: c.halt(); break
		case PRINT_CHARACTER: c.output(String.fromCharCode(c.r[0] & 255)); break
		default: throw new VaxFault(`CHMK #${code}: the THRAX console monitor serves codes 1, 4, 5, 10 and 11`)
	}
}

/* ----------------------------------------------------------- the opcodes */

const branchIf = (test: (psl: number) => boolean): Handler => (c, o) => c.branch(o.v[0] as number, test(c.r[PSL]))
const last = (o: Operands) => o.v.length - 1

const INTEGER_TYPES: readonly [number, string, number][] = [[B, 'B', 0x80], [W, 'W', 0xa0], [L, 'L', 0xc0]]
for (const [t, s, base] of INTEGER_TYPES) {
	const x = s.toLowerCase()
	const binary = (name: string, code: number, f: (c: CpuContext, a: number, b: number) => number) => {
		op(`${name}${s}2`, code, `r${x} m${x}`, (c, o) => o.put(1, f(c, o.v[1] as number, o.v[0] as number)))
		op(`${name}${s}3`, code + 1, `r${x} r${x} w${x}`, (c, o) => o.put(2, f(c, o.v[1] as number, o.v[0] as number)))
	}
	binary('ADD', base, (c, a, b) => add(c, a, b, 0, t))
	binary('SUB', base + 2, (c, a, b) => subtract(c, a, b, 0, t))
	binary('MUL', base + 4, (c, a, b) => {
		const product = BigInt(signed(a, t)) * BigInt(signed(b, t)), result = unsigned(Number(BigInt.asIntN(32, product)), t)
		setFlags(c, signBit(result, t), result === 0, !fits(product, t), false)
		return result
	})
	binary('DIV', base + 6, (c, a, b) => {
		const dividend = signed(a, t), divisor = signed(b, t)
		if (!divisor) { c.r[PSL] |= V; throw new VaxFault('Integer divide-by-zero trap') }
		const quotient = Math.trunc(dividend / divisor), overflow = !fits(quotient, t), result = unsigned(overflow ? dividend : quotient, t)
		setFlags(c, signBit(result, t), result === 0, overflow, false)
		return result
	})
	binary('BIS', base + 8, (c, a, b) => { const r = unsigned(a | b, t); logical(c, r, t, KEEP); return r })
	binary('BIC', base + 10, (c, a, b) => { const r = unsigned(a & ~b, t); logical(c, r, t, KEEP); return r })
	binary('XOR', base + 12, (c, a, b) => { const r = unsigned(a ^ b, t); logical(c, r, t, KEEP); return r })
	op(`MNEG${s}`, base + 14, `r${x} w${x}`, (c, o) => { const r = subtract(c, 0, o.v[0] as number, 0, t); o.put(1, r) })
	op(`CASE${s}`, base + 15, `r${x} r${x} r${x}`, (c, o) => {
		const selector = unsigned((o.v[0] as number) - (o.v[1] as number), t), limit = unsigned(o.v[2] as number, t)
		compareIntegers(c, selector, limit, t)
		const skip = o.end + 2 * (limit + 1) >>> 0
		if (selector <= limit) c.branch(o.end + (c.read(o.end + 2 * selector, 2) << 16 >> 16) >>> 0, true)
		else { c.branch(skip, false); c.pc = skip }
	}, { kind: 'jump' })
	op(`MOV${s}`, base + 16, `r${x} w${x}`, (c, o) => { logical(c, o.v[0] as number, t, KEEP); o.put(1, o.v[0]) })
	op(`CMP${s}`, base + 17, `r${x} r${x}`, (c, o) => compareIntegers(c, o.v[0] as number, o.v[1] as number, t))
	op(`MCOM${s}`, base + 18, `r${x} w${x}`, (c, o) => { const r = unsigned(~(o.v[0] as number), t); logical(c, r, t, KEEP); o.put(1, r) })
	op(`BIT${s}`, base + 19, `r${x} r${x}`, (c, o) => logical(c, unsigned((o.v[0] as number) & (o.v[1] as number), t), t, KEEP))
	op(`CLR${s}`, base + 20, `w${x}`, (c, o) => { logical(c, 0, t, KEEP); o.put(0, 0) }, t === L ? { aliases: ['CLRF'] } : {})
	op(`TST${s}`, base + 21, `r${x}`, (c, o) => logical(c, o.v[0] as number, t, false))
	op(`INC${s}`, base + 22, `m${x}`, (c, o) => o.put(0, add(c, o.v[0] as number, 1, 0, t)))
	op(`DEC${s}`, base + 23, `m${x}`, (c, o) => o.put(0, subtract(c, o.v[0] as number, 1, 0, t)))
}

const convertInteger = (from: number, to: number): Handler => (c, o) => {
	const value = signed(o.v[0] as number, from), result = unsigned(value, to)
	setFlags(c, signBit(result, to), result === 0, !fits(value, to), false)
	o.put(1, result)
}
op('CVTBW', 0x99, 'rb ww', convertInteger(B, W)); op('CVTBL', 0x98, 'rb wl', convertInteger(B, L))
op('CVTWB', 0x33, 'rw wb', convertInteger(W, B)); op('CVTWL', 0x32, 'rw wl', convertInteger(W, L))
op('CVTLB', 0xf6, 'rl wb', convertInteger(L, B)); op('CVTLW', 0xf7, 'rl ww', convertInteger(L, W))
const movz: Handler = (c, o) => { setFlags(c, false, o.v[0] === 0, false, KEEP); o.put(1, o.v[0]) }
op('MOVZBW', 0x9b, 'rb ww', movz); op('MOVZBL', 0x9a, 'rb wl', movz); op('MOVZWL', 0x3c, 'rw wl', movz)

for (const [s, mova, pusha, aliases] of [['B', 0x9e, 0x9f, []], ['W', 0x3e, 0x3f, []], ['L', 0xde, 0xdf, ['F']], ['Q', 0x7e, 0x7f, ['D', 'G']]] as const) {
	const x = s.toLowerCase()
	op(`MOVA${s}`, mova, `a${x} wl`, (c, o) => { logical(c, o.v[0] as number, L, KEEP); o.put(1, o.v[0]) }, { aliases: aliases.map(a => `MOVA${a}`) })
	op(`PUSHA${s}`, pusha, `a${x}`, (c, o) => { logical(c, o.v[0] as number, L, KEEP); push(c, o.v[0] as number) }, { aliases: aliases.map(a => `PUSHA${a}`) })
}
op('PUSHL', 0xdd, 'rl', (c, o) => { logical(c, o.v[0] as number, L, KEEP); push(c, o.v[0] as number) })
op('CLRQ', 0x7c, 'wq', (c, o) => { logical(c, 0, L, KEEP); o.put(0, 0n) }, { aliases: ['CLRD', 'CLRG'] })
op('MOVQ', 0x7d, 'rq wq', (c, o) => { quadFlags(c, o.v[0] as bigint, KEEP); o.put(1, o.v[0]) })
op('CLRO', 0xfd7c, 'wo', (c, o) => { logical(c, 0, L, KEEP); o.put(0, 0n) }, { group: HFLOAT, aliases: ['CLRH'] })
op('MOVO', 0xfd7d, 'ro wo', (c, o) => { quadFlags(c, o.v[0] as bigint, KEEP, 128); o.put(1, o.v[0]) }, { group: HFLOAT })
op('MOVAO', 0xfd7e, 'ao wl', (c, o) => { logical(c, o.v[0] as number, L, KEEP); o.put(1, o.v[0]) }, { group: HFLOAT, aliases: ['MOVAH'] })
op('PUSHAO', 0xfd7f, 'ao', (c, o) => { logical(c, o.v[0] as number, L, KEEP); push(c, o.v[0] as number) }, { group: HFLOAT, aliases: ['PUSHAH'] })

op('ADWC', 0xd8, 'rl ml', (c, o) => o.put(1, add(c, o.v[1] as number, o.v[0] as number, c.r[PSL] & C, L)))
op('SBWC', 0xd9, 'rl ml', (c, o) => o.put(1, subtract(c, o.v[1] as number, o.v[0] as number, c.r[PSL] & C, L)))
op('ADAWI', 0x58, 'rw mw', (c, o) => o.put(1, add(c, o.v[1] as number, o.v[0] as number, 0, W)))
op('ASHL', 0x78, 'rb rl wl', (c, o) => {
	const count = signed(o.v[0] as number, B), source = BigInt((o.v[1] as number) | 0)
	const exact = count >= 0 ? source << BigInt(Math.min(count, 64)) : source >> BigInt(Math.min(-count, 63))
	const result = Number(BigInt.asUintN(32, exact))
	setFlags(c, signBit(result, L), result === 0, count > 0 && !fits(exact, L), false)
	o.put(2, result)
})
op('ASHQ', 0x79, 'rb rq wq', (c, o) => {
	const count = signed(o.v[0] as number, B), source = quadSigned(o.v[1])
	const exact = count >= 0 ? source << BigInt(Math.min(count, 128)) : source >> BigInt(Math.min(-count, 127))
	const result = BigInt.asUintN(64, exact)
	setFlags(c, BigInt.asIntN(64, result) < 0n, result === 0n, count > 0 && BigInt.asIntN(64, exact) !== exact, false)
	o.put(2, result)
})
op('ROTL', 0x9c, 'rb rl wl', (c, o) => {
	const count = (o.v[0] as number) & 31, value = o.v[1] as number, result = count ? (value << count | value >>> (32 - count)) >>> 0 : value >>> 0
	logical(c, result, L, KEEP); o.put(2, result)
})
op('EMUL', 0x7a, 'rl rl rl wq', (c, o) => {
	const product = BigInt((o.v[0] as number) | 0) * BigInt((o.v[1] as number) | 0) + BigInt((o.v[2] as number) | 0)
	quadFlags(c, product, false); o.put(3, BigInt.asUintN(64, product))
})
op('EDIV', 0x7b, 'rl rq wl wl', (c, o) => {
	const divisor = BigInt((o.v[0] as number) | 0), dividend = quadSigned(o.v[1])
	if (!divisor) { c.r[PSL] |= V; throw new VaxFault('Integer divide-by-zero trap') }
	const quotient = dividend / divisor, remainder = dividend % divisor, overflow = !fits(quotient, L)
	const q = overflow ? Number(BigInt.asUintN(32, dividend)) : Number(BigInt.asUintN(32, quotient)), r = overflow ? 0 : Number(BigInt.asUintN(32, remainder))
	setFlags(c, signBit(q, L), q === 0, overflow, false)
	o.put(2, q); o.put(3, r)
})

/* Branches; displacements are from the end of the instruction. */
const conditions: [string, number, (psl: number) => boolean, string[]][] = [
	['BNEQ', 0x12, p => !(p & Z), ['BNEQU']], ['BEQL', 0x13, p => !!(p & Z), ['BEQLU']],
	['BGTR', 0x14, p => !(p & (N | Z)), []], ['BLEQ', 0x15, p => !!(p & (N | Z)), []],
	['BGEQ', 0x18, p => !(p & N), []], ['BLSS', 0x19, p => !!(p & N), []],
	['BGTRU', 0x1a, p => !(p & (C | Z)), []], ['BLEQU', 0x1b, p => !!(p & (C | Z)), []],
	['BVC', 0x1c, p => !(p & V), []], ['BVS', 0x1d, p => !!(p & V), []],
	['BGEQU', 0x1e, p => !(p & C), ['BCC']], ['BLSSU', 0x1f, p => !!(p & C), ['BCS']],
]
for (const [name, code, test, aliases] of conditions) op(name, code, 'bb', branchIf(test), { kind: 'branch', aliases })
op('BRB', 0x11, 'bb', (c, o) => c.branch(o.v[0] as number, true), { kind: 'jump' })
op('BRW', 0x31, 'bw', (c, o) => c.branch(o.v[0] as number, true), { kind: 'jump' })
op('JMP', 0x17, 'ab', (c, o) => { c.pc = o.v[0] as number }, { kind: 'jump' })
const subroutine: Handler = (c, o) => { push(c, c.pc); c.call(o.v[0] as number, c.pc) }
op('BSBB', 0x10, 'bb', subroutine, { kind: 'call', call: true })
op('BSBW', 0x30, 'bw', subroutine, { kind: 'call', call: true })
op('JSB', 0x16, 'ab', subroutine, { kind: 'call', call: true })
op('RSB', 0x05, '', c => c.ret(pop(c)), { kind: 'return' })
op('CALLS', 0xfb, 'rl ab', (c, o) => call(c, o.v[1] as number, null, o.v[0] as number), { kind: 'call', call: true })
op('CALLG', 0xfa, 'ab ab', (c, o) => call(c, o.v[1] as number, o.v[0] as number, 0), { kind: 'call', call: true })
op('RET', 0x04, '', returnFromCall, { kind: 'return' })

const acbInteger = (t: number): Handler => (c, o) => {
	const limit = signed(o.v[0] as number, t), increment = signed(o.v[1] as number, t)
	const carry = c.r[PSL] & C, index = add(c, o.v[2] as number, o.v[1] as number, 0, t)
	c.r[PSL] = (c.r[PSL] & ~C | carry) >>> 0
	o.put(2, index)
	const next = signed(index, t)
	c.branch(o.v[3] as number, increment >= 0 ? next <= limit : next >= limit)
}
op('ACBB', 0x9d, 'rb rb mb bw', acbInteger(B), { kind: 'branch' })
op('ACBW', 0x3d, 'rw rw mw bw', acbInteger(W), { kind: 'branch' })
op('ACBL', 0xf1, 'rl rl ml bw', acbInteger(L), { kind: 'branch' })
const aob = (equal: boolean): Handler => (c, o) => {
	const carry = c.r[PSL] & C, index = add(c, o.v[1] as number, 1, 0, L)
	c.r[PSL] = (c.r[PSL] & ~C | carry) >>> 0
	o.put(1, index)
	c.branch(o.v[2] as number, equal ? (index | 0) <= ((o.v[0] as number) | 0) : (index | 0) < ((o.v[0] as number) | 0))
}
op('AOBLSS', 0xf2, 'rl ml bb', aob(false), { kind: 'branch' })
op('AOBLEQ', 0xf3, 'rl ml bb', aob(true), { kind: 'branch' })
const sob = (zero: boolean): Handler => (c, o) => {
	const carry = c.r[PSL] & C, index = subtract(c, o.v[0] as number, 1, 0, L)
	c.r[PSL] = (c.r[PSL] & ~C | carry) >>> 0
	o.put(0, index)
	c.branch(o.v[1] as number, zero ? (index | 0) >= 0 : (index | 0) > 0)
}
op('SOBGEQ', 0xf4, 'ml bb', sob(true), { kind: 'branch' })
op('SOBGTR', 0xf5, 'ml bb', sob(false), { kind: 'branch' })

const bitBranch = (set: boolean, change: 0 | 1 | 2): Handler => (c, o) => {
	const position = o.v[0] as number, base = o.field[1]!, bit = readField(c, base, position, 1)
	if (change) writeField(c, base, position, 1, change === 1 ? 1 : 0)
	c.branch(o.v[2] as number, !!bit === set)
}
op('BBS', 0xe0, 'rl vb bb', bitBranch(true, 0), { kind: 'branch' })
op('BBC', 0xe1, 'rl vb bb', bitBranch(false, 0), { kind: 'branch' })
op('BBSS', 0xe2, 'rl vb bb', bitBranch(true, 1), { kind: 'branch' })
op('BBCS', 0xe3, 'rl vb bb', bitBranch(false, 1), { kind: 'branch' })
op('BBSC', 0xe4, 'rl vb bb', bitBranch(true, 2), { kind: 'branch' })
op('BBCC', 0xe5, 'rl vb bb', bitBranch(false, 2), { kind: 'branch' })
op('BBSSI', 0xe6, 'rl vb bb', bitBranch(true, 1), { kind: 'branch' })
op('BBCCI', 0xe7, 'rl vb bb', bitBranch(false, 2), { kind: 'branch' })
op('BLBS', 0xe8, 'rl bb', (c, o) => c.branch(o.v[1] as number, !!((o.v[0] as number) & 1)), { kind: 'branch' })
op('BLBC', 0xe9, 'rl bb', (c, o) => c.branch(o.v[1] as number, !((o.v[0] as number) & 1)), { kind: 'branch' })

const extract = (signExtend: boolean): Handler => (c, o) => {
	const size = o.v[1] as number, raw = readField(c, o.field[2]!, o.v[0] as number, size)
	const value = signExtend && size && size < 32 ? raw << (32 - size) >> (32 - size) >>> 0 : raw >>> 0
	logical(c, value, L, false); o.put(3, value)
}
op('EXTV', 0xee, 'rl rb vb wl', extract(true))
op('EXTZV', 0xef, 'rl rb vb wl', extract(false))
op('INSV', 0xf0, 'rl rl rb vb', (c, o) => writeField(c, o.field[3]!, o.v[1] as number, o.v[2] as number, o.v[0] as number))
const compareField = (signExtend: boolean): Handler => (c, o) => {
	const size = o.v[1] as number, raw = readField(c, o.field[2]!, o.v[0] as number, size)
	compareIntegers(c, signExtend && size && size < 32 ? raw << (32 - size) >> (32 - size) : raw, o.v[3] as number, L)
}
op('CMPV', 0xec, 'rl rb vb rl', compareField(true))
op('CMPZV', 0xed, 'rl rb vb rl', compareField(false))
const findFirst = (set: boolean): Handler => (c, o) => {
	const start = o.v[0] as number, size = o.v[1] as number, bits = readField(c, o.field[2]!, start, size)
	let found = size
	for (let i = 0; i < size; i++) if (!!(bits >>> i & 1) === set) { found = i; break }
	setFlags(c, false, found === size, false, false)
	o.put(3, start + found >>> 0)
}
op('FFS', 0xea, 'rl rb vb wl', findFirst(true))
op('FFC', 0xeb, 'rl rb vb wl', findFirst(false))

op('PUSHR', 0xbb, 'rw', (c, o) => { for (let i = 14; i >= 0; i--) if ((o.v[0] as number) & 1 << i) push(c, c.r[i]) })
op('POPR', 0xba, 'rw', (c, o) => { for (let i = 0; i <= 14; i++) if ((o.v[0] as number) & 1 << i) { const value = pop(c); if (i !== SP) c.r[i] = value } })
op('MOVPSL', 0xdc, 'wl', (c, o) => o.put(0, c.r[PSL]))
const psw = (set: boolean): Handler => (c, o) => {
	const mask = o.v[0] as number
	if (mask & 0xff00) throw new VaxFault('Reserved operand fault: PSW mask bits 15:8 must be zero')
	c.r[PSL] = (set ? c.r[PSL] | mask : c.r[PSL] & ~mask) >>> 0
}
op('BISPSW', 0xb8, 'rw', psw(true))
op('BICPSW', 0xb9, 'rw', psw(false))
op('INDEX', 0x0a, 'rl rl rl rl rl wl', (c, o) => {
	const [subscript, low, high, size, index] = o.v.slice(0, 5).map(value => Number(value) | 0)
	const result = Number(BigInt.asUintN(32, (BigInt(index) + BigInt(subscript)) * BigInt(size)))
	logical(c, result, L, false); o.put(5, result)
	if (subscript < low || subscript > high) throw new VaxFault('Subscript range trap')
})

/* Character strings; registers R0-R5 hold the documented final state. */
function copy(c: CpuContext, source: number, target: number, length: number) {
	const bytes = Array.from({ length }, (_, i) => c.read(source + i, 1))
	bytes.forEach((byte, i) => c.write(target + i, byte, 1))
}
op('MOVC3', 0x28, 'rw ab ab', (c, o) => {
	const length = o.v[0] as number, source = o.v[1] as number, target = o.v[2] as number
	copy(c, source, target, length)
	c.r.set([0, source + length >>> 0, 0, target + length >>> 0, 0, 0], 0)
	setFlags(c, false, true, false, false)
})
op('MOVC5', 0x2c, 'rw ab rb rw ab', (c, o) => {
	const sourceLength = o.v[0] as number, source = o.v[1] as number, fill = o.v[2] as number, targetLength = o.v[3] as number, target = o.v[4] as number
	const moved = Math.min(sourceLength, targetLength)
	copy(c, source, target, moved)
	for (let i = moved; i < targetLength; i++) c.write(target + i, fill, 1)
	c.r.set([sourceLength - moved, source + moved >>> 0, 0, target + targetLength >>> 0, 0, 0], 0)
	setFlags(c, (sourceLength << 16 >> 16) < (targetLength << 16 >> 16), sourceLength === targetLength, false, sourceLength < targetLength)
})
function compareStrings(c: CpuContext, first: number, firstLength: number, second: number, secondLength: number, fill: number) {
	let i = 0
	for (; i < Math.max(firstLength, secondLength); i++) {
		const a = i < firstLength ? c.read(first + i, 1) : fill, b = i < secondLength ? c.read(second + i, 1) : fill
		if (a !== b) { compareIntegers(c, a, b, B); break }
	}
	if (i === Math.max(firstLength, secondLength)) setFlags(c, false, true, false, false)
	c.r.set([Math.max(0, firstLength - i), first + Math.min(i, firstLength) >>> 0, Math.max(0, secondLength - i), second + Math.min(i, secondLength) >>> 0], 0)
}
op('CMPC3', 0x29, 'rw ab ab', (c, o) => { const length = o.v[0] as number; compareStrings(c, o.v[1] as number, length, o.v[2] as number, length, 0) })
op('CMPC5', 0x2d, 'rw ab rb rw ab', (c, o) => compareStrings(c, o.v[1] as number, o.v[0] as number, o.v[4] as number, o.v[3] as number, o.v[2] as number))
const locate = (match: boolean): Handler => (c, o) => {
	const character = o.v[0] as number, length = o.v[1] as number, address = o.v[2] as number
	let i = 0
	while (i < length && (c.read(address + i, 1) === character) !== match) i++
	c.r[0] = length - i; c.r[1] = address + i >>> 0
	setFlags(c, false, i === length, false, false)
}
op('LOCC', 0x3a, 'rb rw ab', locate(true))
op('SKPC', 0x3b, 'rb rw ab', locate(false))

op('HALT', 0x00, '', c => c.halt(), { kind: 'system' })
op('NOP', 0x01, '', () => {})
op('BPT', 0x03, '', () => { throw new VaxFault('Breakpoint fault: no SCB handler is installed') }, { kind: 'system' })
op('REI', 0x02, '', c => { const target = pop(c), psl = pop(c); c.r[PSL] = (psl & PSL_WRITABLE) >>> 0; c.ret(target) }, { kind: 'return' })
op('CHMK', 0xbc, 'rw', (c, o) => monitor(c, o.v[0] as number), { kind: 'system' })
op('MTPR', 0xda, 'rl rl', (c, o) => {
	const value = o.v[0] as number, register = o.v[1] as number
	logical(c, value, L, KEEP)
	if (register === TXDB) c.output(String.fromCharCode(value & 255))
	else if (register === SID) throw new VaxFault('Reserved operand fault: SID is read-only')
	else if (register < 64) c.writeState(register, value)
	else throw new VaxFault(`Reserved operand fault: no processor register ${register}`)
}, { kind: 'system' })
op('MFPR', 0xdb, 'rl wl', (c, o) => {
	const register = o.v[0] as number
	if (register >= 64) throw new VaxFault(`Reserved operand fault: no processor register ${register}`)
	// The transmitter is always ready; console input arrives through CHMK, not RXDB.
	const value = register === TXCS ? 0x80 : register === RXCS || register === RXDB ? 0 : register === SID ? c.state[64] : c.state[register]
	logical(c, value, L, KEEP); o.put(1, value)
}, { kind: 'system' })

/* Floating point: F and D (0x40, 0x60), G and H (FD 40, FD 60). */
const FLOAT_TYPES: readonly [number, string, number][] = [[F, 'F', 0x40], [D, 'D', 0x60], [G, 'G', 0xfd40], [H, 'H', 0xfd60]]
const floatFlags = (c: CpuContext, value: Value, t: number) => setFlags(c, isNegative(value, formatOf(t)), isZero(value, formatOf(t)), false, false)
for (const [t, s, base] of FLOAT_TYPES) {
	const x = s.toLowerCase(), format = formatOf(t), group = t === H ? HFLOAT : FLOAT
	const binary = (name: string, code: number, operation: 'add' | 'sub' | 'mul' | 'div') => {
		const run = (to: number): Handler => (c, o) => { const r = arithmetic(operation, o.v[1], o.v[0], format); floatFlags(c, r, t); o.put(to, r) }
		op(`${name}${s}2`, code, `r${x} m${x}`, run(1), { group })
		op(`${name}${s}3`, code + 1, `r${x} r${x} w${x}`, run(2), { group })
	}
	binary('ADD', base, 'add'); binary('SUB', base + 2, 'sub'); binary('MUL', base + 4, 'mul'); binary('DIV', base + 6, 'div')
	const toInt = (to: number, round: boolean): Handler => (c, o) => {
		const value = toInteger(o.v[0], format, round), result = unsigned(Number(BigInt.asIntN(32, value)), to)
		setFlags(c, signBit(result, to), result === 0, !fits(value, to), false)
		o.put(1, result)
	}
	op(`CVT${s}B`, base + 8, `r${x} wb`, toInt(B, false), { group })
	op(`CVT${s}W`, base + 9, `r${x} ww`, toInt(W, false), { group })
	op(`CVT${s}L`, base + 10, `r${x} wl`, toInt(L, false), { group })
	op(`CVTR${s}L`, base + 11, `r${x} wl`, toInt(L, true), { group })
	const fromInt = (from: number): Handler => (c, o) => { const r = fromInteger(BigInt(signed(o.v[0] as number, from)), format); floatFlags(c, r, t); o.put(1, r) }
	op(`CVTB${s}`, base + 12, `rb w${x}`, fromInt(B), { group })
	op(`CVTW${s}`, base + 13, `rw w${x}`, fromInt(W), { group })
	op(`CVTL${s}`, base + 14, `rl w${x}`, fromInt(L), { group })
	op(`ACB${s}`, base + 15, `r${x} r${x} m${x} bw`, (c, o) => {
		const index = arithmetic('add', o.v[2], o.v[1], format)
		floatFlags(c, index, t); o.put(2, index)
		const increment = compare(o.v[1], fromInteger(0n, format), format), position = compare(index, o.v[0], format)
		c.branch(o.v[3] as number, increment >= 0 ? position <= 0 : position >= 0)
	}, { group, kind: 'branch' })
	op(`MOV${s}`, base + 16, `r${x} w${x}`, (c, o) => { floatFlags(c, o.v[0], t); o.put(1, o.v[0]) }, { group })
	op(`CMP${s}`, base + 17, `r${x} r${x}`, (c, o) => { const order = compare(o.v[0], o.v[1], format); setFlags(c, order < 0, order === 0, false, false) }, { group })
	op(`MNEG${s}`, base + 18, `r${x} w${x}`, (c, o) => { const r = negate(o.v[0], format); floatFlags(c, r, t); o.put(1, r) }, { group })
	op(`TST${s}`, base + 19, `r${x}`, (c, o) => floatFlags(c, o.v[0], t), { group })
}
const convertFloat = (from: number, to: number): Handler => (c, o) => { const r = convert(o.v[0], formatOf(from), formatOf(to)); floatFlags(c, r, to); o.put(1, r) }
for (const [name, code, from, to] of [
	['CVTFD', 0x56, F, D], ['CVTDF', 0x76, D, F], ['CVTFG', 0xfd99, F, G], ['CVTGF', 0xfd33, G, F],
	['CVTFH', 0xfd98, F, H], ['CVTHF', 0xfdf6, H, F], ['CVTDH', 0xfd32, D, H], ['CVTHD', 0xfdf7, H, D], ['CVTGH', 0xfd56, G, H], ['CVTHG', 0xfd76, H, G],
] as const) op(name, code, `r${TYPE_LETTERS[from]} w${TYPE_LETTERS[to]}`, convertFloat(from, to), { group: from === H || to === H ? HFLOAT : FLOAT })

/** Mnemonics in opcode order, aliases after their opcode. */
export const instructions: readonly string[] = [...byName.keys()]
export const opcodeOf = (name: string) => byName.get(name.toUpperCase())

/* ------------------------------------------------------ operand decoding */

/** Specifier modes after decoding; PC forms resolve to their own kinds. */
const LITERAL = 0, REGISTER = 1, DEFERRED = 2, AUTODEC = 3, AUTOINC = 4, AUTOINC_DEFERRED = 5, IMMEDIATE = 6, ABSOLUTE = 7, DISPLACEMENT = 8, DISPLACEMENT_DEFERRED = 9, RELATIVE = 10, RELATIVE_DEFERRED = 11
interface Specifier {
	mode: number
	register: number
	displacement: number
	/** Literal or immediate value, or a relative/absolute address. */
	value: Value
	/** Where the immediate's bytes are, for an address operand. */
	address: number
	index: number
	text: string
	fault?: string
}

const hex = (value: number) => `^X${(value >>> 0).toString(16).toUpperCase()}`
const widthPrefix = ['B^', 'W^', '', 'L^']
function valueText(value: Value, type: number): string {
	if (type >= F) { const n = decToNumber(imageOf(value), formatOf(type)); return n === null ? 'reserved' : Number.isInteger(n) ? n.toFixed(1) : String(n) }
	if (typeof value === 'bigint') return `^X${value.toString(16).toUpperCase()}`
	return String(signed(value, type))
}

export function decode(memory: ArrayLike<number>, address: number, model: Model = VAX780): CpuInstruction {
	let at = address
	const byte = () => { const b = memory[at]; if (b === undefined) throw new Error('VAX instruction runs past memory'); at++; return b }
	const bytes = (count: number): bigint => { let value = 0n; for (let i = 0; i < count; i++) value |= BigInt(byte()) << BigInt(8 * i); return value }
	const first = byte(), code = first === 0xfd ? 0xfd00 | byte() : first
	const entry = byCode.get(code)
	const opcodeText = code > 255 ? `FD ${(code & 255).toString(16).toUpperCase().padStart(2, '0')}` : code.toString(16).toUpperCase().padStart(2, '0')
	if (!entry) return { size: at - address, text: `.BYTE ${opcodeText.split(' ').map(h => `^X${h}`).join(', ')}`, kind: 'system', execute: () => { throw new VaxFault(`Reserved instruction fault: opcode ${opcodeText} is not implemented by this VAX`) } }
	const specifier = (access: number, type: number, indexed = false): Specifier => {
		const b = byte(), mode = b >> 4, n = b & 15, size = TYPE_BYTES[type]
		const s: Specifier = { mode: REGISTER, register: n, displacement: 0, value: 0, address: 0, index: -1, text: '' }
		const r = registerNames[n]
		if (mode < 4) {
			s.mode = LITERAL
			s.value = type >= F ? floatLiteral(b & 63, formatOf(type)) : type >= Q ? BigInt(b & 63) : b & 63
			s.text = `S^#${valueText(s.value, type)}`
			if (access !== READ) s.fault = 'a short literal can only be read'
		} else if (mode === 4) {
			if (indexed) throw new VaxFault('Reserved addressing mode fault: nested index mode')
			const base = specifier(access, type, true)
			s.mode = base.mode; s.register = base.register; s.displacement = base.displacement; s.value = base.value; s.address = base.address
			s.index = n; s.text = `${base.text}[${r}]`
			s.fault = base.fault ?? (n === PC ? 'PC cannot index' : [LITERAL, REGISTER, IMMEDIATE].includes(base.mode) ? 'index mode needs a memory base' : undefined)
		} else if (mode === 5) {
			s.text = r
			if (access === ADDRESS) s.fault = 'an address operand cannot be a register'
			else if (n === PC || size > 4 && n + size / 4 - 1 >= PC) s.fault = `${r} cannot hold a ${size}-byte operand`
		} else if (mode === 6) { s.mode = DEFERRED; s.text = `(${r})`; if (n === PC) s.fault = '(PC) is reserved' }
		else if (mode === 7) { s.mode = AUTODEC; s.text = `-(${r})`; if (n === PC) s.fault = '-(PC) is reserved' }
		else if (mode === 8 && n === PC) {
			s.mode = IMMEDIATE; s.address = at
			const raw = bytes(size)
			s.value = size > 4 ? raw : Number(raw)
			s.text = `I^#${valueText(s.value, type)}`
			if (access !== READ && access !== ADDRESS) s.fault = 'an immediate can only be read'
		} else if (mode === 8) { s.mode = AUTOINC; s.text = `(${r})+` }
		else if (mode === 9 && n === PC) { s.mode = ABSOLUTE; s.value = Number(bytes(4)); s.text = `@#${hex(s.value)}` }
		else if (mode === 9) { s.mode = AUTOINC_DEFERRED; s.text = `@(${r})+` }
		else {
			const width = [1, 2, 4][(mode - 10) >> 1], deferred = !!(mode & 1), raw = Number(bytes(width))
			s.displacement = width === 1 ? raw << 24 >> 24 : width === 2 ? raw << 16 >> 16 : raw | 0
			if (n === PC) { s.mode = deferred ? RELATIVE_DEFERRED : RELATIVE; s.value = at + s.displacement >>> 0; s.text = `${deferred ? '@' : ''}${widthPrefix[width - 1]}${hex(s.value)}` }
			else { s.mode = deferred ? DISPLACEMENT_DEFERRED : DISPLACEMENT; s.text = `${deferred ? '@' : ''}${widthPrefix[width - 1]}${s.displacement}(${r})` }
		}
		return s
	}
	const specs: Specifier[] = [], targets: number[] = []
	for (const [access, type] of entry.operands) {
		if (access === BRANCH) {
			const width = type === B ? 1 : 2, raw = Number(bytes(width))
			targets[specs.length] = at + (width === 1 ? raw << 24 >> 24 : raw << 16 >> 16) >>> 0
			specs.push({ mode: -1, register: 0, displacement: 0, value: 0, address: 0, index: -1, text: hex(targets[specs.length]) })
		} else specs.push(specifier(access, type))
	}
	const end = at, size = end - address
	const text = `${entry.name}${specs.length ? ` ${specs.map(s => s.text).join(', ')}` : ''}`
	const gate = entry.group === HFLOAT && model !== VAX780 ? `MicroVAX II omits H_floating and octaword instructions; ${entry.name} is emulated by system software`
		: entry.group === FLOAT && model === MICROVAX2_NO_FPU ? `${entry.name} needs the 78132 floating-point unit, which this MicroVAX II lacks` : null
	const reads: string[] = [], writes: string[] = ['psl']
	const id = (n: number) => registerNames[n].toLowerCase()
	entry.operands.forEach(([access, type], i) => {
		const s = specs[i]
		if (s.mode === REGISTER) {
			const ids = Array.from({ length: Math.max(1, TYPE_BYTES[type] / 4) }, (_, k) => id(s.register + k))
			if (access === READ || access === MODIFY || access === FIELD) reads.push(...ids)
			if (access === WRITE || access === MODIFY || access === FIELD) writes.push(...ids)
		} else if (s.mode === AUTODEC || s.mode === AUTOINC || s.mode === AUTOINC_DEFERRED) { reads.push(id(s.register)); writes.push(id(s.register)) }
		else if ((s.mode === DEFERRED || s.mode === DISPLACEMENT || s.mode === DISPLACEMENT_DEFERRED) && s.register !== PC) reads.push(id(s.register))
		if (s.index >= 0) reads.push(id(s.index))
	})
	if (entry.kind === 'branch') reads.push('psl')
	if (['CALLS', 'CALLG', 'RET', 'JSB', 'BSBB', 'BSBW', 'RSB', 'PUSHL', 'PUSHR', 'POPR', 'REI'].includes(entry.name) || entry.name.startsWith('PUSHA')) { reads.push('sp'); writes.push('sp') }
	const touchesMemory = entry.operands.some(([access], i) => access !== BRANCH && specs[i].mode !== REGISTER && specs[i].mode !== LITERAL && specs[i].mode !== IMMEDIATE)
	const writesMemory = entry.operands.some(([access], i) => (access === WRITE || access === MODIFY) && specs[i].mode !== REGISTER)
	const kind: Kind = entry.kind ?? (writesMemory ? 'store' : touchesMemory ? 'load' : 'alu')

	const execute = (c: CpuContext) => {
		if (gate) throw new VaxFault(`Reserved instruction fault: ${gate}`)
		const v: Value[] = [], field: (FieldBase | undefined)[] = [], places: { register: number, address: number }[] = []
		entry.operands.forEach(([access, type], i) => {
			const s = specs[i]
			if (access === BRANCH) { v[i] = targets[i]; return }
			if (s.fault) throw new VaxFault(`Reserved addressing mode fault: ${s.fault}`)
			const size = access === FIELD ? 1 : TYPE_BYTES[type]
			let register = -1, at = 0
			switch (s.mode) {
				case LITERAL: case IMMEDIATE:
					if (access === ADDRESS) { at = s.address } else { v[i] = s.value; return }
					break
				case REGISTER: register = s.register; break
				case DEFERRED: at = c.r[s.register]; break
				case AUTODEC: c.r[s.register] = c.r[s.register] - size >>> 0; at = c.r[s.register]; break
				case AUTOINC: at = c.r[s.register]; c.r[s.register] = at + size >>> 0; break
				case AUTOINC_DEFERRED: at = c.read(c.r[s.register], 4); c.r[s.register] = c.r[s.register] + 4 >>> 0; break
				case ABSOLUTE: case RELATIVE: at = s.value as number; break
				case RELATIVE_DEFERRED: at = c.read(s.value as number, 4); break
				case DISPLACEMENT: at = c.r[s.register] + s.displacement >>> 0; break
				case DISPLACEMENT_DEFERRED: at = c.read(c.r[s.register] + s.displacement >>> 0, 4); break
			}
			if (s.index >= 0) at = at + Math.imul(c.r[s.index], size) >>> 0
			places[i] = { register, address: at }
			if (access === FIELD) { field[i] = register >= 0 ? { register, address: 0 } : { address: at }; return }
			if (access === ADDRESS) { v[i] = at; return }
			if (access === READ || access === MODIFY) v[i] = register >= 0 ? readRegister(c, register, type) : readMemory(c, at, type)
		})
		entry.run(c, { v, field, end, put: (i, value) => {
			const place = places[i], type = entry.operands[i][1]
			if (place.register >= 0) writeRegister(c, place.register, type, value)
			else writeMemory(c, place.address, type, value)
		} })
	}
	return { size, text, kind, call: entry.call, reads, writes, execute }
}

function readRegister(c: CpuContext, n: number, type: number): Value {
	const size = TYPE_BYTES[type]
	if (size <= 4) return size === 4 ? c.r[n] : c.r[n] & MASKS[type]
	let value = 0n
	for (let k = size / 4 - 1; k >= 0; k--) value = value << 32n | BigInt(c.r[n + k])
	return value
}
function writeRegister(c: CpuContext, n: number, type: number, value: Value) {
	const size = TYPE_BYTES[type]
	if (size === 1) c.r[n] = (c.r[n] & ~0xff | Number(value) & 0xff) >>> 0
	else if (size === 2) c.r[n] = (c.r[n] & ~0xffff | Number(value) & 0xffff) >>> 0
	else if (size === 4) c.r[n] = Number(value) >>> 0
	else for (let k = 0; k < size / 4; k++) c.r[n + k] = Number(BigInt(value) >> BigInt(32 * k) & 0xffffffffn)
}
function readMemory(c: CpuContext, address: number, type: number): Value {
	const size = TYPE_BYTES[type]
	if (size <= 4) return c.read(address, size)
	if (size === 8) return c.readWide(address)
	return c.readWide(address) | c.readWide(address + 8) << 64n
}
function writeMemory(c: CpuContext, address: number, type: number, value: Value) {
	const size = TYPE_BYTES[type]
	if (size <= 4) c.write(address, Number(value) >>> 0, size)
	else if (size === 8) c.writeWide(address, BigInt.asUintN(64, BigInt(value)))
	else { c.writeWide(address, BigInt.asUintN(64, BigInt(value))); c.writeWide(address + 8, BigInt.asUintN(64, BigInt(value) >> 64n)) }
}

export function reset(c: CpuContext, model: Model) {
	c.r.fill(0)
	c.r[SP] = c.memory.length
	c.r[PSL] = RESET_PSL
	c.writeState(64, SIDS[model])
}
export const STATE_WORDS = 65
