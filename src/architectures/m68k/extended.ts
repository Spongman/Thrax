import {
	BinaryException as E,
	binaryInfinity,
	binaryInteger,
	binaryNaN,
	binaryZero,
	packBinary,
	roundBinary,
	unpackBinary,
	type BinaryFloat,
	type BinaryFormat,
	type BinaryResult,
	type BinaryRounding
} from '../../core/binaryFloat'

/**
 * MC68881 extended precision: sign, 15-bit exponent and a 64-bit mantissa with an
 * explicit integer bit. Unlike the x87, a zero exponent field still scales by
 * 2^-16383, so values are held as exact 80-bit patterns and decoded without
 * normalization. Arithmetic is exact via the shared bigint binary float core.
 */
export const EXTENDED: BinaryFormat = { precision: 64, minExponent: -16383, maxExponent: 16383 }
export const SINGLE: BinaryFormat = { precision: 24, minExponent: -126, maxExponent: 127 }
export const DOUBLE: BinaryFormat = { precision: 53, minExponent: -1022, maxExponent: 1023 }
const MANTISSA = (1n << 64n) - 1n
const QUIET = 1n << 62n
export const DEFAULT_NAN = (0x7fffn << 64n) | MANTISSA
const bitLength = (value: bigint) => (value === 0n ? 0 : value.toString(2).length)

export const isNaN80 = (raw: bigint) => (Number(raw >> 64n) & 0x7fff) === 0x7fff && (raw & (QUIET * 2n - 1n)) !== 0n
export const isSignalingNaN80 = (raw: bigint) => isNaN80(raw) && !(raw & QUIET)
export const quietNaN80 = (raw: bigint) => raw | QUIET

export function unpack80(raw: bigint): BinaryFloat {
	const negative = !!(raw >> 79n),
		field = Number(raw >> 64n) & 0x7fff,
		mantissa = raw & MANTISSA
	if (field === 0x7fff) return (mantissa & (QUIET * 2n - 1n)) === 0n ? binaryInfinity(negative) : { ...binaryNaN(), negative }
	return { negative, significand: mantissa, exponent: field - 16383 - 63 }
}
export function pack80(value: BinaryFloat): bigint {
	const sign = BigInt(value.negative) << 79n
	if (value.special === 'infinity') return sign | (0x7fffn << 64n)
	// A NaN the FPU creates is always the positive default NaN.
	if (value.special === 'nan') return DEFAULT_NAN
	if (!value.significand) return sign
	const top = bitLength(value.significand) - 1 + value.exponent
	if (top >= -16383) {
		const shift = 63 - (bitLength(value.significand) - 1)
		const mantissa = shift >= 0 ? value.significand << BigInt(shift) : value.significand >> BigInt(-shift)
		return sign | (BigInt(top + 16383) << 64n) | mantissa
	}
	const shift = value.exponent + 16446
	return sign | (shift >= 0 ? value.significand << BigInt(shift) : value.significand >> BigInt(-shift))
}

/** The 96-bit memory format: exponent word, a zero word, then the mantissa. */
export const toMemory96 = (raw: bigint) => ((raw >> 64n) << 80n) | (raw & MANTISSA)
export const fromMemory96 = (bits: bigint) => ((bits >> 80n) << 64n) | (bits & MANTISSA)

export const precisionFormat = (precision: number): BinaryFormat => ({ ...EXTENDED, precision })
export function round(value: BinaryFloat, format: BinaryFormat, mode: BinaryRounding): BinaryResult {
	if (value.special || !value.significand) return { value, flags: 0, roundedUp: false }
	return roundBinary(value.negative, value.significand, value.exponent, 1n, format, mode)
}

/** IEEE single/double bits. NaN payloads move into the high fraction bits. */
export function fromIeee(bits: bigint, double: boolean): { value: BinaryFloat; raw: bigint } {
	const fraction = double ? 52 : 23,
		value = unpackBinary(bits, fraction, double ? 11 : 8)
	if (value.special === 'nan') {
		const payload = (bits & ((1n << BigInt(fraction)) - 1n)) << BigInt(63 - fraction)
		return { value, raw: (BigInt(value.negative) << 79n) | (0x7fffn << 64n) | (1n << 63n) | payload }
	}
	return { value, raw: pack80(value) }
}
export function toIeee(raw: bigint, value: BinaryFloat, double: boolean, mode: BinaryRounding): { bits: bigint; flags: number } {
	const fraction = double ? 52 : 23,
		exponentBits = double ? 11 : 8
	if (value.special === 'nan') {
		const sign = BigInt(value.negative) << BigInt(fraction + exponentBits)
		const exponent = ((1n << BigInt(exponentBits)) - 1n) << BigInt(fraction)
		return { bits: sign | exponent | ((raw & ((1n << 63n) - 1n)) >> BigInt(63 - fraction)) | (1n << BigInt(fraction - 1)), flags: 0 }
	}
	const rounded = round(value, double ? DOUBLE : SINGLE, mode)
	return { bits: packBinary(rounded.value, fraction, exponentBits), flags: rounded.flags }
}

const view = new DataView(new ArrayBuffer(8))
export function toDouble(value: BinaryFloat): number {
	if (value.special === 'nan') return NaN
	if (value.special === 'infinity') return value.negative ? -Infinity : Infinity
	view.setBigUint64(0, toIeee(0n, value, true, 'nearest').bits)
	return view.getFloat64(0)
}
export function fromDouble(value: number): BinaryFloat {
	view.setFloat64(0, value)
	return unpackBinary(view.getBigUint64(0), 52, 11)
}
export const describe80 = (raw: bigint) => {
	const value = unpack80(raw)
	if (value.special === 'nan') return 'NaN'
	if (!value.special && value.significand && Math.abs(bitLength(value.significand) - 1 + value.exponent) > 1000) {
		const exponent = bitLength(value.significand) - 1 + value.exponent
		return `${value.negative ? '-' : ''}${toDouble({ ...value, exponent: value.exponent - exponent })}×2^${exponent}`
	}
	const number = toDouble(value)
	return Object.is(number, -0) ? '-0' : String(number)
}

/** Decimal text such as `-1.25e3` as an exact rational, rounded once. */
export function parseDecimal(text: string, format: BinaryFormat = EXTENDED, mode: BinaryRounding = 'nearest'): BinaryResult | null {
	const match = /^([-+]?)(\d*)(?:\.(\d*))?(?:e([-+]?\d+))?$/i.exec(text.trim())
	if (!match || !(match[2] + (match[3] ?? ''))) return null
	const digits = BigInt(match[2] + (match[3] ?? '') || '0'),
		exponent = Number(match[4] ?? 0) - (match[3] ?? '').length
	return decimal(match[1] === '-', digits, exponent, format, mode)
}
function decimal(negative: boolean, digits: bigint, exponent: number, format: BinaryFormat, mode: BinaryRounding): BinaryResult {
	if (digits === 0n) return { value: binaryZero(negative), flags: 0, roundedUp: false }
	if (exponent > 5000) return { value: binaryInfinity(negative), flags: E.overflow | E.inexact, roundedUp: false }
	if (exponent < -5000) return { value: binaryZero(negative), flags: E.underflow | E.inexact, roundedUp: false }
	return exponent >= 0
		? roundBinary(negative, digits * 10n ** BigInt(exponent), 0, 1n, format, mode)
		: roundBinary(negative, digits, 0, 10n ** BigInt(-exponent), format, mode)
}

/** Packed decimal real: SM SE YY, three exponent digits, one integer and 16 fraction digits. */
export function fromPacked(bits: bigint, mode: BinaryRounding, format: BinaryFormat): { value: BinaryFloat; raw?: bigint; flags: number } {
	const negative = !!(bits >> 95n),
		exponentNegative = !!((bits >> 94n) & 1n),
		exponentField = Number((bits >> 80n) & 0xfffn),
		mantissa = bits & ((1n << 68n) - 1n)
	if (exponentField === 0xfff && (bits >> 92n & 3n) === 3n) {
		const fraction = bits & ((1n << 64n) - 1n)
		if (!fraction) return { value: binaryInfinity(negative), flags: 0 }
		return { value: { ...binaryNaN(), negative }, raw: (BigInt(negative) << 79n) | (0x7fffn << 64n) | fraction, flags: 0 }
	}
	let digits = 0n,
		exponent = 0
	for (let i = 16; i >= 0; i--) {
		const digit = (mantissa >> BigInt(i * 4)) & 15n
		if (digit > 9n) return { value: binaryNaN(), flags: E.invalid }
		digits = digits * 10n + digit
	}
	for (let i = 2; i >= 0; i--) {
		const digit = (exponentField >> (i * 4)) & 15
		if (digit > 9) return { value: binaryNaN(), flags: E.invalid }
		exponent = exponent * 10 + digit
	}
	const computed = decimal(negative, digits, (exponentNegative ? -exponent : exponent) - 16, format, mode)
	return { value: computed.value, flags: computed.flags }
}
/**
 * k > 0 keeps k significant digits (at most 17); k <= 0 keeps -k digits right of
 * the decimal point. A fourth exponent digit, for |exponent| > 999, sets OPERR.
 */
export function toPacked(raw: bigint, value: BinaryFloat, k: number, mode: BinaryRounding): { bits: bigint; flags: number } {
	const sign = BigInt(value.negative) << 95n
	if (value.special === 'infinity') return { bits: sign | (0x7fffn << 80n), flags: 0 }
	if (value.special === 'nan') return { bits: sign | (0x7fffn << 80n) | (raw & MANTISSA), flags: 0 }
	if (!value.significand) return { bits: sign, flags: 0 }
	let flags = 0
	if (k > 17) {
		flags |= E.invalid
		k = 17
	}
	// Exact |value| = n / d.
	const n = value.exponent >= 0 ? value.significand << BigInt(value.exponent) : value.significand,
		d = value.exponent >= 0 ? 1n : 1n << BigInt(-value.exponent)
	let e10 = Math.floor((bitLength(value.significand) - 1 + value.exponent) * Math.log10(2))
	const atLeast = (power: number) => (power >= 0 ? n >= d * 10n ** BigInt(power) : n * 10n ** BigInt(-power) >= d)
	while (atLeast(e10 + 1)) e10++
	while (!atLeast(e10)) e10--
	const scaled = (count: number) => {
		const shift = count - 1 - e10,
			[num, den] = shift >= 0 ? [n * 10n ** BigInt(shift), d] : [n, d * 10n ** BigInt(-shift)]
		const q = num / den,
			r = num % den
		const up =
			r !== 0n &&
			(mode === 'nearest'
				? r * 2n > den || (r * 2n === den && !!(q & 1n))
				: mode === 'down'
					? value.negative
					: mode === 'up'
						? !value.negative
						: false)
		return { q: q + BigInt(up), inexact: r !== 0n }
	}
	let count = k > 0 ? k : Math.min(17, e10 + 1 - k)
	if (count < 1) count = 1
	let { q, inexact } = scaled(count)
	if (q >= 10n ** BigInt(count)) {
		e10++
		;({ q, inexact } = scaled(count))
	}
	if (inexact) flags |= E.inexact
	const digits = q * 10n ** BigInt(17 - count),
		exponent = Math.abs(e10)
	if (exponent > 999) flags |= E.invalid
	let mantissa = 0n
	for (let i = 0, rest = digits; i < 17; i++, rest /= 10n) mantissa |= (rest % 10n) << BigInt(i * 4)
	let field = 0n
	for (let i = 0, rest = exponent; i < 4; i++, rest = Math.floor(rest / 10)) field |= BigInt(rest % 10) << BigInt(i * 4)
	// Digits 0-2 form the exponent field; a fourth digit goes in bits 79-76.
	const bits = sign | (BigInt(e10 < 0) << 94n) | ((field & 0xfffn) << 80n) | ((field >> 12n) << 76n) | mantissa
	return { bits, flags }
}

// Constants by fixed-point series at 256 fraction bits.
const BITS = 256n,
	ONE = 1n << BITS
function atanhInverse(n: bigint) {
	let sum = 0n
	for (let k = 1n, power = ONE / n; power; k += 2n, power /= n * n) sum += power / k
	return sum
}
function atanInverse(n: bigint) {
	let sum = 0n,
		sign = 1n
	for (let k = 1n, power = ONE / n; power; k += 2n, power /= n * n, sign = -sign) sum += (sign * power) / k
	return sum
}
let constants: Map<number, bigint | 'exact'> | null = null
function constantTable() {
	if (constants) return constants
	const ln2 = 2n * atanhInverse(3n),
		ln10 = 3n * ln2 + 2n * atanhInverse(9n),
		pi = 16n * atanInverse(5n) - 4n * atanInverse(239n)
	let e = 0n
	for (let k = 0n, term = ONE; term; k++, term /= k) e += term
	constants = new Map<number, bigint | 'exact'>([
		[0x00, pi],
		[0x0b, (ln2 << BITS) / ln10],
		[0x0c, e],
		[0x0d, (ONE << BITS) / ln2],
		[0x0e, (ONE << BITS) / ln10],
		[0x0f, 'exact'],
		[0x30, ln2],
		[0x31, ln10]
	])
	for (let i = 0; i < 14; i++) constants.set(0x32 + i, 'exact')
	return constants
}
export const ROM_OFFSETS = [0x00, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, ...Array.from({ length: 16 }, (_, i) => 0x30 + i)]
/** FMOVECR: correctly rounded constants; offsets $32-$3F are 10^0, 10^1, 10^2, 10^4 ... 10^4096. */
export function romConstant(offset: number, format: BinaryFormat, mode: BinaryRounding): BinaryResult | null {
	const entry = constantTable().get(offset)
	if (entry === undefined) return null
	if (offset === 0x0f) return { value: binaryZero(), flags: 0, roundedUp: false }
	if (entry === 'exact') {
		const power = offset === 0x32 ? 0n : 1n << BigInt(offset - 0x33)
		return roundBinary(false, 10n ** power, 0, 1n, format, mode)
	}
	// The truncated tail is nonzero, so a +1 keeps directed rounding and INEX honest.
	return roundBinary(false, entry * 2n + 1n, -Number(BITS) - 1, 1n, format, mode)
}

export { binaryInteger, binaryNaN, binaryZero, binaryInfinity }
