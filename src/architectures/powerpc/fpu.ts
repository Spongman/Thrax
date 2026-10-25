import type { CpuContext, CpuEncodingContext, CpuInstruction } from '../../core/configuredCpu'
import { BinaryException as E, binaryInfinity, binaryInteger, binaryNegate, binaryZero, calculateBinary, compareBinary, integerBinary, packBinary, sqrtBinary, unpackBinary, type BinaryFloat, type BinaryFormat, type BinaryResult, type BinaryRounding } from '../../core/binaryFloat'

/** f0-f31 occupy two native words each (high, low) after the 36 integer words; FPSCR follows. */
export const FPR = 36, FPSCR = 100, fpuWords = 65
const CR = 32

// FPSCR bits, PowerPC numbering (bit 0 is the MSB).
export const FX = 0x80000000, FEX = 0x40000000, VX = 0x20000000, OX = 0x10000000, UX = 0x08000000, ZX = 0x04000000, XX = 0x02000000
export const VXSNAN = 0x01000000, VXISI = 0x00800000, VXIDI = 0x00400000, VXZDZ = 0x00200000, VXIMZ = 0x00100000, VXVC = 0x00080000
export const FR = 0x00040000, FI = 0x00020000, FPRF = 0x0001f000, VXSOFT = 0x400, VXSQRT = 0x200, VXCVI = 0x100
export const VE = 0x80, OE = 0x40, UE = 0x20, ZE = 0x10, XE = 0x8
const VX_ALL = VXSNAN | VXISI | VXIDI | VXZDZ | VXIMZ | VXVC | VXSOFT | VXSQRT | VXCVI
const STICKY = OX | UX | ZX | XX | VX_ALL
/** FPRF class codes (C, FL, FG, FE, FU). */
export const CLASS = { qnan: 0x11, negativeInfinity: 0x09, negativeNormal: 0x08, negativeDenormal: 0x18, negativeZero: 0x12, positiveZero: 0x02, positiveDenormal: 0x14, positiveNormal: 0x04, positiveInfinity: 0x05 } as const
/** Architecturally undefined high word of MFFS and FCTIW results. */
export const UNDEFINED_HIGH = 0xfff80000

const DOUBLE: BinaryFormat = { precision: 53, minExponent: -1022, maxExponent: 1023 }
const SINGLE: BinaryFormat = { precision: 24, minExponent: -126, maxExponent: 127 }
const ROUNDING: readonly BinaryRounding[] = ['nearest', 'zero', 'up', 'down']
const SIGN = 1n << 63n, QUIET = 1n << 51n, FRACTION = (1n << 52n) - 1n, DEFAULT_NAN = 0x7ff8000000000000n

/** VX and FEX are summaries, never stored independently; bit 20 is reserved. */
export function fpscrSummary(value: number): number {
	let f = value & ~(FEX | VX | 0x800)
	if (f & VX_ALL) f |= VX
	if ((f >>> 22) & f & 0xf8) f |= FEX
	return f >>> 0
}
/** Set sticky exception bits; FX records any that change from 0 to 1. */
function raise(c: CpuContext, flags: number) {
	const old = c.r[FPSCR]
	c.r[FPSCR] = fpscrSummary(old | flags | (flags & STICKY & ~old ? FX : 0))
}
export function getF(c: CpuContext | { r: Uint32Array }, n: number): bigint { return BigInt(c.r[FPR + 2 * n]) << 32n | BigInt(c.r[FPR + 2 * n + 1]) }
export function setF(c: CpuContext | { r: Uint32Array }, n: number, bits: bigint) { c.r[FPR + 2 * n] = Number(bits >> 32n & 0xffffffffn); c.r[FPR + 2 * n + 1] = Number(bits & 0xffffffffn) }
const isNaN = (b: bigint) => (b >> 52n & 0x7ffn) === 0x7ffn && (b & FRACTION) !== 0n
const isSNaN = (b: bigint) => isNaN(b) && !(b & QUIET)
const unpack = (b: bigint) => unpackBinary(b, 52, 11)
const top = (v: BinaryFloat) => v.significand.toString(2).length - 1 + v.exponent
export function classOf(b: bigint): number {
	const negative = b >> 63n === 1n, exponent = Number(b >> 52n & 0x7ffn), fraction = b & FRACTION
	if (exponent === 0x7ff) return fraction ? CLASS.qnan : negative ? CLASS.negativeInfinity : CLASS.positiveInfinity
	if (exponent === 0) return fraction ? negative ? CLASS.negativeDenormal : CLASS.positiveDenormal : negative ? CLASS.negativeZero : CLASS.positiveZero
	return negative ? CLASS.negativeNormal : CLASS.positiveNormal
}
/** Update FR, FI and optionally FPRF, then raise exception bits. */
function status(c: CpuContext, flags: number, fr: boolean, fi: boolean, fprf?: number) {
	c.r[FPSCR] = c.r[FPSCR] & ~(FR | FI | (fprf === undefined ? 0 : FPRF)) | (fr ? FR : 0) | (fi ? FI : 0) | (fprf ?? 0) << 12
	raise(c, flags)
}
/** QNaN result: a propagated operand (quieted) or the default NaN, unless VE suppresses it. */
function nanResult(c: CpuContext, d: number, flags: number, single: boolean, operand?: bigint) {
	status(c, flags, false, false)
	if (flags && c.r[FPSCR] & VE) return
	let bits = operand === undefined ? DEFAULT_NAN : operand | QUIET
	if (single) bits &= ~((1n << 29n) - 1n)
	setF(c, d, bits); status(c, 0, false, false, CLASS.qnan)
}
type Rounded = (format: BinaryFormat, mode: BinaryRounding) => BinaryResult
/** Round an exact operation once; OE/UE enabled results are exponent-adjusted as the architecture requires. */
function deliver(c: CpuContext, d: number, single: boolean, op: Rounded, negate = false) {
	const f = c.r[FPSCR], mode = ROUNDING[f & 3], format = single ? SINGLE : DOUBLE, adjust = single ? 192 : 1536
	let result = op(format, mode), flags: number
	const scale = (r: BinaryResult, by: number): BinaryResult => ({ ...r, value: { ...r.value, exponent: r.value.exponent + by } })
	const wideLow = () => op({ ...format, minExponent: format.minExponent - 4 * adjust }, mode)
	if (result.flags & E.overflow && f & OE) {
		result = scale(op({ ...format, maxExponent: format.maxExponent + 4 * adjust }, mode), -adjust)
		flags = OX | (result.flags & E.inexact ? XX : 0)
	} else if (f & UE && (() => { const w = wideLow().value; return !w.special && w.significand !== 0n && top(w) < format.minExponent })()) {
		result = scale(wideLow(), adjust)
		flags = UX | (result.flags & E.inexact ? XX : 0)
	} else flags = (result.flags & E.overflow ? OX : 0) | (result.flags & E.underflow ? UX : 0) | (result.flags & E.inexact ? XX : 0)
	const bits = packBinary(negate ? binaryNegate(result.value) : result.value, 52, 11)
	setF(c, d, bits)
	status(c, flags, result.roundedUp, !!(flags & XX), classOf(bits))
}
function zeroDivide(c: CpuContext, d: number, negative: boolean) {
	status(c, ZX, false, false)
	if (c.r[FPSCR] & ZE) return
	const bits = packBinary(binaryInfinity(negative), 52, 11)
	setF(c, d, bits); status(c, 0, false, false, classOf(bits))
}
const infinite = (v: BinaryFloat) => v.special === 'infinity', zero = (v: BinaryFloat) => !v.special && v.significand === 0n

type Arithmetic = 'add' | 'sub' | 'mul' | 'div' | 'madd' | 'msub' | 'nmadd' | 'nmsub' | 'sqrt' | 'res' | 'rsqrte' | 'rsp'
/** Execute one arithmetic form; `a`, `b`, `cc` are FPR numbers in NaN-precedence order A, B, C. */
function arithmetic(c: CpuContext, kind: Arithmetic, d: number, a: number, b: number, cc: number, single: boolean) {
	const used = kind === 'add' || kind === 'sub' || kind === 'div' ? [a, b] : kind === 'mul' ? [a, cc] : kind.endsWith('add') || kind.endsWith('sub') ? [a, b, cc] : [b]
	const raw = used.map(n => getF(c, n)), nan = raw.find(isNaN)
	if (nan !== undefined) return nanResult(c, d, raw.some(isSNaN) ? VXSNAN : 0, single || kind === 'rsp', nan)
	const [va, vb, vc] = [a, b, cc].map(n => unpack(getF(c, n)))
	const invalid = (flags: number) => nanResult(c, d, flags, single)
	switch (kind) {
		case 'add': case 'sub': {
			const right = kind === 'sub' ? binaryNegate(vb) : vb
			if (infinite(va) && infinite(right) && va.negative !== right.negative) return invalid(VXISI)
			return deliver(c, d, single, (format, mode) => calculateBinary('add', va, right, format, mode))
		}
		case 'mul':
			if (infinite(va) && zero(vc) || zero(va) && infinite(vc)) return invalid(VXIMZ)
			return deliver(c, d, single, (format, mode) => calculateBinary('multiply', va, vc, format, mode))
		case 'div':
			if (zero(va) && zero(vb)) return invalid(VXZDZ)
			if (infinite(va) && infinite(vb)) return invalid(VXIDI)
			if (zero(vb) && !infinite(va)) return zeroDivide(c, d, va.negative !== vb.negative)
			return deliver(c, d, single, (format, mode) => calculateBinary('divide', va, vb, format, mode))
		case 'sqrt': case 'rsqrte':
			if (vb.negative && !zero(vb)) return invalid(VXSQRT)
			if (kind === 'sqrt') return deliver(c, d, single, (format, mode) => sqrtBinary(vb, format, mode))
			if (zero(vb)) return zeroDivide(c, d, vb.negative)
			// An estimate: this delivers the reciprocal of a 128-bit root, rounded once more.
			return deliver(c, d, false, (format, mode) => calculateBinary('divide', binaryInteger(1n), sqrtBinary(vb, { precision: 128, minExponent: -1e5, maxExponent: 1e5 }).value, format, mode))
		case 'res':
			if (zero(vb)) return zeroDivide(c, d, vb.negative)
			return deliver(c, d, true, (format, mode) => calculateBinary('divide', binaryInteger(1n), vb, format, mode))
		case 'rsp': return deliver(c, d, true, (format, mode) => calculateBinary('add', vb, binaryZero(vb.negative), format, mode))
		default: {
			if (infinite(va) && zero(vc) || zero(va) && infinite(vc)) return invalid(VXIMZ)
			const negative = va.negative !== vc.negative, addend = kind.endsWith('sub') ? binaryNegate(vb) : vb
			const product: BinaryFloat = infinite(va) || infinite(vc) ? binaryInfinity(negative) : { negative, significand: va.significand * vc.significand, exponent: va.exponent + vc.exponent }
			if (infinite(product) && infinite(addend) && product.negative !== addend.negative) return invalid(VXISI)
			return deliver(c, d, single, (format, mode) => calculateBinary('add', product, addend, format, mode), kind.startsWith('n'))
		}
	}
}
/** FCTIW/FCTIWZ: saturate to a signed word in the low half. */
function convert(c: CpuContext, d: number, b: number, truncate: boolean) {
	const raw = getF(c, b), value = unpack(raw), f = c.r[FPSCR]
	const rounded = isNaN(raw) ? null : integerBinary(value, truncate ? 'zero' : ROUNDING[f & 3])
	const saturated = (word: number) => { status(c, VXCVI | (isSNaN(raw) ? VXSNAN : 0), false, false); if (!(c.r[FPSCR] & VE)) setF(c, d, BigInt(UNDEFINED_HIGH) << 32n | BigInt(word)) }
	if (!rounded) return saturated(value.special === 'infinity' && !value.negative ? 0x7fffffff : 0x80000000)
	if (rounded.value > 0x7fffffffn) return saturated(0x7fffffff)
	if (rounded.value < -0x80000000n) return saturated(0x80000000)
	setF(c, d, BigInt(UNDEFINED_HIGH) << 32n | BigInt.asUintN(32, rounded.value))
	status(c, rounded.inexact ? XX : 0, rounded.roundedUp, rounded.inexact)
}
/** FCMPU/FCMPO set the selected CR field and FPCC. */
function compare(c: CpuContext, field: number, a: number, b: number, ordered: boolean) {
	const ra = getF(c, a), rb = getF(c, b), relation = compareBinary(unpack(ra), unpack(rb))
	const cc = relation === null ? 1 : relation < 0 ? 8 : relation > 0 ? 4 : 2
	c.r[FPSCR] = c.r[FPSCR] & ~0xf000 | cc << 12
	const shift = (7 - field) * 4
	c.r[CR] = c.r[CR] & ~(15 << shift) | cc << shift
	const signaling = isSNaN(ra) || isSNaN(rb)
	if (signaling) raise(c, VXSNAN | (ordered && !(c.r[FPSCR] & VE) ? VXVC : 0))
	else if (ordered && relation === null) raise(c, VXVC)
}
/** LFS: exact single-to-double conversion; NaN payloads (and signaling state) are preserved. */
export function singleToDouble(word: number): bigint {
	const w = word >>> 0
	if ((w >>> 23 & 255) === 255) return BigInt(w >>> 31) << 63n | 0x7ffn << 52n | BigInt(w & 0x7fffff) << 29n
	return packBinary(unpackBinary(BigInt(w), 23, 8), 52, 11)
}
/** STFS: the manual's bit-selection and denormalization algorithm; no rounding. */
export function doubleToSingle(bits: bigint): number {
	const exponent = Number(bits >> 52n & 0x7ffn)
	if (exponent > 896 || !(bits & ~SIGN)) return Number(bits >> 32n & 0xc0000000n | bits >> 29n & 0x3fffffffn) >>> 0
	let fraction = 1n << 52n | bits & FRACTION, e = exponent - 1023
	while (e < -126) { fraction >>= 1n; e++ }
	return Number(bits >> 32n & 0x80000000n | fraction >> 29n & 0x7fffffn) >>> 0
}
function recordCr1(c: CpuContext) { c.r[CR] = c.r[CR] & ~(15 << 24) | (c.r[FPSCR] >>> 28) << 24 }

// Assembly tables.
const aForms: Record<string, [number, string]> = { fdiv: [18, 'AB'], fsub: [20, 'AB'], fadd: [21, 'AB'], fsqrt: [22, 'B'], fsel: [23, 'ACB'], fres: [24, 'B'], fmul: [25, 'AC'], frsqrte: [26, 'B'], fmsub: [28, 'ACB'], fmadd: [29, 'ACB'], fnmsub: [30, 'ACB'], fnmadd: [31, 'ACB'] }
const singles = ['fdiv', 'fsub', 'fadd', 'fsqrt', 'fmul', 'fmsub', 'fmadd', 'fnmsub', 'fnmadd']
const aNames: Record<string, [number, number, string]> = Object.fromEntries([
	...Object.entries(aForms).filter(([name]) => name !== 'fres').map(([name, [xo, form]]) => [name, [63, xo, form]]),
	...singles.map(name => [`${name}s`, [59, aForms[name][0], aForms[name][1]]]), ['fres', [59, 24, 'B']],
])
const xMoves: Record<string, number> = { frsp: 12, fctiw: 14, fctiwz: 15, fneg: 40, fmr: 72, fnabs: 136, fabs: 264 }
const floatMemory: Record<string, number> = { lfs: 48, lfsu: 49, lfd: 50, lfdu: 51, stfs: 52, stfsu: 53, stfd: 54, stfdu: 55 }
const floatIndexed: Record<string, number> = { lfsx: 535, lfsux: 567, lfdx: 599, lfdux: 631, stfsx: 663, stfsux: 695, stfdx: 727, stfdux: 759, stfiwx: 983 }
const recordable = [...Object.keys(aNames), ...Object.keys(xMoves), 'mffs', 'mtfsf', 'mtfsfi', 'mtfsb0', 'mtfsb1']
export const floatInstructions = [...recordable, ...recordable.map(name => `${name}.`), 'fcmpu', 'fcmpo', 'mcrfs', ...Object.keys(floatMemory), ...Object.keys(floatIndexed)]

function number(text: string, prefix: string, max: number, what: string): number {
	const match = new RegExp(`^(?:${prefix})?(\\d+)$`, 'i').exec(text.trim())
	if (!match || +match[1] > max) throw new Error(`Expected ${what}, got ${text}`)
	return +match[1]
}
const fpr = (text: string) => number(text, 'f', 31, 'a PowerPC floating-point register f0–f31')
const gpr = (text: string) => number(text, 'r', 31, 'a PowerPC register r0–r31')
const crField = (text: string) => number(text, 'cr', 7, 'a CR field cr0–cr7')
function immediate(text: string, c: CpuEncodingContext, max: number, what: string) {
	const value = c.value(text)
	if (!Number.isInteger(value) || value < 0 || value > max) throw new Error(`${what} must be 0 through ${max}`)
	return value
}

/** Encode a floating-point mnemonic, or return null for any other. */
export function encodeFloat(mnemonic: string, o: readonly string[], c: CpuEncodingContext): number | null {
	if (!floatInstructions.includes(mnemonic)) return null
	const record = mnemonic.endsWith('.'), m = record ? mnemonic.slice(0, -1) : mnemonic, rc = +record
	const count = (n: number) => { if (o.length !== n) throw new Error(`${mnemonic} expects ${n} operands`) }
	if (m in aNames) {
		const [op, xo, form] = aNames[m]
		count(form.length + 1)
		const field = (letter: string) => form.includes(letter) ? fpr(o[1 + form.indexOf(letter)]) : 0
		return (op << 26 | fpr(o[0]) << 21 | field('A') << 16 | field('B') << 11 | field('C') << 6 | xo << 1 | rc) >>> 0
	}
	if (m in xMoves) { count(2); return (63 << 26 | fpr(o[0]) << 21 | fpr(o[1]) << 11 | xMoves[m] << 1 | rc) >>> 0 }
	if (m in floatMemory) {
		count(2)
		const match = /^(.*?)\(([^()]+)\)$/.exec(o[1])
		if (!match) throw new Error('Expected displacement(rA)')
		const displacement = c.value(match[1] || '0'), base = gpr(match[2])
		if (!Number.isInteger(displacement) || displacement < -32768 || displacement > 32767) throw new Error('Displacement must be -32768 through 32767')
		if (floatMemory[m] & 1 && !base) throw new Error('Invalid update address register')
		return (floatMemory[m] << 26 | fpr(o[0]) << 21 | base << 16 | displacement & 65535) >>> 0
	}
	if (m in floatIndexed) {
		count(3)
		const base = gpr(o[1])
		if (m.endsWith('ux') && !base) throw new Error('Invalid update address register')
		return (31 << 26 | fpr(o[0]) << 21 | base << 16 | gpr(o[2]) << 11 | floatIndexed[m] << 1) >>> 0
	}
	if (m === 'fcmpu' || m === 'fcmpo') { count(3); return (63 << 26 | crField(o[0]) << 23 | fpr(o[1]) << 16 | fpr(o[2]) << 11 | (m === 'fcmpo' ? 32 : 0) << 1) >>> 0 }
	if (m === 'mffs') { count(1); return (63 << 26 | fpr(o[0]) << 21 | 583 << 1 | rc) >>> 0 }
	if (m === 'mcrfs') { count(2); return (63 << 26 | crField(o[0]) << 23 | crField(o[1]) << 18 | 64 << 1) >>> 0 }
	if (m === 'mtfsfi') { count(2); return (63 << 26 | crField(o[0]) << 23 | immediate(o[1], c, 15, 'IMM') << 12 | 134 << 1 | rc) >>> 0 }
	if (m === 'mtfsf') { count(2); return (63 << 26 | immediate(o[0], c, 255, 'FM') << 17 | fpr(o[1]) << 11 | 711 << 1 | rc) >>> 0 }
	count(1)
	return (63 << 26 | immediate(o[0], c, 31, 'FPSCR bit') << 21 | (m === 'mtfsb0' ? 70 : 38) << 1 | rc) >>> 0
}

const kinds: Record<string, Arithmetic> = { fadd: 'add', fsub: 'sub', fmul: 'mul', fdiv: 'div', fmadd: 'madd', fmsub: 'msub', fnmadd: 'nmadd', fnmsub: 'nmsub', fsqrt: 'sqrt', fres: 'res', frsqrte: 'rsqrte' }
const byOpXo = (op: number, xo: number) => Object.keys(aNames).find(name => aNames[name][0] === op && aNames[name][1] === xo)

/** Decode a floating-point word, or return null for any other. */
export function decodeFloat(word: number): CpuInstruction | null {
	const op = word >>> 26, t = word >>> 21 & 31, a = word >>> 16 & 31, b = word >>> 11 & 31, cc = word >>> 6 & 31, xo = word >>> 1 & 1023, record = !!(word & 1), dot = record ? '.' : ''
	const reads: string[] = [], writes: string[] = []
	const make = (text: string, execute: (cpu: CpuContext) => void, kind: CpuInstruction['kind'] = 'alu'): CpuInstruction => {
		if (record) { reads.push('fpscr'); writes.push('cr') }
		return { size: 4, text, kind, reads, writes, execute: record ? cpu => { execute(cpu); recordCr1(cpu) } : execute }
	}
	const f = (n: number) => `f${n}`, r = (n: number) => `r${n}`
	if (op >= 48 && op <= 55) {
		const name = Object.keys(floatMemory).find(n => floatMemory[n] === op)!, store = op >= 52, double = !!(op & 2), update = !!(op & 1), displacement = word << 16 >> 16
		if (update && !a) throw new Error('Invalid PowerPC update address register')
		if (a) reads.push(r(a))
		if (store) reads.push(f(t)); else writes.push(f(t))
		if (update) writes.push(r(a))
		return make(`${name} ${f(t)}, ${displacement}(${r(a)})`, cpu => transfer(cpu, ((a ? cpu.r[a] : 0) + displacement) >>> 0, t, store, double, update ? a : 0), store ? 'store' : 'load')
	}
	if (op === 31) {
		const name = Object.keys(floatIndexed).find(n => floatIndexed[n] === xo)
		if (!name) return null
		const store = name.startsWith('st'), update = name.endsWith('ux')
		if (update && !a) throw new Error('Invalid PowerPC update address register')
		if (a) reads.push(r(a))
		reads.push(r(b))
		if (store) reads.push(f(t)); else writes.push(f(t))
		if (update) writes.push(r(a))
		return { size: 4, kind: store ? 'store' : 'load', reads, writes, text: `${name} ${f(t)}, ${r(a)}, ${r(b)}`, execute: cpu => {
			const ea = ((a ? cpu.r[a] : 0) + cpu.r[b]) >>> 0
			if (name === 'stfiwx') { aligned(ea); cpu.write(ea, cpu.r[FPR + 2 * t + 1], 4, false) } else transfer(cpu, ea, t, store, name.startsWith('lfd') || name.startsWith('stfd'), update ? a : 0)
		} }
	}
	if (op !== 59 && op !== 63) return null
	const fpscrIO = () => { reads.push('fpscr'); writes.push('fpscr') }
	if ((xo & 31) >= 18) {
		const name = byOpXo(op, xo & 31)
		if (!name) return null
		const form = aNames[name][2], single = op === 59, base = single && name !== 'fres' ? name.slice(0, -1) : name
		const operands = [f(t), ...[...form].map(letter => f(letter === 'A' ? a : letter === 'B' ? b : cc))]
		reads.push(...operands.slice(1)); writes.push(f(t))
		if (name === 'fsel') return make(`${name}${dot} ${operands.join(', ')}`, cpu => { const value = getF(cpu, a), take = !isNaN(value) && (value === SIGN || !(value & SIGN)); setF(cpu, t, getF(cpu, take ? cc : b)) })
		fpscrIO()
		return make(`${name}${dot} ${operands.join(', ')}`, cpu => arithmetic(cpu, kinds[base], t, a, b, cc, single))
	}
	if (op === 59) return null
	const move = Object.keys(xMoves).find(n => xMoves[n] === xo)
	if (move) {
		reads.push(f(b)); writes.push(f(t))
		if (['frsp', 'fctiw', 'fctiwz'].includes(move)) fpscrIO()
		return make(`${move}${dot} ${f(t)}, ${f(b)}`, cpu => {
			const value = getF(cpu, b)
			if (move === 'frsp') arithmetic(cpu, 'rsp', t, 0, b, 0, true)
			else if (move === 'fctiw' || move === 'fctiwz') convert(cpu, t, b, move === 'fctiwz')
			else setF(cpu, t, move === 'fmr' ? value : move === 'fneg' ? value ^ SIGN : move === 'fabs' ? value & ~SIGN : value | SIGN)
		})
	}
	if (xo === 0 || xo === 32) {
		reads.push(f(a), f(b)); fpscrIO(); writes.push('cr')
		return { size: 4, kind: 'alu', reads, writes, text: `${xo ? 'fcmpo' : 'fcmpu'} cr${t >>> 2}, ${f(a)}, ${f(b)}`, execute: cpu => compare(cpu, t >>> 2, a, b, !!xo) }
	}
	if (xo === 583) { reads.push('fpscr'); writes.push(f(t)); return make(`mffs${dot} ${f(t)}`, cpu => setF(cpu, t, BigInt(UNDEFINED_HIGH) << 32n | BigInt(cpu.r[FPSCR]))) }
	if (xo === 64) {
		fpscrIO(); writes.push('cr')
		return { size: 4, kind: 'alu', reads, writes, text: `mcrfs cr${t >>> 2}, cr${a >>> 2}`, execute: cpu => {
			const shift = (7 - (a >>> 2)) * 4, field = cpu.r[FPSCR] >>> shift & 15, crShift = (7 - (t >>> 2)) * 4
			cpu.r[CR] = cpu.r[CR] & ~(15 << crShift) | field << crShift
			cpu.r[FPSCR] = fpscrSummary(cpu.r[FPSCR] & ~((FX | STICKY) & 15 << shift))
		} }
	}
	if (xo === 134 || xo === 711 || xo === 70 || xo === 38) {
		fpscrIO()
		if (xo === 711) reads.push(f(b))
		const fm = word >>> 17 & 255
		const text = xo === 134 ? `mtfsfi${dot} ${t >>> 2}, ${word >>> 12 & 15}` : xo === 711 ? `mtfsf${dot} ${fm}, ${f(b)}` : `mtfsb${xo === 70 ? 0 : 1}${dot} ${t}`
		return make(text, cpu => {
			const old = cpu.r[FPSCR]
			if (xo === 70) cpu.r[FPSCR] = fpscrSummary(old & ~(1 << 31 - t))
			else if (xo === 38) { const bit = 1 << 31 - t >>> 0; cpu.r[FPSCR] = fpscrSummary(old | bit | (bit & STICKY & ~old ? FX : 0)) }
			else {
				// Field 0 takes FX and OX explicitly; FEX and VX remain summaries.
				let mask = 0
				const fields = xo === 134 ? 1 << 7 - (t >>> 2) : fm
				for (let i = 0; i < 8; i++) if (fields & 1 << 7 - i) mask |= 15 << (7 - i) * 4
				const value = xo === 134 ? (word >>> 12 & 15) * 0x11111111 : cpu.r[FPR + 2 * b + 1]
				cpu.r[FPSCR] = fpscrSummary(old & ~mask | value & mask)
			}
		})
	}
	return null
}
function aligned(ea: number) { if (ea & 3) throw new Error('Floating-point access is not word aligned') }
function transfer(cpu: CpuContext, ea: number, t: number, store: boolean, double: boolean, update: number) {
	aligned(ea)
	if (store) {
		if (double) { cpu.write(ea, cpu.r[FPR + 2 * t], 4, false); cpu.write(ea + 4, cpu.r[FPR + 2 * t + 1], 4, false) }
		else cpu.write(ea, doubleToSingle(getF(cpu, t)), 4, false)
	} else setF(cpu, t, double ? BigInt(cpu.read(ea, 4, false)) << 32n | BigInt(cpu.read(ea + 4, 4, false)) : singleToDouble(cpu.read(ea, 4, false)))
	if (update) cpu.r[update] = ea
}
