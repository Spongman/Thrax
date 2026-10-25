/**
 * IEEE 754 binary32/binary64 arithmetic for the RISC-V F and D extensions.
 * Every result is computed exactly in BigInt and rounded once, so all five
 * rounding modes and all five exception flags are exact. Tininess is detected
 * after rounding, as RISC-V specifies.
 */

export const NX = 1, UF = 2, OF = 4, DZ = 8, NV = 16
export const RNE = 0, RTZ = 1, RDN = 2, RUP = 3, RMM = 4
export const ROUNDING_MODES = ['rne', 'rtz', 'rdn', 'rup', 'rmm', '', '', 'dyn']

export interface FloatFormat {
	bits: number
	precision: number
	emin: number
	emax: number
	bias: number
}
export const SINGLE: FloatFormat = { bits: 32, precision: 24, emin: -126, emax: 127, bias: 127 }
export const DOUBLE: FloatFormat = { bits: 64, precision: 53, emin: -1022, emax: 1023, bias: 1023 }

/** Rounding mode in, accumulated exception flags out. */
export interface FloatEnv {
	rm: number
	flags: number
}

const ZERO = 0, FINITE = 1, INF = 2, NAN = 3
interface Unpacked {
	kind: number
	sign: boolean
	m: bigint
	e: number
	signaling: boolean
}

const bitLength = (m: bigint) => m.toString(2).length
const fractionBits = (f: FloatFormat) => f.precision - 1
const exponentMask = (f: FloatFormat) => (1 << (f.bits - f.precision)) - 1
const signBit = (f: FloatFormat, sign: boolean) => (sign ? 1n << BigInt(f.bits - 1) : 0n)
const infinity = (f: FloatFormat, sign: boolean) => signBit(f, sign) | (BigInt(exponentMask(f)) << BigInt(fractionBits(f)))
const largest = (f: FloatFormat, sign: boolean) =>
	signBit(f, sign) | (BigInt(exponentMask(f) - 1) << BigInt(fractionBits(f))) | ((1n << BigInt(fractionBits(f))) - 1n)
const zero = (f: FloatFormat, sign: boolean) => signBit(f, sign)

export const canonicalNaN = (f: FloatFormat) => infinity(f, false) | (1n << BigInt(fractionBits(f) - 1))

function unpack(bits: bigint, f: FloatFormat): Unpacked {
	const fraction = bits & ((1n << BigInt(fractionBits(f))) - 1n),
		exponent = Number((bits >> BigInt(fractionBits(f))) & BigInt(exponentMask(f))),
		sign = ((bits >> BigInt(f.bits - 1)) & 1n) === 1n
	if (exponent === exponentMask(f))
		return { kind: fraction ? NAN : INF, sign, m: 0n, e: 0, signaling: !!fraction && !((fraction >> BigInt(fractionBits(f) - 1)) & 1n) }
	if (exponent === 0) return { kind: fraction ? FINITE : ZERO, sign, m: fraction, e: f.emin - fractionBits(f), signaling: false }
	return { kind: FINITE, sign, m: fraction | (1n << BigInt(fractionBits(f))), e: exponent - f.bias - fractionBits(f), signaling: false }
}

/** Drop `shift` low bits of m under rm. */
function roundShift(m: bigint, shift: number, rm: number, sign: boolean) {
	if (shift <= 0) return { q: m << BigInt(-shift), inexact: false }
	const s = BigInt(shift),
		q = m >> s,
		rest = m & ((1n << s) - 1n)
	if (!rest) return { q, inexact: false }
	const half = 1n << (s - 1n)
	const up =
		rm === RNE ? rest > half || (rest === half && (q & 1n) === 1n)
			: rm === RDN ? sign
				: rm === RUP ? !sign
					: rm === RMM ? rest >= half
						: false
	return { q: up ? q + 1n : q, inexact: true }
}

/** Round the exact value (-1)^sign * m * 2^e, m > 0, to f. */
export function round(env: FloatEnv, f: FloatFormat, sign: boolean, m: bigint, e: number): bigint {
	const p = f.precision,
		top = e + bitLength(m) - 1,
		lsb = Math.max(top - p + 1, f.emin - p + 1)
	let { q, inexact } = roundShift(m, lsb - e, env.rm, sign)
	if (inexact) {
		env.flags |= NX
		const unbounded = roundShift(m, top - p + 1 - e, env.rm, sign).q
		if (top - p + bitLength(unbounded) < f.emin) env.flags |= UF
	}
	if (!q) return zero(f, sign)
	const exponent = lsb + bitLength(q) - 1
	if (exponent > f.emax) {
		env.flags |= OF | NX
		const toInfinity = env.rm === RNE || env.rm === RMM || (env.rm === RDN && sign) || (env.rm === RUP && !sign)
		return toInfinity ? infinity(f, sign) : largest(f, sign)
	}
	if (bitLength(q) > p) q >>= 1n
	if (exponent < f.emin) return signBit(f, sign) | q
	return signBit(f, sign) | (BigInt(exponent + f.bias) << BigInt(p - 1)) | (q - (1n << BigInt(p - 1)))
}

function invalid(env: FloatEnv, f: FloatFormat) {
	env.flags |= NV
	return canonicalNaN(f)
}
function nan(env: FloatEnv, f: FloatFormat, ...inputs: Unpacked[]) {
	if (inputs.some((input) => input.kind === NAN && input.signaling)) env.flags |= NV
	return canonicalNaN(f)
}
const anyNaN = (...inputs: Unpacked[]) => inputs.some((input) => input.kind === NAN)

function sum(env: FloatEnv, f: FloatFormat, a: Unpacked, b: Unpacked): bigint {
	if (a.kind === INF || b.kind === INF) {
		if (a.kind === INF && b.kind === INF && a.sign !== b.sign) return invalid(env, f)
		return infinity(f, a.kind === INF ? a.sign : b.sign)
	}
	if (a.kind === ZERO && b.kind === ZERO) return zero(f, a.sign === b.sign ? a.sign : env.rm === RDN)
	if (a.kind === ZERO) return round(env, f, b.sign, b.m, b.e)
	if (b.kind === ZERO) return round(env, f, a.sign, a.m, a.e)
	const e = Math.min(a.e, b.e),
		value = (a.sign ? -1n : 1n) * (a.m << BigInt(a.e - e)) + (b.sign ? -1n : 1n) * (b.m << BigInt(b.e - e))
	if (!value) return zero(f, env.rm === RDN)
	return round(env, f, value < 0n, value < 0n ? -value : value, e)
}

export function add(env: FloatEnv, f: FloatFormat, x: bigint, y: bigint, subtract = false): bigint {
	const a = unpack(x, f),
		b = unpack(y, f)
	if (anyNaN(a, b)) return nan(env, f, a, b)
	if (subtract) b.sign = !b.sign
	return sum(env, f, a, b)
}

export function multiply(env: FloatEnv, f: FloatFormat, x: bigint, y: bigint): bigint {
	const a = unpack(x, f),
		b = unpack(y, f),
		sign = a.sign !== b.sign
	if (anyNaN(a, b)) return nan(env, f, a, b)
	if (a.kind === INF || b.kind === INF) return a.kind === ZERO || b.kind === ZERO ? invalid(env, f) : infinity(f, sign)
	if (a.kind === ZERO || b.kind === ZERO) return zero(f, sign)
	return round(env, f, sign, a.m * b.m, a.e + b.e)
}

export function divide(env: FloatEnv, f: FloatFormat, x: bigint, y: bigint): bigint {
	const a = unpack(x, f),
		b = unpack(y, f),
		sign = a.sign !== b.sign
	if (anyNaN(a, b)) return nan(env, f, a, b)
	if (a.kind === INF) return b.kind === INF ? invalid(env, f) : infinity(f, sign)
	if (b.kind === INF) return zero(f, sign)
	if (b.kind === ZERO) {
		if (a.kind === ZERO) return invalid(env, f)
		env.flags |= DZ
		return infinity(f, sign)
	}
	if (a.kind === ZERO) return zero(f, sign)
	const k = f.precision + 3 + bitLength(b.m),
		n = a.m << BigInt(k)
	let q = n / b.m,
		e = a.e - b.e - k
	// A sticky bit below the quotient keeps rounding exact.
	if (n % b.m) {
		q = (q << 1n) | 1n
		e--
	}
	return round(env, f, sign, q, e)
}

function isqrt(n: bigint): bigint {
	if (n < 2n) return n
	let x = 1n << BigInt((bitLength(n) >> 1) + 1)
	for (;;) {
		const y = (x + n / x) >> 1n
		if (y >= x) return x
		x = y
	}
}

export function squareRoot(env: FloatEnv, f: FloatFormat, x: bigint): bigint {
	const a = unpack(x, f)
	if (anyNaN(a)) return nan(env, f, a)
	if (a.kind === ZERO) return zero(f, a.sign)
	if (a.sign) return invalid(env, f)
	if (a.kind === INF) return infinity(f, false)
	let k = Math.max(0, 2 * (f.precision + 3) - bitLength(a.m))
	if ((a.e - k) & 1) k++
	const n = a.m << BigInt(k)
	let r = isqrt(n),
		e = (a.e - k) / 2
	if (r * r !== n) {
		r = (r << 1n) | 1n
		e--
	}
	return round(env, f, false, r, e)
}

/** (x * y) + z with one rounding; the negations select fmsub, fnmsub and fnmadd. */
export function fusedMultiplyAdd(env: FloatEnv, f: FloatFormat, x: bigint, y: bigint, z: bigint, negateProduct: boolean, negateAddend: boolean): bigint {
	const a = unpack(x, f),
		b = unpack(y, f),
		c = unpack(z, f)
	// Infinity times zero is invalid even when the addend is a quiet NaN.
	if ((a.kind === INF && b.kind === ZERO) || (a.kind === ZERO && b.kind === INF)) return invalid(env, f)
	if (anyNaN(a, b, c)) return nan(env, f, a, b, c)
	if (negateAddend) c.sign = !c.sign
	const sign = (a.sign !== b.sign) !== negateProduct
	const product: Unpacked =
		a.kind === INF || b.kind === INF ? { kind: INF, sign, m: 0n, e: 0, signaling: false }
			: a.kind === ZERO || b.kind === ZERO ? { kind: ZERO, sign, m: 0n, e: 0, signaling: false }
				: { kind: FINITE, sign, m: a.m * b.m, e: a.e + b.e, signaling: false }
	return sum(env, f, product, c)
}

/** The exact value of finite or infinite bits; NaN for NaN. */
export function toNumber(bits: bigint, f: FloatFormat): number {
	const view = new DataView(new ArrayBuffer(8))
	if (f.bits === 32) {
		view.setUint32(0, Number(bits))
		return view.getFloat32(0)
	}
	view.setBigUint64(0, bits)
	return view.getFloat64(0)
}

/** feq is quiet; flt and fle signal on any NaN. Returns 0 or 1. */
export function compare(env: FloatEnv, f: FloatFormat, x: bigint, y: bigint, relation: 'eq' | 'lt' | 'le'): number {
	const a = unpack(x, f),
		b = unpack(y, f)
	if (anyNaN(a, b)) {
		if (relation !== 'eq' || a.signaling || b.signaling) env.flags |= NV
		return 0
	}
	const u = toNumber(x, f),
		v = toNumber(y, f)
	return +(relation === 'eq' ? u === v : relation === 'lt' ? u < v : u <= v)
}

/** IEEE 754-2019 minimumNumber/maximumNumber, with -0 below +0. */
export function minMax(env: FloatEnv, f: FloatFormat, x: bigint, y: bigint, maximum: boolean): bigint {
	const a = unpack(x, f),
		b = unpack(y, f)
	if (a.signaling || b.signaling) env.flags |= NV
	if (a.kind === NAN && b.kind === NAN) return canonicalNaN(f)
	if (a.kind === NAN) return y
	if (b.kind === NAN) return x
	const u = toNumber(x, f),
		v = toNumber(y, f)
	if (u === v) return u === 0 ? zero(f, maximum ? a.sign && b.sign : a.sign || b.sign) : x
	return (maximum ? u > v : u < v) ? x : y
}

/** fclass: one of ten bits. */
export function classify(bits: bigint, f: FloatFormat): number {
	const a = unpack(bits, f)
	if (a.kind === NAN) return a.signaling ? 1 << 8 : 1 << 9
	if (a.kind === INF) return a.sign ? 1 : 1 << 7
	if (a.kind === ZERO) return a.sign ? 1 << 3 : 1 << 4
	const subnormal = a.m < 1n << BigInt(fractionBits(f))
	return a.sign ? (subnormal ? 1 << 2 : 1 << 1) : subnormal ? 1 << 5 : 1 << 6
}

/** fcvt.w and fcvt.wu: round to an integer, saturating out-of-range and NaN inputs with NV. */
export function toInteger(env: FloatEnv, f: FloatFormat, bits: bigint, unsigned: boolean): number {
	const a = unpack(bits, f),
		min = unsigned ? 0n : -(1n << 31n),
		max = unsigned ? 0xffffffffn : (1n << 31n) - 1n
	const saturate = (negative: boolean) => {
		env.flags |= NV
		return Number(negative ? min : max) | 0
	}
	if (a.kind === NAN) return saturate(false)
	if (a.kind === INF) return saturate(a.sign)
	if (a.kind === ZERO) return 0
	if (a.e > 32) return saturate(a.sign)
	const { q, inexact } = roundShift(a.m, -a.e, env.rm, a.sign),
		value = a.sign ? -q : q
	if (value < min || value > max) return saturate(a.sign)
	if (inexact) env.flags |= NX
	return Number(value) | 0
}

/** fcvt.s.w, fcvt.d.wu and the rest: integer to float. */
export function fromInteger(env: FloatEnv, f: FloatFormat, value: number): bigint {
	if (!value) return 0n
	return round(env, f, value < 0, BigInt(Math.abs(value)), 0)
}

/** fcvt.s.d and fcvt.d.s. */
export function convert(env: FloatEnv, from: FloatFormat, to: FloatFormat, bits: bigint): bigint {
	const a = unpack(bits, from)
	if (a.kind === NAN) return nan(env, to, a)
	if (a.kind === INF) return infinity(to, a.sign)
	if (a.kind === ZERO) return zero(to, a.sign)
	return round(env, to, a.sign, a.m, a.e)
}

/** Sign injection: the magnitude of x with a sign taken from y. */
export function injectSign(f: FloatFormat, x: bigint, y: bigint, mode: 0 | 1 | 2): bigint {
	const top = BigInt(f.bits - 1),
		sx = (x >> top) & 1n,
		sy = (y >> top) & 1n,
		sign = mode === 0 ? sy : mode === 1 ? sy ^ 1n : sx ^ sy
	return (x & ((1n << top) - 1n)) | (sign << top)
}
