/**
 * IBM hexadecimal floating point, independent of any CPU: a sign bit, a 7-bit
 * excess-64 power-of-16 characteristic and a fraction of 6 (short) or 14
 * (long) hex digits, so the value is 0.fraction x 16^(characteristic - 64).
 * There are no infinities, NaNs or hidden bit; unnormalized values are valid.
 */
export interface HexFloat { sign: number, char: number, fraction: bigint }

export const HFP_SHORT = 6, HFP_LONG = 14

const scale = (digits: number) => 1n << BigInt(4 * digits)

export function hexFloatToNumber(value: HexFloat, digits: number): number {
	return (value.sign ? -1 : 1) * Number(value.fraction) * 16 ** (value.char - 64 - digits)
}

/** The nearest `digits` value to num / den, rounding half up; null outside the characteristic range. */
export function hexFloatFromRational(negative: boolean, num: bigint, den: bigint, digits: number): HexFloat | null {
	if (num === 0n) return { sign: 0, char: 0, fraction: 0n }
	let exponent = 0
	while (num >= den) { den *= 16n; exponent++ }
	while (num * 16n < den) { num *= 16n; exponent-- }
	let fraction = (num * scale(digits) * 2n + den) / (2n * den)
	if (fraction >= scale(digits)) { fraction >>= 4n; exponent++ }
	const char = exponent + 64
	return char < 0 || char > 127 ? null : { sign: negative ? 1 : 0, char, fraction }
}

/** A finite double; exact in long format, since 53 bits fit 14 hex digits at any alignment. */
export function hexFloatFromNumber(value: number, digits: number): HexFloat | null {
	if (!Number.isFinite(value)) return null
	if (value === 0) return { sign: Object.is(value, -0) ? 1 : 0, char: 0, fraction: 0n }
	const view = new DataView(new ArrayBuffer(8))
	view.setFloat64(0, Math.abs(value))
	const bits = view.getBigUint64(0), biased = Number(bits >> 52n)
	const mantissa = (bits & 0xfffffffffffffn) | (biased ? 1n << 52n : 0n), power = (biased || 1) - 1075
	return hexFloatFromRational(value < 0, power >= 0 ? mantissa << BigInt(power) : mantissa, power >= 0 ? 1n : 1n << BigInt(-power), digits)
}

export const shortHexFloat = (word: number): HexFloat => ({ sign: word >>> 31, char: word >>> 24 & 127, fraction: BigInt(word & 0xffffff) })
export const longHexFloat = (high: number, low: number): HexFloat => ({ sign: high >>> 31, char: high >>> 24 & 127, fraction: BigInt(high & 0xffffff) << 32n | BigInt(low >>> 0) })
export const shortHexFloatBits = (value: HexFloat) => (value.sign << 31 | value.char << 24 | Number(value.fraction & 0xffffffn)) >>> 0
export const longHexFloatBits = (value: HexFloat) => ({ high: shortHexFloatBits({ ...value, fraction: value.fraction >> 32n }), low: Number(value.fraction & 0xffffffffn) })
