import { describe, expect, it } from 'vitest'
import { DEC_D, DEC_F, DEC_G, DEC_H, decimalToDec, decToNumber, numberToDec, unpackDec } from '../decFloat'
import { FLOAT_ENCODINGS, formatEncodedFloat } from '../floatEncodings'

// Images are memory read as a little-endian integer: VAX F 1.0 is the longword ^X4080.
describe('DEC floating formats', () => {
	it.each([
		[DEC_F, '1', 0x4080n], [DEC_F, '-2.5', 0xc120n], [DEC_F, '0.1', 0xcccd3eccn],
		[DEC_D, '1', 0x4080n], [DEC_D, '0.5', 0x4000n],
		[DEC_G, '1', 0x4010n], [DEC_H, '1', 0x4001n],
	] as const)('encodes %j %s', (format, text, image) => {
		expect(decimalToDec(text, format)!.image).toBe(image)
		expect(decToNumber(image, format)).toBe(format === DEC_F ? Math.fround(Number(text)) : Number(text))
	})

	it('has no denormals: exponent zero is zero, or a reserved operand with the sign set', () => {
		expect(unpackDec(0x7fn, DEC_F)).toEqual({ negative: false, significand: 0n, exponent: 0 })
		expect(unpackDec(0x8000n, DEC_F)).toBeNull()
		expect(decimalToDec('1e-40', DEC_F)).toMatchObject({ image: 0n, underflow: true })
		expect(decimalToDec('1e39', DEC_F)!.overflow).toBe(true)
		expect(numberToDec(Infinity, DEC_D)).toBeNull()
	})

	it('rounds a decimal exactly to the D_floating fraction, past a double’s precision', () => {
		// 0.1 in D: fraction 0xCCCCCCCCCCCCCD, words 3ECC CCCC CCCC CCCD.
		expect(decimalToDec('0.1', DEC_D)!.image).toBe(0xcccdcccccccc3eccn)
	})
})

describe('DEC register readings', () => {
	const dec = FLOAT_ENCODINGS.dec
	it('reads F from one register and D from a pair whose first register holds the sign word', () => {
		expect(dec.single(0x4080)).toBe(1)
		expect(dec.double(0, 0xc120)).toBe(-2.5)
		expect(dec.encodeDouble(-2.5)).toEqual({ high: 0xc120, low: 0 })
		expect(dec.encodeSingle(1)).toBe(0x4080)
	})

	it('formats the shortest decimal that encodes back to the same bits', () => {
		expect(formatEncodedFloat(dec, 0xcccd3ecc)).toBe('0.1')
		expect(formatEncodedFloat(dec, 0xcccdcccc, 0xcccc3ecc)).toBe('0.1')
		expect(formatEncodedFloat(dec, 0x8000)).toBe('reserved')
	})
})
