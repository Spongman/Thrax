/**
 * Arm floating point after the shared pseudocode of the Arm ARM (DDI 0487,
 * J1.3: FPUnpack, FPRound, FPProcessNaNs, FPAdd, FPMulAdd, FPToFixed...),
 * used by both the A64 scalar instructions and AArch32 VFP. Values travel
 * as raw bits (bigint); arithmetic is exact on BigInt and rounded once, so
 * every rounding mode, flush-to-zero, default NaN and each cumulative
 * exception flag come out as the hardware's.
 *
 * FPCR (A64) and FPSCR (A32) share the bit positions used here: AHP 26,
 * DN 25, FZ 24, RMode 23:22; and FPSR/FPSCR the flags IDC 7, IXC 4, UFC 3,
 * OFC 2, DZC 1, IOC 0. Exceptions are never trapped.
 */

export interface FpFormat {
	readonly bits: number
	/** Exponent bits. */
	readonly e: number
	/** Fraction bits. */
	readonly f: number
}

export const SINGLE: FpFormat = Object.freeze({ bits: 32, e: 8, f: 23 })
export const DOUBLE: FpFormat = Object.freeze({ bits: 64, e: 11, f: 52 })

/** FPCR / FPSCR control bits. */
export const FPCR_AHP = 1 << 26
export const FPCR_DN = 1 << 25
export const FPCR_FZ = 1 << 24
export const FPCR_RMODE_SHIFT = 22

/** Cumulative exception flags of FPSR / FPSCR. */
export const FPSR_IOC = 1
export const FPSR_DZC = 2
export const FPSR_OFC = 4
export const FPSR_UFC = 8
export const FPSR_IXC = 16
export const FPSR_IDC = 128
export const FPSR_FLAGS = 0x9F

/** Rounding modes: the first four are RMode's encodings. */
export const ROUND_TIEEVEN = 0
export const ROUND_POSINF = 1
export const ROUND_NEGINF = 2
export const ROUND_ZERO = 3
export const ROUND_TIEAWAY = 4

/** Control in, exception flags out; one per instruction. */
export class FpEnv {
	/** Flags raised so far, to be ORed into FPSR. */
	flags = 0
	constructor(public fpcr = 0) {}
	get mode() { return (this.fpcr >>> FPCR_RMODE_SHIFT) & 3 }
	get fz() { return (this.fpcr & FPCR_FZ) !== 0 }
	get dn() { return (this.fpcr & FPCR_DN) !== 0 }
}

/** Kinds of an unpacked operand. */
export const FP_ZERO = 0
export const FP_FINITE = 1
export const FP_INF = 2
export const FP_QNAN = 3
export const FP_SNAN = 4

/** An operand taken apart: `m * 2^e` for a finite nonzero value. */
interface Unpacked {
	type: number
	sign: number
	m: bigint
	e: number
}

const bias = (fmt: FpFormat) => (1 << (fmt.e - 1)) - 1
const maxExponent = (fmt: FpFormat) => (1 << fmt.e) - 1
const fractionMask = (fmt: FpFormat) => (1n << BigInt(fmt.f)) - 1n
const signBit = (fmt: FpFormat) => 1n << BigInt(fmt.bits - 1)
const quietBit = (fmt: FpFormat) => 1n << BigInt(fmt.f - 1)

function bitLength(value: bigint): number {
	return value === 0n ? 0 : value.toString(2).length
}

export const fpZero = (sign: number, fmt: FpFormat) => sign ? signBit(fmt) : 0n
export const fpInfinity = (sign: number, fmt: FpFormat) => fpZero(sign, fmt) | (BigInt(maxExponent(fmt)) << BigInt(fmt.f))
export const fpDefaultNaN = (fmt: FpFormat) => fpInfinity(0, fmt) | quietBit(fmt)
const fpMaxNormal = (sign: number, fmt: FpFormat) => fpZero(sign, fmt) | (BigInt(maxExponent(fmt) - 1) << BigInt(fmt.f)) | fractionMask(fmt)

/** FPNeg and FPAbs: the sign bit alone, NaNs included. */
export const fpNeg = (bits: bigint, fmt: FpFormat) => bits ^ signBit(fmt)
export const fpAbs = (bits: bigint, fmt: FpFormat) => bits & ~signBit(fmt)

/** The kind of `bits`, without flushing: for classification only. */
export function fpType(bits: bigint, fmt: FpFormat): number {
	const exponent = Number((bits >> BigInt(fmt.f)) & BigInt(maxExponent(fmt)))
	const fraction = bits & fractionMask(fmt)
	if (exponent === 0) return fraction === 0n ? FP_ZERO : FP_FINITE
	if (exponent === maxExponent(fmt)) return fraction === 0n ? FP_INF : fraction & quietBit(fmt) ? FP_QNAN : FP_SNAN
	return FP_FINITE
}

/** FPUnpack: a denormal under FZ reads as zero and raises IDC. */
function unpack(bits: bigint, fmt: FpFormat, env: FpEnv): Unpacked {
	const sign = Number((bits >> BigInt(fmt.bits - 1)) & 1n)
	const exponent = Number((bits >> BigInt(fmt.f)) & BigInt(maxExponent(fmt)))
	const fraction = bits & fractionMask(fmt)
	if (exponent === 0) {
		if (fraction === 0n || env.fz) {
			if (fraction !== 0n) env.flags |= FPSR_IDC
			return { type: FP_ZERO, sign, m: 0n, e: 0 }
		}
		return { type: FP_FINITE, sign, m: fraction, e: 1 - bias(fmt) - fmt.f }
	}
	if (exponent === maxExponent(fmt)) {
		const type = fraction === 0n ? FP_INF : fraction & quietBit(fmt) ? FP_QNAN : FP_SNAN
		return { type, sign, m: 0n, e: 0 }
	}
	return { type: FP_FINITE, sign, m: fraction | (1n << BigInt(fmt.f)), e: exponent - bias(fmt) - fmt.f }
}

const isNaN = (type: number) => type === FP_QNAN || type === FP_SNAN

/** FPProcessNaN: a signalling NaN raises IOC and is quietened; DN gives the default NaN. */
function processNaN(type: number, bits: bigint, fmt: FpFormat, env: FpEnv): bigint {
	let result = bits
	if (type === FP_SNAN) {
		result |= quietBit(fmt)
		env.flags |= FPSR_IOC
	}
	return env.dn ? fpDefaultNaN(fmt) : result
}

/** FPProcessNaNs and FPProcessNaNs3: signalling NaNs first, then quiet, in operand order; null when there are none. */
function processNaNs(operands: readonly [Unpacked, bigint][], fmt: FpFormat, env: FpEnv): bigint | null {
	for (const [{ type }, bits] of operands) if (type === FP_SNAN) return processNaN(type, bits, fmt, env)
	for (const [{ type }, bits] of operands) if (type === FP_QNAN) return processNaN(type, bits, fmt, env)
	return null
}

/**
 * FPRound of the nonzero `(-1)^sign * m * 2^e` in `mode`. Tininess is
 * judged before rounding; FZ flushes a tiny result to zero with UFC only.
 * `m` may carry a sticky bit below the rounding point.
 */
export function fpRound(sign: number, m: bigint, e: number, fmt: FpFormat, env: FpEnv, mode = env.mode): bigint {
	const exponent = e + bitLength(m) - 1
	const minimum = 1 - bias(fmt)
	if (env.fz && exponent < minimum) {
		env.flags |= FPSR_UFC
		return fpZero(sign, fmt)
	}
	let biased = Math.max(exponent - minimum + 1, 0)
	// The weight of the result's last place.
	const shift = e - ((biased === 0 ? minimum : exponent) - fmt.f)
	let mantissa: bigint
	// The rounding error against half a unit: -1 below, 0 at, 1 above; `inexact` when nonzero.
	let half = -1
	let inexact = false
	if (shift >= 0) {
		mantissa = m << BigInt(shift)
	} else {
		const drop = BigInt(-shift)
		mantissa = m >> drop
		const rest = m - (mantissa << drop)
		inexact = rest !== 0n
		const halfUnit = 1n << (drop - 1n)
		half = rest > halfUnit ? 1 : rest === halfUnit ? 0 : -1
	}
	if (biased === 0 && inexact) env.flags |= FPSR_UFC
	let roundUp: boolean
	let overflowToInfinity: boolean
	switch (mode) {
		case ROUND_TIEEVEN: roundUp = half > 0 || (half === 0 && (mantissa & 1n) === 1n); overflowToInfinity = true; break
		case ROUND_TIEAWAY: roundUp = half >= 0 && inexact; overflowToInfinity = true; break
		case ROUND_POSINF: roundUp = inexact && sign === 0; overflowToInfinity = sign === 0; break
		case ROUND_NEGINF: roundUp = inexact && sign === 1; overflowToInfinity = sign === 1; break
		default: roundUp = false; overflowToInfinity = false
	}
	if (roundUp) {
		mantissa++
		if (mantissa === 1n << BigInt(fmt.f)) biased = 1
		if (mantissa === 1n << BigInt(fmt.f + 1)) {
			biased++
			mantissa >>= 1n
		}
	}
	let result: bigint
	if (biased >= maxExponent(fmt)) {
		result = overflowToInfinity ? fpInfinity(sign, fmt) : fpMaxNormal(sign, fmt)
		env.flags |= FPSR_OFC | FPSR_IXC
		return result
	}
	result = fpZero(sign, fmt) | (BigInt(biased) << BigInt(fmt.f)) | (mantissa & fractionMask(fmt))
	if (inexact) env.flags |= FPSR_IXC
	return result
}

/** An exact sum's result: a zero takes its sign from the rounding mode. */
function roundSum(m: bigint, e: number, fmt: FpFormat, env: FpEnv): bigint {
	if (m === 0n) return fpZero(env.mode === ROUND_NEGINF ? 1 : 0, fmt)
	return m < 0n ? fpRound(1, -m, e, fmt, env) : fpRound(0, m, e, fmt, env)
}

/** Two signed significands on one exponent. */
function aligned(a: Unpacked, b: Unpacked): [bigint, bigint, number] {
	const e = Math.min(a.e, b.e)
	const x = a.m << BigInt(a.e - e)
	const y = b.m << BigInt(b.e - e)
	return [a.sign ? -x : x, b.sign ? -y : y, e]
}

export function fpAdd(op1: bigint, op2: bigint, fmt: FpFormat, env: FpEnv, subtract = false): bigint {
	const a = unpack(op1, fmt, env)
	const b = unpack(op2, fmt, env)
	const nan = processNaNs([[a, op1], [b, op2]], fmt, env)
	if (nan !== null) return nan
	if (subtract) b.sign ^= 1
	if (a.type === FP_INF && b.type === FP_INF && a.sign !== b.sign) {
		env.flags |= FPSR_IOC
		return fpDefaultNaN(fmt)
	}
	if (a.type === FP_INF) return fpInfinity(a.sign, fmt)
	if (b.type === FP_INF) return fpInfinity(b.sign, fmt)
	if (a.type === FP_ZERO && b.type === FP_ZERO && a.sign === b.sign) return fpZero(a.sign, fmt)
	const [x, y, e] = aligned(a, b)
	return roundSum(x + y, e, fmt, env)
}

export function fpMul(op1: bigint, op2: bigint, fmt: FpFormat, env: FpEnv): bigint {
	const a = unpack(op1, fmt, env)
	const b = unpack(op2, fmt, env)
	const nan = processNaNs([[a, op1], [b, op2]], fmt, env)
	if (nan !== null) return nan
	const sign = a.sign ^ b.sign
	if ((a.type === FP_INF && b.type === FP_ZERO) || (a.type === FP_ZERO && b.type === FP_INF)) {
		env.flags |= FPSR_IOC
		return fpDefaultNaN(fmt)
	}
	if (a.type === FP_INF || b.type === FP_INF) return fpInfinity(sign, fmt)
	if (a.type === FP_ZERO || b.type === FP_ZERO) return fpZero(sign, fmt)
	return fpRound(sign, a.m * b.m, a.e + b.e, fmt, env)
}

export function fpDiv(op1: bigint, op2: bigint, fmt: FpFormat, env: FpEnv): bigint {
	const a = unpack(op1, fmt, env)
	const b = unpack(op2, fmt, env)
	const nan = processNaNs([[a, op1], [b, op2]], fmt, env)
	if (nan !== null) return nan
	const sign = a.sign ^ b.sign
	if ((a.type === FP_INF && b.type === FP_INF) || (a.type === FP_ZERO && b.type === FP_ZERO)) {
		env.flags |= FPSR_IOC
		return fpDefaultNaN(fmt)
	}
	if (a.type === FP_INF || b.type === FP_ZERO) {
		if (a.type !== FP_INF) env.flags |= FPSR_DZC
		return fpInfinity(sign, fmt)
	}
	if (a.type === FP_ZERO || b.type === FP_INF) return fpZero(sign, fmt)
	// Enough quotient bits to round, and a sticky bit below them.
	const k = Math.max(0, fmt.f + 4 + bitLength(b.m) - bitLength(a.m))
	const numerator = a.m << BigInt(k)
	const quotient = numerator / b.m
	const sticky = numerator % b.m === 0n ? 0n : 1n
	return fpRound(sign, (quotient << 1n) | sticky, a.e - b.e - k - 1, fmt, env)
}

function integerSqrt(value: bigint): bigint {
	if (value < 2n) return value
	let x = 1n << BigInt(Math.ceil(bitLength(value) / 2))
	for (;;) {
		const next = (x + value / x) >> 1n
		if (next >= x) return x
		x = next
	}
}

export function fpSqrt(op: bigint, fmt: FpFormat, env: FpEnv): bigint {
	const a = unpack(op, fmt, env)
	if (isNaN(a.type)) return processNaN(a.type, op, fmt, env)
	if (a.type === FP_ZERO) return fpZero(a.sign, fmt)
	if (a.sign) {
		env.flags |= FPSR_IOC
		return fpDefaultNaN(fmt)
	}
	if (a.type === FP_INF) return fpInfinity(0, fmt)
	let shift = Math.max(0, 2 * (fmt.f + 4) - bitLength(a.m))
	if ((a.e - shift) & 1) shift++
	const scaled = a.m << BigInt(shift)
	const root = integerSqrt(scaled)
	const sticky = root * root === scaled ? 0n : 1n
	return fpRound(0, (root << 1n) | sticky, (a.e - shift) / 2 - 1, fmt, env)
}

/** FPMulAdd: addend + op1 * op2, rounded once. */
export function fpMulAdd(addend: bigint, op1: bigint, op2: bigint, fmt: FpFormat, env: FpEnv): bigint {
	const c = unpack(addend, fmt, env)
	const a = unpack(op1, fmt, env)
	const b = unpack(op2, fmt, env)
	const invalidProduct = (a.type === FP_INF && b.type === FP_ZERO) || (a.type === FP_ZERO && b.type === FP_INF)
	let nan = processNaNs([[c, addend], [a, op1], [b, op2]], fmt, env)
	if (c.type === FP_QNAN && invalidProduct) {
		env.flags |= FPSR_IOC
		nan = fpDefaultNaN(fmt)
	}
	if (nan !== null) return nan
	const signP = a.sign ^ b.sign
	const infP = a.type === FP_INF || b.type === FP_INF
	const zeroP = a.type === FP_ZERO || b.type === FP_ZERO
	const infA = c.type === FP_INF
	if (invalidProduct || (infA && infP && c.sign !== signP)) {
		env.flags |= FPSR_IOC
		return fpDefaultNaN(fmt)
	}
	if ((infA && c.sign === 0) || (infP && signP === 0)) return fpInfinity(0, fmt)
	if (infA || infP) return fpInfinity(1, fmt)
	if (c.type === FP_ZERO && zeroP && c.sign === signP) return fpZero(c.sign, fmt)
	const product: Unpacked = zeroP ? { type: FP_ZERO, sign: signP, m: 0n, e: 0 } : { type: FP_FINITE, sign: signP, m: a.m * b.m, e: a.e + b.e }
	if (c.type === FP_ZERO) c.e = product.e
	if (zeroP) product.e = c.e
	const [x, y, e] = aligned(c, product)
	return roundSum(x + y, e, fmt, env)
}

/** FPMax / FPMin, and with `numbers` FPMaxNum / FPMinNum, where one quiet NaN loses to a number. */
export function fpMinMax(op1: bigint, op2: bigint, max: boolean, numbers: boolean, fmt: FpFormat, env: FpEnv): bigint {
	if (numbers) {
		const t1 = fpType(op1, fmt)
		const t2 = fpType(op2, fmt)
		const loser = fpInfinity(max ? 1 : 0, fmt)
		if (t1 === FP_QNAN && t2 !== FP_QNAN) op1 = loser
		else if (t1 !== FP_QNAN && t2 === FP_QNAN) op2 = loser
	}
	const a = unpack(op1, fmt, env)
	const b = unpack(op2, fmt, env)
	const nan = processNaNs([[a, op1], [b, op2]], fmt, env)
	if (nan !== null) return nan
	if (a.type === FP_ZERO && b.type === FP_ZERO) return fpZero(max ? a.sign & b.sign : a.sign | b.sign, fmt)
	const order = compareValues(a, b)
	const pick = (max ? order >= 0 : order <= 0) ? [a, op1] as const : [b, op2] as const
	// A denormal flushed on input comes out as that zero.
	return pick[0].type === FP_ZERO ? fpZero(pick[0].sign, fmt) : pick[1]
}

/** -1, 0 or 1 for two non-NaN operands. */
function compareValues(a: Unpacked, b: Unpacked): number {
	const value = (x: Unpacked): [number, bigint, number] => x.type === FP_INF ? [x.sign ? -1 : 1, 0n, 0] : [0, x.sign ? -x.m : x.m, x.e]
	const [ia, ma, ea] = value(a)
	const [ib, mb, eb] = value(b)
	if (ia !== ib) return ia < ib ? -1 : 1
	if (ia !== 0) return 0
	const e = Math.min(ea, eb)
	const x = ma << BigInt(ea - e)
	const y = mb << BigInt(eb - e)
	return x < y ? -1 : x > y ? 1 : 0
}

/** FPCompare as NZCV (8, 4, 2, 1): unordered 0011, equal 0110, less 1000, greater 0010. `signal` raises IOC for quiet NaNs too (FCMPE, VCMPE). */
export function fpCompare(op1: bigint, op2: bigint, signal: boolean, fmt: FpFormat, env: FpEnv): number {
	const a = unpack(op1, fmt, env)
	const b = unpack(op2, fmt, env)
	if (isNaN(a.type) || isNaN(b.type)) {
		if (a.type === FP_SNAN || b.type === FP_SNAN || signal) env.flags |= FPSR_IOC
		return 0b0011
	}
	const order = compareValues(a, b)
	return order === 0 ? 0b0110 : order < 0 ? 0b1000 : 0b0010
}

/** FPRoundInt: the integral value in `mode`; `exact` (FRINTX) raises IXC when it differs. */
export function fpRoundInt(op: bigint, mode: number, exact: boolean, fmt: FpFormat, env: FpEnv): bigint {
	const a = unpack(op, fmt, env)
	if (isNaN(a.type)) return processNaN(a.type, op, fmt, env)
	if (a.type === FP_INF) return fpInfinity(a.sign, fmt)
	if (a.type === FP_ZERO) return fpZero(a.sign, fmt)
	const { value, inexact } = roundToInteger(a, 0, mode)
	if (inexact && exact) env.flags |= FPSR_IXC
	if (value === 0n) return fpZero(a.sign, fmt)
	const magnitude = value < 0n ? -value : value
	return fpRound(a.sign, magnitude, 0, fmt, new FpEnv(0))
}

/** The finite `a * 2^fbits` rounded to an integer as FPToFixed and FPRoundInt round. */
function roundToInteger(a: Unpacked, fbits: number, mode: number): { value: bigint, inexact: boolean } {
	const e = a.e + fbits
	let value: bigint
	// The error, value - floor, as a fraction of `unit`.
	let error = 0n
	let unit = 1n
	if (e >= 0) {
		value = a.m << BigInt(e)
		if (a.sign) value = -value
	} else {
		unit = 1n << BigInt(-e)
		const whole = a.m >> BigInt(-e)
		const rest = a.m - (whole << BigInt(-e))
		if (!a.sign) {
			value = whole
			error = rest
		} else if (rest === 0n) {
			value = -whole
		} else {
			value = -whole - 1n
			error = unit - rest
		}
	}
	const twice = error * 2n
	let roundUp: boolean
	switch (mode) {
		case ROUND_TIEEVEN: roundUp = twice > unit || (twice === unit && (value & 1n) === 1n); break
		case ROUND_POSINF: roundUp = error !== 0n; break
		case ROUND_NEGINF: roundUp = false; break
		case ROUND_ZERO: roundUp = error !== 0n && value < 0n; break
		default: roundUp = twice > unit || (twice === unit && value >= 0n)
	}
	return { value: roundUp ? value + 1n : value, inexact: error !== 0n }
}

/**
 * FPToFixed: `op * 2^fbits` rounded in `mode` and saturated to `bits`
 * (32 or 64); returned as those bits unsigned. A NaN gives 0. Saturation
 * raises IOC rather than IXC.
 */
export function fpToFixed(op: bigint, fbits: number, unsigned: boolean, mode: number, bits: number, fmt: FpFormat, env: FpEnv): bigint {
	const a = unpack(op, fmt, env)
	const high = unsigned ? (1n << BigInt(bits)) - 1n : (1n << BigInt(bits - 1)) - 1n
	const low = unsigned ? 0n : -(1n << BigInt(bits - 1))
	let value: bigint
	let inexact = false
	if (isNaN(a.type)) {
		env.flags |= FPSR_IOC
		return 0n
	}
	if (a.type === FP_INF) value = a.sign ? low - 1n : high + 1n
	else if (a.type === FP_ZERO) value = 0n
	else ({ value, inexact } = roundToInteger(a, fbits, mode))
	if (value > high || value < low) {
		env.flags |= FPSR_IOC
		value = value > high ? high : low
	} else if (inexact) {
		env.flags |= FPSR_IXC
	}
	return BigInt.asUintN(bits, value)
}

/** FixedToFP: the signed or unsigned integer `value` over `2^fbits`, rounded in `mode`. */
export function fixedToFp(value: bigint, fbits: number, fmt: FpFormat, env: FpEnv, mode = env.mode): bigint {
	if (value === 0n) return fpZero(0, fmt)
	return value < 0n ? fpRound(1, -value, -fbits, fmt, env, mode) : fpRound(0, value, -fbits, fmt, env, mode)
}

/** FPConvert between formats; a NaN keeps the top of its payload, quietened. */
export function fpConvert(op: bigint, from: FpFormat, to: FpFormat, env: FpEnv): bigint {
	const a = unpack(op, from, env)
	if (isNaN(a.type)) {
		if (a.type === FP_SNAN) env.flags |= FPSR_IOC
		if (env.dn) return fpDefaultNaN(to)
		const payload = op & fractionMask(from)
		const moved = to.f >= from.f ? payload << BigInt(to.f - from.f) : payload >> BigInt(from.f - to.f)
		return fpInfinity(a.sign, to) | quietBit(to) | moved
	}
	if (a.type === FP_INF) return fpInfinity(a.sign, to)
	if (a.type === FP_ZERO) return fpZero(a.sign, to)
	return fpRound(a.sign, a.m, a.e, to, env)
}

/** VFPExpandImm: the value an 8-bit FMOV/VMOV immediate stands for. */
export function expandImm8(imm8: number, fmt: FpFormat): bigint {
	const sign = BigInt((imm8 >>> 7) & 1)
	const b6 = (imm8 >>> 6) & 1
	const exponent = (BigInt(b6 ^ 1) << BigInt(fmt.e - 1)) | ((b6 ? (1n << BigInt(fmt.e - 3)) - 1n : 0n) << 2n) | BigInt((imm8 >>> 4) & 3)
	const fraction = BigInt(imm8 & 15) << BigInt(fmt.f - 4)
	return (sign << BigInt(fmt.bits - 1)) | (exponent << BigInt(fmt.f)) | fraction
}

/** The imm8 whose expansion is `bits`, or -1. */
export function encodeImm8(bits: bigint, fmt: FpFormat): number {
	for (let imm8 = 0; imm8 < 256; imm8++) if (expandImm8(imm8, fmt) === bits) return imm8
	return -1
}

/* ---------------------------------------------------------- JS numbers */

const scratch = new DataView(new ArrayBuffer(8))

/** A JS number as `fmt` bits, rounded to nearest. */
export function numberToBits(value: number, fmt: FpFormat): bigint {
	if (fmt.bits === 32) {
		scratch.setFloat32(0, value)
		return BigInt(scratch.getUint32(0))
	}
	scratch.setFloat64(0, value)
	return scratch.getBigUint64(0)
}

/** `fmt` bits as a JS number. */
export function bitsToNumber(bits: bigint, fmt: FpFormat): number {
	if (fmt.bits === 32) {
		scratch.setUint32(0, Number(bits & 0xFFFF_FFFFn))
		return scratch.getFloat32(0)
	}
	scratch.setBigUint64(0, BigInt.asUintN(64, bits))
	return scratch.getFloat64(0)
}

/** Shortest text that reads back as the same value, as disassembly shows an immediate. */
export function formatFloat(bits: bigint, fmt: FpFormat): string {
	const value = bitsToNumber(bits, fmt)
	if (Number.isNaN(value)) return 'nan'
	if (!Number.isFinite(value)) return value < 0 ? '-inf' : 'inf'
	if (Object.is(value, -0)) return '-0.0'
	let text = `${value}`
	if (fmt.bits === 32) {
		for (let digits = 1; digits <= 9; digits++) {
			const candidate = Number(value.toPrecision(digits))
			if (Math.fround(candidate) === value) {
				text = `${candidate}`
				break
			}
		}
	}
	return /[.e]/.test(text) ? text : `${text}.0`
}
