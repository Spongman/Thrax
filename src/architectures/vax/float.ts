import { binaryNegate, calculateBinary, compareBinary, integerBinary, type BinaryFloat } from '../../core/binaryFloat'
import { DEC_D, DEC_F, DEC_G, DEC_H, packDec, unpackDec, type DecFormat } from '../../core/decFloat'

/** A VAX exception with no handler to vector to; the step is undone and reported. */
export class VaxFault extends Error {}

/** Indexed by the data type codes in isa.ts: F, D, G and H follow the five integer types. */
export const FLOAT_FORMATS: readonly (DecFormat | undefined)[] = [undefined, undefined, undefined, undefined, undefined, DEC_F, DEC_D, DEC_G, DEC_H]

const toImage = (raw: number | bigint) => typeof raw === 'bigint' ? raw : BigInt(raw >>> 0)
const fromImage = (image: bigint, format: DecFormat): number | bigint => format.bytes === 4 ? Number(image) : image

export function unpack(raw: number | bigint, format: DecFormat): BinaryFloat {
	const value = unpackDec(toImage(raw), format)
	if (!value) throw new VaxFault('Reserved operand fault: floating operand has sign set and exponent zero')
	return value
}

export function pack(value: BinaryFloat, format: DecFormat, denominator = 1n): number | bigint {
	const packed = packDec(value.negative, value.significand, value.exponent, format, denominator)
	if (packed.overflow) throw new VaxFault('Floating overflow fault')
	return fromImage(packed.image, format)
}

const working = (format: DecFormat) => ({ precision: format.fractionBits + 1, minExponent: -(2 ** 30), maxExponent: 2 ** 30 })

/** `left op right`, rounded once to the destination format. */
export function arithmetic(op: 'add' | 'sub' | 'mul' | 'div', left: number | bigint, right: number | bigint, format: DecFormat): number | bigint {
	const a = unpack(left, format), b = unpack(right, format)
	if (op === 'div' && b.significand === 0n) throw new VaxFault('Floating divide-by-zero fault')
	const result = calculateBinary(op === 'sub' ? 'add' : op === 'mul' ? 'multiply' : op === 'div' ? 'divide' : 'add', a, op === 'sub' ? binaryNegate(b) : b, working(format), 'away').value
	return pack(result, format)
}

export function compare(left: number | bigint, right: number | bigint, format: DecFormat): number {
	return compareBinary(unpack(left, format), unpack(right, format)) ?? 0
}

export function negate(raw: number | bigint, format: DecFormat): number | bigint {
	const value = unpack(raw, format)
	return value.significand === 0n ? fromImage(0n, format) : pack(binaryNegate(value), format)
}

export function convert(raw: number | bigint, from: DecFormat, to: DecFormat): number | bigint {
	return pack(unpack(raw, from), to)
}

export function fromInteger(value: bigint, format: DecFormat): number | bigint {
	return pack({ negative: value < 0n, significand: value < 0n ? -value : value, exponent: 0 }, format)
}

/** Truncated toward zero, or rounded with ties away from zero for CVTR. */
export function toInteger(raw: number | bigint, format: DecFormat, round: boolean): bigint {
	return integerBinary(unpack(raw, format), round ? 'away' : 'zero')!.value
}

/** Sign and zero tests read the first word only. */
export function isNegative(raw: number | bigint, format: DecFormat): boolean { return !!(toImage(raw) >> 15n & 1n) && !isZero(raw, format) }
export function isZero(raw: number | bigint, format: DecFormat): boolean { return unpack(raw, format).significand === 0n }

/** Six-bit floating short literal: 0.1fff x 2^eee, from 0.5 to 120. */
export function floatLiteral(literal: number, format: DecFormat): number | bigint {
	return pack({ negative: false, significand: BigInt(8 + (literal & 7)), exponent: (literal >> 3) - 4 }, format)
}

/** The short literal holding exactly this value, if any. */
export function literalFor(raw: number | bigint, format: DecFormat): number | null {
	for (let literal = 0; literal < 64; literal++) if (toImage(floatLiteral(literal, format)) === toImage(raw)) return literal
	return null
}

export const formatOf = (type: number): DecFormat => FLOAT_FORMATS[type]!
export const imageOf = toImage
