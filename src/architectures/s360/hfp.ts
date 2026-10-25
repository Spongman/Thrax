/**
 * IBM hexadecimal floating point (GA22-6821, "Floating-Point Arithmetic"):
 * sign, excess-64 power-of-16 characteristic and a fraction of 6 (short),
 * 14 (long) or 28 (extended) hex digits. Results truncate; one guard digit.
 */
import { hexFloatFromRational, hexFloatToNumber, type HexFloat } from '../../core/hexFloat'
import { EXPONENT_OVERFLOW, EXPONENT_UNDERFLOW, FLOAT_DIVIDE, interrupt, MASK_SIGNIFICANCE, MASK_UNDERFLOW, SIGNIFICANCE } from './interruption'

export const SHORT = 6, LONG = 14, EXTENDED = 28

export type Hfp = HexFloat

const ZERO: Hfp = { sign: 0, char: 0, fraction: 0n }
const digitsOf = (digits: number) => 1n << BigInt(4 * digits)

export function fromShort(word: number): Hfp {
	return { sign: word >>> 31, char: word >>> 24 & 127, fraction: BigInt(word & 0xffffff) }
}
export function toShort(h: Hfp): number {
	return (h.sign << 31 | h.char << 24 | Number(h.fraction & 0xffffffn)) >>> 0
}
export function fromLong(bits: bigint): Hfp {
	return { sign: Number(bits >> 63n & 1n), char: Number(bits >> 56n & 127n), fraction: bits & 0xffffffffffffffn }
}
export function toLong(h: Hfp): bigint {
	return BigInt(h.sign) << 63n | BigInt(h.char) << 56n | h.fraction & 0xffffffffffffffn
}
/** An extended operand is a register pair: high part, then a low part whose characteristic is 14 less. */
export function fromExtended(high: bigint, low: bigint): Hfp {
	const h = fromLong(high)
	return { ...h, fraction: h.fraction << 56n | low & 0xffffffffffffffn }
}
export function toExtended(h: Hfp): [bigint, bigint] {
	const low = h.fraction & 0xffffffffffffffn
	return [toLong({ ...h, fraction: h.fraction >> 56n }), BigInt(h.sign) << 63n | BigInt(h.char - 14 & 127) << 56n | low]
}

/** A zero fraction result: a significance interruption when enabled, otherwise a true zero. */
function significance(mask: number): Hfp {
	if (mask & MASK_SIGNIFICANCE) interrupt(SIGNIFICANCE)
	return ZERO
}
function finish(sign: number, char: number, fraction: bigint, mask: number): Hfp {
	if (char > 127) interrupt(EXPONENT_OVERFLOW)
	if (char < 0) {
		if (mask & MASK_UNDERFLOW) interrupt(EXPONENT_UNDERFLOW)
		return ZERO
	}
	return { sign, char, fraction }
}

/** Aligned signed sum with one guard digit, before any normalization. */
function alignedSum(a: Hfp, b: Hfp, digits: number): { sum: bigint, char: number } {
	let fa = a.fraction << 4n, fb = b.fraction << 4n, char = a.char
	if (a.char >= b.char) fb = a.char - b.char > digits + 1 ? 0n : fb >> BigInt(4 * (a.char - b.char))
	else { char = b.char; fa = b.char - a.char > digits + 1 ? 0n : fa >> BigInt(4 * (b.char - a.char)) }
	return { sum: (a.sign ? -fa : fa) + (b.sign ? -fb : fb), char }
}

/** AE/AD/AXR and their subtract forms (pass b negated); unnormalized AU/AW skip the left shift. */
export function add(a: Hfp, b: Hfp, digits: number, normalize: boolean, mask: number): Hfp {
	let { sum, char } = alignedSum(a, b, digits)
	const sign = sum < 0n ? 1 : 0
	if (sign) sum = -sum
	if (sum === 0n) return significance(mask)
	const limit = digitsOf(digits + 1)
	if (sum >= limit) {
		sum >>= 4n
		if (++char > 127) interrupt(EXPONENT_OVERFLOW)
	}
	if (normalize) for (const top = limit >> 4n; sum < top; char--) sum <<= 4n
	const fraction = sum >> 4n
	if (fraction === 0n) return significance(mask)
	return finish(sign, char, fraction, mask)
}

export const negate = (h: Hfp): Hfp => ({ ...h, sign: h.sign ^ 1 })

/** Condition code of a comparison: 0 equal, 1 first low, 2 first high. Zero fractions are equal whatever their sign. */
export function compare(a: Hfp, b: Hfp, digits: number): number {
	const { sum } = alignedSum(a, negate(b), digits)
	return sum === 0n ? 0 : sum < 0n ? 1 : 2
}

function prenormalize(h: Hfp, digits: number): { fraction: bigint, char: number } {
	let { fraction, char } = h
	for (const top = digitsOf(digits - 1); fraction < top; char--) fraction <<= 4n
	return { fraction, char }
}

/** Product of two `digits` operands truncated to `resultDigits` (ME on System/370 and MXD widen). */
export function multiply(a: Hfp, b: Hfp, digits: number, resultDigits: number, mask: number): Hfp {
	if (a.fraction === 0n || b.fraction === 0n) return ZERO
	const x = prenormalize(a, digits), y = prenormalize(b, digits)
	let product = x.fraction * y.fraction, char = x.char + y.char - 64
	if (product < digitsOf(2 * digits - 1)) { product <<= 4n; char-- }
	const shift = 4 * (2 * digits - resultDigits)
	const fraction = shift >= 0 ? product >> BigInt(shift) : product << BigInt(-shift)
	return finish(a.sign ^ b.sign, char, fraction, mask)
}

export function divide(a: Hfp, b: Hfp, digits: number, mask: number): Hfp {
	if (b.fraction === 0n) interrupt(FLOAT_DIVIDE)
	if (a.fraction === 0n) return ZERO
	const x = prenormalize(a, digits), y = prenormalize(b, digits)
	let char = x.char - y.char + 64, fraction: bigint
	if (x.fraction >= y.fraction) { fraction = (x.fraction << BigInt(4 * (digits - 1))) / y.fraction; char++ }
	else fraction = (x.fraction << BigInt(4 * digits)) / y.fraction
	return finish(a.sign ^ b.sign, char, fraction, mask)
}

/** HER/HDR: System/360 shifts the fraction one bit and stops; System/370 also normalizes. */
export function halve(h: Hfp, digits: number, normalize: boolean, mask: number): Hfp {
	let fraction = h.fraction >> 1n, char = h.char
	if (!normalize) return { ...h, fraction }
	if (fraction === 0n) return ZERO
	for (const top = digitsOf(digits - 1); fraction < top; char--) fraction <<= 4n
	return finish(h.sign, char, fraction, mask)
}

/** LRER/LRDR: add one in the leftmost dropped bit, then truncate; a carry raises the characteristic. */
export function round(h: Hfp, from: number, to: number): Hfp {
	const drop = BigInt(4 * (from - to))
	let fraction = (h.fraction + (1n << drop - 1n)) >> drop, char = h.char
	if (fraction >= digitsOf(to)) {
		fraction >>= 4n
		if (++char > 127) interrupt(EXPONENT_OVERFLOW)
	}
	return { sign: h.sign, char, fraction }
}

/** Condition code of a result: 0 zero fraction, 1 negative, 2 positive. */
export const resultCode = (h: Hfp) => h.fraction === 0n ? 0 : h.sign ? 1 : 2

export const toNumber = hexFloatToNumber

/** Decimal text, such as `-1.25` or `2.5E-3`, rounded to the nearest value as the assembler does. */
export function fromDecimal(text: string, digits: number): Hfp | null {
	const match = /^([+-])?(\d*)(?:\.(\d*))?(?:E([+-]?\d+))?$/i.exec(text.trim())
	if (!match || !(match[2] || match[3])) return null
	const decimals = match[3] ?? '', exponent = Number(match[4] ?? 0) - decimals.length
	if (Math.abs(exponent) > 400) return null
	let num = BigInt(`${match[2] || '0'}${decimals}`), den = 1n
	if (exponent >= 0) num *= 10n ** BigInt(exponent)
	else den = 10n ** BigInt(-exponent)
	return hexFloatFromRational(match[1] === '-', num, den, digits)
}
