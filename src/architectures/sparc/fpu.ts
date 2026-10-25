import { BinaryException, binaryInteger, calculateBinary, compareBinary, integerBinary, packBinary, roundBinary, sqrtBinary, unpackBinary, type BinaryFormat, type BinaryResult, type BinaryRounding } from '../../core/binaryFloat'

/** Native register columns: %f0-%f31 then FSR, after the integer and control columns. */
export const F0 = 36, FSR = 68
/** FSR bits LDFSR and debugger edits may change: RD, TEM, NS, fcc, aexc and cexc. ver, ftt and qne stay zero. */
export const FSR_WRITABLE = 0xcfc00fff
export const NV = 16, OF = 8, UF = 4, DZ = 2, NX = 1
export const FTT = ['none', 'IEEE_754_exception', 'unfinished_FPop', 'unimplemented_FPop', 'sequence_error', 'hardware_error', 'invalid_fp_register']

export interface Precision { fraction: number, exponent: number, format: BinaryFormat, nan: bigint }
export const SINGLE: Precision = { fraction: 23, exponent: 8, format: { precision: 24, minExponent: -126, maxExponent: 127 }, nan: 0x7fffffffn }
export const DOUBLE: Precision = { fraction: 52, exponent: 11, format: { precision: 53, minExponent: -1022, maxExponent: 1023 }, nan: 0x7fffffffffffffffn }

/** An FPop result before the trap check: raw bits for rd, or an fcc for a compare. */
export interface FpResult { raw: bigint, cexc: number }

const ROUNDING: readonly BinaryRounding[] = ['nearest', 'zero', 'up', 'down']
export const rounding = (fsr: number) => ROUNDING[fsr >>> 30]

export function fpFault(ftt: number, detail: string): never {
	throw new Error(`SPARC fp_exception (ftt=${FTT[ftt]}): ${detail}; no trap handler is modeled`)
}

const exponentMask = (p: Precision) => (1n << BigInt(p.exponent)) - 1n
const fractionOf = (raw: bigint, p: Precision) => raw & ((1n << BigInt(p.fraction)) - 1n)
const quietBit = (p: Precision) => 1n << BigInt(p.fraction - 1)
const signBit = (p: Precision) => 1n << BigInt(p.fraction + p.exponent)
export const isNaNBits = (raw: bigint, p: Precision) => (raw >> BigInt(p.fraction) & exponentMask(p)) === exponentMask(p) && fractionOf(raw, p) !== 0n
export const isSignaling = (raw: bigint, p: Precision) => isNaNBits(raw, p) && !(raw & quietBit(p))

function cexcOf(flags: number) {
	return (flags & BinaryException.invalid ? NV : 0) | (flags & BinaryException.overflow ? OF : 0) | (flags & BinaryException.underflow ? UF : 0) | (flags & BinaryException.zeroDivide ? DZ : 0) | (flags & BinaryException.inexact ? NX : 0)
}

/** Quiet a NaN and move its payload between formats (V8 Appendix N). */
function convertNaN(raw: bigint, from: Precision, to: Precision): bigint {
	const shift = to.fraction - from.fraction, fraction = fractionOf(raw, from)
	const payload = shift >= 0 ? fraction << BigInt(shift) : fraction >> BigInt(-shift)
	return (raw & signBit(from) ? signBit(to) : 0n) | exponentMask(to) << BigInt(to.fraction) | payload | quietBit(to)
}

/** NaN operand precedence: SNaN2, SNaN1, QNaN2, QNaN1; any SNaN signals invalid. */
function propagate(a: bigint | null, b: bigint, from: Precision, to: Precision): FpResult | null {
	const nanA = a !== null && isNaNBits(a, from), nanB = isNaNBits(b, from)
	if (!nanA && !nanB) return null
	const cexc = isSignaling(b, from) || a !== null && isSignaling(a, from) ? NV : 0
	const pick = isSignaling(b, from) ? b : a !== null && isSignaling(a, from) ? a : nanB ? b : a!
	return { raw: convertNaN(pick, from, to), cexc }
}

function packed(result: BinaryResult, p: Precision, trapUnderflow: boolean): FpResult {
	if (result.value.special === 'nan') return { raw: p.nan, cexc: cexcOf(result.flags) }
	const raw = packBinary(result.value, p.fraction, p.exponent)
	// With UFM set, tininess alone signals underflow, even when exact.
	const tiny = trapUnderflow && (raw >> BigInt(p.fraction) & exponentMask(p)) === 0n && fractionOf(raw, p) !== 0n
	return { raw, cexc: cexcOf(result.flags) | (tiny ? UF : 0) }
}

const unpack = (raw: bigint, p: Precision) => unpackBinary(raw, p.fraction, p.exponent)

export function arithmetic(operation: 'add' | 'sub' | 'mul' | 'div', a: bigint, b: bigint, p: Precision, fsr: number): FpResult {
	const nan = propagate(a, b, p, p)
	if (nan) return nan
	const right = unpack(b, p)
	if (operation === 'sub') right.negative = !right.negative
	const op = operation === 'mul' ? 'multiply' : operation === 'div' ? 'divide' : 'add'
	return packed(calculateBinary(op, unpack(a, p), right, p.format, rounding(fsr)), p, !!(fsr & UF << 23))
}

/** FSMULD: the exact double product of two singles. */
export function multiplyWiden(a: bigint, b: bigint): FpResult {
	const nan = propagate(a, b, SINGLE, DOUBLE)
	if (nan) return nan
	return packed(calculateBinary('multiply', unpack(a, SINGLE), unpack(b, SINGLE), DOUBLE.format), DOUBLE, false)
}

export function squareRoot(a: bigint, p: Precision, fsr: number): FpResult {
	const nan = propagate(null, a, p, p)
	if (nan) return nan
	return packed(sqrtBinary(unpack(a, p), p.format, rounding(fsr)), p, false)
}

export function fromInteger(value: number, p: Precision, fsr: number): FpResult {
	const v = binaryInteger(BigInt(value | 0))
	return packed(roundBinary(v.negative, v.significand, 0, 1n, p.format, rounding(fsr)), p, false)
}

/** FsTOi/FdTOi always truncate; invalid operands saturate as V8 Appendix N recommends. */
export function toInteger(raw: bigint, p: Precision): FpResult {
	const negative = !!(raw & signBit(p))
	if (isNaNBits(raw, p)) return { raw: 0x7fffffffn, cexc: NV }
	const result = integerBinary(unpack(raw, p), 'zero')
	if (!result || result.value < -0x80000000n || result.value > 0x7fffffffn) return { raw: negative ? 0x80000000n : 0x7fffffffn, cexc: NV }
	return { raw: BigInt.asUintN(32, result.value), cexc: result.inexact ? NX : 0 }
}

export function convert(raw: bigint, from: Precision, to: Precision, fsr: number): FpResult {
	const nan = propagate(null, raw, from, to)
	if (nan) return nan
	const v = unpack(raw, from)
	if (v.special) return { raw: packBinary(v, to.fraction, to.exponent), cexc: 0 }
	return packed(roundBinary(v.negative, v.significand, v.exponent, 1n, to.format, rounding(fsr)), to, !!(fsr & UF << 23))
}

/** fcc: 0 equal, 1 rs1 < rs2, 2 rs1 > rs2, 3 unordered. FCMPE signals on any NaN. */
export function compare(a: bigint, b: bigint, p: Precision, signalling: boolean): FpResult {
	if (isNaNBits(a, p) || isNaNBits(b, p)) return { raw: 3n, cexc: signalling || isSignaling(a, p) || isSignaling(b, p) ? NV : 0 }
	const order = compareBinary(unpack(a, p), unpack(b, p))
	return { raw: order === 0 ? 0n : order === -1 ? 1n : 2n, cexc: 0 }
}

/** FBfcc conditions as masks over fcc 0-3 (E, L, G, U), in cond-field order. */
export const fbranches = ['fbn', 'fbne', 'fblg', 'fbul', 'fbl', 'fbug', 'fbg', 'fbu', 'fba', 'fbe', 'fbue', 'fbge', 'fbuge', 'fble', 'fbule', 'fbo']
export const fbranchMasks = [0, 14, 6, 10, 2, 12, 4, 8, 15, 1, 9, 5, 13, 3, 11, 7]

/** FPop name: [op3, opf, rs1, rs2, rd] with operand widths in words (0 unused). */
export const fpops: Record<string, readonly [number, number, number, number, number]> = {
	fitos: [0x34, 0xc4, 0, 1, 1], fitod: [0x34, 0xc8, 0, 1, 2], fitoq: [0x34, 0xcc, 0, 1, 4],
	fstoi: [0x34, 0xd1, 0, 1, 1], fdtoi: [0x34, 0xd2, 0, 2, 1], fqtoi: [0x34, 0xd3, 0, 4, 1],
	fstod: [0x34, 0xc9, 0, 1, 2], fstoq: [0x34, 0xcd, 0, 1, 4], fdtos: [0x34, 0xc6, 0, 2, 1],
	fdtoq: [0x34, 0xce, 0, 2, 4], fqtos: [0x34, 0xc7, 0, 4, 1], fqtod: [0x34, 0xcb, 0, 4, 2],
	fmovs: [0x34, 0x01, 0, 1, 1], fnegs: [0x34, 0x05, 0, 1, 1], fabss: [0x34, 0x09, 0, 1, 1],
	fsqrts: [0x34, 0x29, 0, 1, 1], fsqrtd: [0x34, 0x2a, 0, 2, 2], fsqrtq: [0x34, 0x2b, 0, 4, 4],
	fadds: [0x34, 0x41, 1, 1, 1], faddd: [0x34, 0x42, 2, 2, 2], faddq: [0x34, 0x43, 4, 4, 4],
	fsubs: [0x34, 0x45, 1, 1, 1], fsubd: [0x34, 0x46, 2, 2, 2], fsubq: [0x34, 0x47, 4, 4, 4],
	fmuls: [0x34, 0x49, 1, 1, 1], fmuld: [0x34, 0x4a, 2, 2, 2], fmulq: [0x34, 0x4b, 4, 4, 4],
	fdivs: [0x34, 0x4d, 1, 1, 1], fdivd: [0x34, 0x4e, 2, 2, 2], fdivq: [0x34, 0x4f, 4, 4, 4],
	fsmuld: [0x34, 0x69, 1, 1, 2], fdmulq: [0x34, 0x6e, 2, 2, 4],
	fcmps: [0x35, 0x51, 1, 1, 0], fcmpd: [0x35, 0x52, 2, 2, 0], fcmpq: [0x35, 0x53, 4, 4, 0],
	fcmpes: [0x35, 0x55, 1, 1, 0], fcmped: [0x35, 0x56, 2, 2, 0], fcmpeq: [0x35, 0x57, 4, 4, 0],
}
export const fpopByCode = new Map(Object.entries(fpops).map(([name, spec]) => [spec[0] << 9 | spec[1], name]))
/** Floating-point memory op3 values. */
export const fpMemory: Record<string, number> = { ldf: 0x20, ldfsr: 0x21, lddf: 0x23, stf: 0x24, stfsr: 0x25, stdfq: 0x26, stdf: 0x27 }

export function fpRegister(text: string, width = 1): number {
	const m = /^%?f(\d+)$/i.exec(text.trim())
	const n = m ? Number(m[1]) : -1
	if (n < 0 || n > 31) throw new Error(`Expected a SPARC floating-point register, got ${text}`)
	if (n % width) throw new Error(`${width === 2 ? 'Double' : 'Quad'}-precision operands require a %f register number divisible by ${width}`)
	return n
}
export const isFpRegister = (text: string) => /^%?f\d+$/i.test(text.trim())
