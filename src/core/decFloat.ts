/**
 * DEC F, D, G and H floating point, independent of any CPU.  A value is a run
 * of 16-bit words, the first holding the sign, the excess-2^(k-1) exponent and
 * the leading fraction bits, each word stored little-endian.  Images here are
 * that memory read as one little-endian integer, which is also how a VAX
 * register (pair) holds it.  The hidden bit makes the value 0.1f x 2^(e-bias).
 * There are no infinities, NaNs or denormals: exponent 0 is zero, or with the
 * sign set a reserved operand.  Rounding is to nearest, ties away from zero.
 */
import { roundBinary, type BinaryFloat } from './binaryFloat'

export interface DecFormat { readonly bytes: 4 | 8 | 16, readonly exponentBits: number, readonly fractionBits: number }
export const DEC_F: DecFormat = { bytes: 4, exponentBits: 8, fractionBits: 23 }
export const DEC_D: DecFormat = { bytes: 8, exponentBits: 8, fractionBits: 55 }
export const DEC_G: DecFormat = { bytes: 8, exponentBits: 11, fractionBits: 52 }
export const DEC_H: DecFormat = { bytes: 16, exponentBits: 15, fractionBits: 112 }

const bias = (format: DecFormat) => 1 << (format.exponentBits - 1)
const bitLength = (value: bigint) => value === 0n ? 0 : value.toString(2).length

/** Reverses the 16-bit word order: a little-endian image to the sign-first bit stream, and back. */
export function decWords(image: bigint, bytes: number): bigint {
	let stream = 0n
	for (let i = 0; i < bytes / 2; i++) stream = stream << 16n | (image >> BigInt(16 * i) & 0xffffn)
	return stream
}

/** The exact value, or null for a reserved operand (sign set, exponent zero). */
export function unpackDec(image: bigint, format: DecFormat): BinaryFloat | null {
	const stream = decWords(image, format.bytes)
	const negative = !!(stream >> BigInt(format.bytes * 8 - 1))
	const field = Number(stream >> BigInt(format.fractionBits)) & ((1 << format.exponentBits) - 1)
	if (!field) return negative ? null : { negative: false, significand: 0n, exponent: 0 }
	const hidden = 1n << BigInt(format.fractionBits)
	return { negative, significand: stream & (hidden - 1n) | hidden, exponent: field - bias(format) - format.fractionBits - 1 }
}

export interface DecPacked { image: bigint, overflow: boolean, underflow: boolean }

/** Rounds an exact numerator / denominator x 2^exponent; underflow gives true zero. */
export function packDec(negative: boolean, numerator: bigint, exponent: number, format: DecFormat, denominator = 1n): DecPacked {
	const precision = format.fractionBits + 1
	const rounded = roundBinary(negative, numerator, exponent, denominator, { precision, minExponent: -(2 ** 30), maxExponent: 2 ** 30 }, 'away').value
	if (rounded.significand === 0n) return { image: 0n, overflow: false, underflow: false }
	const width = bitLength(rounded.significand), top = width - 1 + rounded.exponent, field = top + 1 + bias(format)
	if (field < 1) return { image: 0n, overflow: false, underflow: true }
	if (field >= 1 << format.exponentBits) return { image: 0n, overflow: true, underflow: false }
	const significand = width > precision ? rounded.significand >> BigInt(width - precision) : rounded.significand << BigInt(precision - width)
	const fraction = significand & ((1n << BigInt(format.fractionBits)) - 1n)
	const stream = BigInt(negative) << BigInt(format.bytes * 8 - 1) | BigInt(field) << BigInt(format.fractionBits) | fraction
	return { image: decWords(stream, format.bytes), overflow: false, underflow: false }
}

/** Nearest host double, for display; null for a reserved operand. */
export function decToNumber(image: bigint, format: DecFormat): number | null {
	const value = unpackDec(image, format)
	if (!value) return null
	const width = bitLength(value.significand), drop = Math.max(0, width - 60)
	const magnitude = Number(value.significand >> BigInt(drop)) * 2 ** (value.exponent + drop)
	return value.negative ? -magnitude : magnitude
}

/** The exact host double rounded into the format; null when it cannot be represented. */
export function numberToDec(value: number, format: DecFormat): bigint | null {
	if (!Number.isFinite(value)) return null
	if (value === 0) return 0n
	const view = new DataView(new ArrayBuffer(8))
	view.setFloat64(0, value)
	const raw = view.getBigUint64(0), field = Number(raw >> 52n & 0x7ffn), fraction = raw & 0xfffffffffffffn
	const packed = packDec(value < 0, field ? fraction | 1n << 52n : fraction, (field || 1) - 1075, format)
	return packed.overflow ? null : packed.image
}

/** Exact decimal text, such as `-1.25`, `3` or `6.02E23`, rounded into the format. */
export function decimalToDec(text: string, format: DecFormat): DecPacked | null {
	const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:E([+-]?\d+))?$/i.exec(text.trim())
	if (!match || !(match[2] + (match[3] ?? ''))) return null
	const digits = BigInt(match[2] + (match[3] ?? '') || '0'), scale = Number(match[4] ?? 0) - (match[3] ?? '').length
	if (Math.abs(scale) > 10000) return null
	return scale >= 0 ? packDec(match[1] === '-', digits * 10n ** BigInt(scale), 0, format) : packDec(match[1] === '-', digits, 0, format, 10n ** BigInt(-scale))
}
