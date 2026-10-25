/**
 * DEC PDP-11 F (32-bit) and D (64-bit) floating point, as the FP11 and FIS
 * store it.  Not IEEE: a sign, an excess-128 exponent and a fraction with a
 * hidden leading one, read as 0.1fff... x 2^(exp-128).  Exponent 0 is zero
 * (or, with the sign set, the FP11 "undefined variable"); there are no
 * infinities, NaNs or denormals.
 *
 * Every value here is a 64-bit D-layout bigint: bit 63 sign, 62-55 exponent,
 * 54-0 fraction.  An F value is the upper 32 bits with the lower 32 ignored.
 * Arithmetic is exact over BigInt and rounds once, so D keeps its 56 bits.
 */

export const F_PRECISION = 24, D_PRECISION = 56
const FRACTION = 0x7fffffffffffffn

/** m x 2^e, exact. */
export interface Exact { negative: boolean, m: bigint, e: number }

export interface Rounded {
	raw: bigint
	/** The exponent passed 255; `raw` holds it modulo 256, as the FP11 stores it. */
	overflow: boolean
	/** The exponent fell below 1; `raw` is an exact zero. */
	underflow: boolean
}

export const precisionOf = (double: boolean) => double ? D_PRECISION : F_PRECISION
export const exponentOf = (raw: bigint) => Number(raw >> 55n & 255n)
export const isNegative = (raw: bigint) => (raw >> 63n & 1n) === 1n
/** The FP11 "undefined variable": minus zero. */
export const isUndefined = (raw: bigint) => exponentOf(raw) === 0 && isNegative(raw)

/** Bits beyond the precision are ignored: an F operand reads only its upper 32. */
export function unpack(raw: bigint, double: boolean): Exact {
	const negative = isNegative(raw), exponent = exponentOf(raw)
	if (!exponent) return { negative, m: 0n, e: 0 }
	const p = precisionOf(double), fraction = (raw & FRACTION) >> BigInt(56 - p)
	return { negative, m: 1n << BigInt(p - 1) | fraction, e: exponent - 128 - p }
}

const bitLength = (value: bigint) => value === 0n ? 0 : value.toString(2).length

/** Round an exact value to F or D: half away from zero, or chopped when `truncate`. */
export function round(value: Exact, double: boolean, truncate = false): Rounded {
	let { m, e } = value
	if (m < 0n) throw new RangeError('Magnitude must be nonnegative')
	if (m === 0n) return { raw: 0n, overflow: false, underflow: false }
	const p = precisionOf(double), shift = bitLength(m) - p
	if (shift > 0) {
		const guard = m >> BigInt(shift - 1) & 1n
		m >>= BigInt(shift)
		e += shift
		if (guard && !truncate) {
			m += 1n
			if (m >> BigInt(p)) { m >>= 1n; e++ }
		}
	} else { m <<= BigInt(-shift); e += shift }
	const exponent = e + p + 128
	if (exponent < 1) return { raw: 0n, overflow: false, underflow: true }
	const raw = (value.negative ? 1n << 63n : 0n) | BigInt(exponent & 255) << 55n | (m & (1n << BigInt(p - 1)) - 1n) << BigInt(56 - p)
	return { raw, overflow: exponent > 255, underflow: false }
}

function align(a: Exact, b: Exact): [bigint, bigint, number] {
	const e = Math.min(a.e, b.e)
	return [a.m << BigInt(a.e - e), b.m << BigInt(b.e - e), e]
}

export function add(a: Exact, b: Exact): Exact {
	if (!a.m) return b
	if (!b.m) return a
	const [x, y, e] = align(a, b), sum = (a.negative ? -x : x) + (b.negative ? -y : y)
	return { negative: sum < 0n, m: sum < 0n ? -sum : sum, e }
}

export const negate = (a: Exact): Exact => ({ ...a, negative: !a.negative })
export const multiply = (a: Exact, b: Exact): Exact => ({ negative: a.negative !== b.negative, m: a.m * b.m, e: a.e + b.e })

/** Enough quotient bits that the first discarded one is exact; a remainder never matters to half-away rounding. */
export function divide(a: Exact, b: Exact): Exact {
	if (!b.m) throw new RangeError('Division by zero')
	const k = Math.max(0, D_PRECISION + 2 + bitLength(b.m) - bitLength(a.m))
	return { negative: a.negative !== b.negative, m: (a.m << BigInt(k)) / b.m, e: a.e - b.e - k }
}

export function compare(a: Exact, b: Exact): number {
	const difference = add(a, negate(b))
	return difference.m === 0n ? 0 : difference.negative ? -1 : 1
}

export const fromInteger = (value: bigint): Exact => ({ negative: value < 0n, m: value < 0n ? -value : value, e: 0 })

/** Truncate toward zero, as STCFI and STCDI do. */
export function toInteger(a: Exact): bigint {
	const magnitude = a.e >= 0 ? a.m << BigInt(a.e) : a.m >> BigInt(-a.e)
	return a.negative ? -magnitude : magnitude
}

/** Split into the integer and fraction parts, both exact, as MODF needs. */
export function splitInteger(a: Exact): [Exact, Exact] {
	const whole = a.e >= 0 ? a.m : a.m >> BigInt(-a.e) << BigInt(-a.e)
	return [{ negative: a.negative, m: whole, e: a.e }, { negative: a.negative, m: a.m - whole, e: a.e }]
}

/** A decimal literal, rounded once to F or D; null when the text is not one. */
export function parseDecimal(text: string, double: boolean): Rounded | null {
	const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text.trim())
	if (!match || !(match[2] || match[3])) return null
	const digits = `${match[2]}${match[3] ?? ''}`, scale = Number(match[4] ?? 0) - (match[3]?.length ?? 0)
	if (!Number.isSafeInteger(scale) || Math.abs(scale) > 400) return null
	const negative = match[1] === '-', numerator = BigInt(digits || '0')
	if (numerator === 0n) return { raw: 0n, overflow: false, underflow: false }
	if (scale >= 0) return round({ negative, m: numerator * 10n ** BigInt(scale), e: 0 }, double)
	return round(divide({ negative, m: numerator, e: 0 }, { negative: false, m: 10n ** BigInt(-scale), e: 0 }), double)
}

/** `digits` significant decimal digits of a positive exact value, rounded half up, with the power of ten of the last digit. */
function decimalDigits(m: bigint, e: number, digits: number): [bigint, number] {
	const numerator = e >= 0 ? m << BigInt(e) : m, denominator = e >= 0 ? 1n : 1n << BigInt(-e)
	let power = numerator.toString().length - denominator.toString().length - digits + 1
	for (;;) {
		const scaledNumerator = power < 0 ? numerator * 10n ** BigInt(-power) : numerator
		const scaledDenominator = power > 0 ? denominator * 10n ** BigInt(power) : denominator
		const value = (2n * scaledNumerator + scaledDenominator) / (2n * scaledDenominator)
		const length = value.toString().length
		if (length === digits || value === 0n) return [value, power]
		power += length > digits ? 1 : -1
	}
}

/** The shortest decimal that reads back as the same F or D value. */
export function formatDecimal(raw: bigint, double: boolean): string {
	if (isUndefined(raw)) return '-0 (undefined)'
	const value = unpack(raw, double)
	if (!value.m) return '0'
	const exact = round(value, double).raw
	let shown = ''
	for (let digits = 1; digits <= 20; digits++) {
		const [mantissa, power] = decimalDigits(value.m, value.e, digits)
		const text = `${mantissa}e${power}`
		shown = text
		if (parseDecimal(text, double)?.raw === exact) break
	}
	const [, mantissa, powerText] = /^(\d+)e(-?\d+)$/.exec(shown)!
	const trimmed = mantissa.replace(/0+$/, '') || '0', power = Number(powerText) + mantissa.length - trimmed.length
	const point = trimmed.length + power
	const body = point > 21 || point < -5 ? `${trimmed[0]}${trimmed.length > 1 ? `.${trimmed.slice(1)}` : ''}e${point - 1 >= 0 ? '+' : ''}${point - 1}`
		: point <= 0 ? `0.${'0'.repeat(-point)}${trimmed}`
			: point >= trimmed.length ? `${trimmed}${'0'.repeat(point - trimmed.length)}`
				: `${trimmed.slice(0, point)}.${trimmed.slice(point)}`
	return `${value.negative ? '-' : ''}${body}`
}

/** Words in memory order: the first holds the sign, exponent and high fraction. */
export function toWords(raw: bigint, double: boolean): number[] {
	return Array.from({ length: double ? 4 : 2 }, (_, i) => Number(raw >> BigInt(48 - 16 * i) & 0xffffn))
}

export function fromWords(words: readonly number[]): bigint {
	return words.reduce((raw, word, i) => raw | BigInt(word & 0xffff) << BigInt(48 - 16 * i), 0n)
}
