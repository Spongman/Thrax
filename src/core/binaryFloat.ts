/** Exact finite binary arithmetic; CPU adapters own instruction and status semantics. */
export interface BinaryFloat { negative: boolean; significand: bigint; exponent: number; special?: 'infinity' | 'nan' }
export interface BinaryFormat { precision: number; minExponent: number; maxExponent: number }
/** `away` is nearest with ties away from zero, as DEC VAX floating point rounds. */
export type BinaryRounding = 'nearest' | 'away' | 'down' | 'up' | 'zero'
export const BinaryException = { invalid: 1, denormal: 2, zeroDivide: 4, overflow: 8, underflow: 16, inexact: 32 } as const
export interface BinaryResult { value: BinaryFloat; flags: number; roundedUp: boolean }
export const EXTENDED_FORMAT: BinaryFormat = { precision: 64, minExponent: -16382, maxExponent: 16383 }
export const binaryZero = (negative = false): BinaryFloat => ({ negative, significand: 0n, exponent: 0 })
export const binaryInfinity = (negative = false): BinaryFloat => ({ ...binaryZero(negative), special: 'infinity' })
export const binaryNaN = (): BinaryFloat => ({ ...binaryZero(true), special: 'nan' })
const result = (value: BinaryFloat, flags = 0, roundedUp = false): BinaryResult => ({ value, flags, roundedUp })
const bits = (value: bigint) => value === 0n ? 0 : value.toString(2).length
const scaled = (n: bigint, d: bigint, shift: number): [bigint, bigint] => shift >= 0 ? [n << BigInt(shift), d] : [n, d << BigInt(-shift)]
const increment = (mode: BinaryRounding, negative: boolean, quotient: bigint, remainder: bigint, denominator: bigint) => remainder !== 0n && (mode === 'away' ? remainder * 2n >= denominator : mode === 'nearest' ? remainder * 2n > denominator || remainder * 2n === denominator && !!(quotient & 1n) : mode === 'down' ? negative : mode === 'up' ? !negative : false)

export function roundBinary(negative: boolean, numerator: bigint, exponent: number, denominator = 1n, format = EXTENDED_FORMAT, mode: BinaryRounding = 'nearest'): BinaryResult {
	if (numerator === 0n) return result(binaryZero(negative))
	let ratioExponent = bits(numerator) - bits(denominator)
	const [test, base] = scaled(numerator, denominator, -ratioExponent)
	if (test < base) ratioExponent--
	const top = ratioExponent + exponent
	const overflow = () => result(mode === 'nearest' || mode === 'up' && !negative || mode === 'down' && negative ? binaryInfinity(negative) : { negative, significand: (1n << BigInt(format.precision)) - 1n, exponent: format.maxExponent - format.precision + 1 }, BinaryException.overflow | BinaryException.inexact)
	if (top > format.maxExponent) return overflow()
	const quantum = Math.max(top, format.minExponent) - format.precision + 1
	// Avoid an unbounded shift for a huge FSCALE exponent.
	if (top < quantum - 1) {
		const up = mode === 'up' && !negative || mode === 'down' && negative
		return result({ negative, significand: up ? 1n : 0n, exponent: quantum }, BinaryException.underflow | BinaryException.inexact, up)
	}
	const [n, d] = scaled(numerator, denominator, exponent - quantum)
	const quotient = n / d, remainder = n % d, up = increment(mode, negative, quotient, remainder, d)
	const significand = quotient + BigInt(up)
	if (bits(significand) + quantum - 1 > format.maxExponent) return overflow()
	return result({ negative, significand, exponent: quantum }, remainder ? BinaryException.inexact | (top < format.minExponent ? BinaryException.underflow : 0) : 0, up)
}

export function binaryInteger(value: bigint): BinaryFloat { return { negative: value < 0n, significand: value < 0n ? -value : value, exponent: 0 } }
export function binaryNegate(value: BinaryFloat): BinaryFloat { return { ...value, negative: !value.negative } }
export function compareBinary(a: BinaryFloat, b: BinaryFloat): -1 | 0 | 1 | null {
	if (a.special === 'nan' || b.special === 'nan') return null
	if (a.special === 'infinity' || b.special === 'infinity') return a.special === b.special && a.negative === b.negative ? 0 : a.special === 'infinity' ? a.negative ? -1 : 1 : b.negative ? 1 : -1
	if (a.significand === 0n && b.significand === 0n) return 0
	if (a.negative !== b.negative) return a.negative ? -1 : 1
	const exponent = Math.min(a.exponent, b.exponent), left = a.significand << BigInt(a.exponent - exponent), right = b.significand << BigInt(b.exponent - exponent)
	return left === right ? 0 : (left < right !== a.negative) ? -1 : 1
}
export function calculateBinary(operation: 'add' | 'multiply' | 'divide', a: BinaryFloat, b: BinaryFloat, format = EXTENDED_FORMAT, mode: BinaryRounding = 'nearest'): BinaryResult {
	if (a.special === 'nan' || b.special === 'nan') return result(binaryNaN())
	const negative = a.negative !== b.negative
	if (operation === 'add') {
		if (a.special || b.special) return a.special && b.special && negative ? result(binaryNaN(), BinaryException.invalid) : result(a.special ? a : b)
		const exponent = Math.min(a.exponent, b.exponent)
		const sum = (a.negative ? -a.significand : a.significand) << BigInt(a.exponent - exponent)
		const value = sum + ((b.negative ? -b.significand : b.significand) << BigInt(b.exponent - exponent))
		return roundBinary(value === 0n ? a.negative && b.negative || negative && mode === 'down' : value < 0n, value < 0n ? -value : value, exponent, 1n, format, mode)
	}
	if (operation === 'multiply') {
		if (a.special || b.special) return !a.special && a.significand === 0n || !b.special && b.significand === 0n ? result(binaryNaN(), BinaryException.invalid) : result(binaryInfinity(negative))
		return roundBinary(negative, a.significand * b.significand, a.exponent + b.exponent, 1n, format, mode)
	}
	if (a.special && b.special || !a.special && !b.special && a.significand === 0n && b.significand === 0n) return result(binaryNaN(), BinaryException.invalid)
	if (a.special) return result(binaryInfinity(negative))
	if (b.special) return result(binaryZero(negative))
	if (b.significand === 0n) return result(binaryInfinity(negative), BinaryException.zeroDivide)
	return roundBinary(negative, a.significand, a.exponent - b.exponent, b.significand, format, mode)
}
export function integerBinary(value: BinaryFloat, mode: BinaryRounding): { value: bigint, inexact: boolean, roundedUp: boolean } | null {
	if (value.special) return null
	const [n, d] = scaled(value.significand, 1n, value.exponent), quotient = n / d, remainder = n % d
	const up = increment(mode, value.negative, quotient, remainder, d), magnitude = quotient + BigInt(up)
	return { value: value.negative ? -magnitude : magnitude, inexact: remainder !== 0n, roundedUp: up }
}
function integerSqrt(value: bigint): bigint {
	if (value < 2n) return value
	let root = 1n << BigInt(Math.ceil(bits(value) / 2)), next = (root + value / root) >> 1n
	while (next < root) { root = next; next = (root + value / root) >> 1n }
	return root
}
export function sqrtBinary(value: BinaryFloat, format = EXTENDED_FORMAT, mode: BinaryRounding = 'nearest'): BinaryResult {
	if (value.special === 'nan') return result(value)
	if (value.negative && (value.special || value.significand)) return result(binaryNaN(), BinaryException.invalid)
	if (value.special || value.significand === 0n) return result(value)
	const top = Math.floor((bits(value.significand) - 1 + value.exponent) / 2), quantum = Math.max(top, format.minExponent) - format.precision + 1
	const [n, d] = scaled(value.significand, 1n, value.exponent - quantum * 2), quotient = integerSqrt(n / d), exact = n === quotient * quotient * d
	const up = !exact && (mode === 'up' || mode === 'nearest' && (4n * n > (2n * quotient + 1n) ** 2n * d || 4n * n === (2n * quotient + 1n) ** 2n * d && !!(quotient & 1n)))
	return result({ negative: false, significand: quotient + BigInt(up), exponent: quantum }, exact ? 0 : BinaryException.inexact, up)
}

/** IEEE interchange and explicit-integer extended storage. No host float conversion. */
export function unpackBinary(raw: bigint, fractionBits: number, exponentBits: number, explicitInteger = false): BinaryFloat {
	const storedBits = fractionBits + +explicitInteger, exponentMask = (1 << exponentBits) - 1, bias = (1 << exponentBits - 1) - 1
	const negative = !!(raw >> BigInt(storedBits + exponentBits)), field = Number(raw >> BigInt(storedBits)) & exponentMask, fraction = raw & ((1n << BigInt(storedBits)) - 1n)
	if (field === exponentMask) return fraction === (explicitInteger ? 1n << BigInt(fractionBits) : 0n) ? binaryInfinity(negative) : { ...binaryNaN(), negative }
	return { negative, significand: fraction | (!explicitInteger && field ? 1n << BigInt(fractionBits) : 0n), exponent: (field || 1) - bias - fractionBits }
}
export function packBinary(value: BinaryFloat, fractionBits: number, exponentBits: number, explicitInteger = false): bigint {
	const storedBits = fractionBits + +explicitInteger, exponentMask = (1 << exponentBits) - 1, bias = (1 << exponentBits - 1) - 1
	let field = 0, fraction = 0n
	if (value.special) { field = exponentMask; fraction = (explicitInteger ? 1n << BigInt(fractionBits) : 0n) | (value.special === 'nan' ? 1n << BigInt(fractionBits - 1) : 0n) }
	else if (value.significand) {
		const top = bits(value.significand) - 1 + value.exponent, quantum = Math.max(top, 1 - bias) - fractionBits
		fraction = value.exponent >= quantum ? value.significand << BigInt(value.exponent - quantum) : value.significand >> BigInt(quantum - value.exponent)
		field = top < 1 - bias ? 0 : top + bias
		if (!explicitInteger) fraction &= (1n << BigInt(fractionBits)) - 1n
	}
	return BigInt(value.negative) << BigInt(storedBits + exponentBits) | BigInt(field) << BigInt(storedBits) | fraction
}
