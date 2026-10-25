import { describe, expect, it } from 'vitest'
import { BinaryException as E, binaryInfinity, binaryInteger, binaryZero, calculateBinary, compareBinary, EXTENDED_FORMAT, integerBinary, packBinary, roundBinary, sqrtBinary, unpackBinary } from '../binaryFloat'

const extended = (value: ReturnType<typeof binaryInteger>) => packBinary(value, 63, 15, true)
describe('exact binary floating point primitives', () => {
	it.each([[0n, 0n], [1n, 0x3fff8000000000000000n], [-2n, 0xc0008000000000000000n], [9007199254740993n, 0x40348000000000000400n]])('preserves integer %s beyond host precision', (integer, bits) => {
		expect(extended(binaryInteger(integer))).toBe(bits)
		expect(integerBinary(unpackBinary(bits, 63, 15, true), 'zero')?.value).toBe(integer)
	})
	it.each([['nearest', 0x3fff8000000000000000n], ['up', 0x3fff8000000000000001n], ['down', 0x3fff8000000000000000n], ['zero', 0x3fff8000000000000000n]] as const)('rounds a half-ulp tie using %s', (mode, bits) => {
		const sum = calculateBinary('add', binaryInteger(1n), { negative: false, significand: 1n, exponent: -64 }, EXTENDED_FORMAT, mode)
		expect(extended(sum.value)).toBe(bits); expect(sum.flags).toBe(E.inexact)
	})
	it('keeps division and square roots at 64 significand bits', () => {
		expect(extended(calculateBinary('divide', binaryInteger(1n), binaryInteger(3n)).value)).toBe(0x3ffdaaaaaaaaaaaaaaabn)
		expect(extended(sqrtBinary(binaryInteger(2n)).value)).toBe(0x3fffb504f333f9de6484n)
		expect(sqrtBinary(binaryInteger(4n)).flags).toBe(0)
	})
	it('separates signed zero, infinity, invalid operation and zero divide', () => {
		expect(extended(binaryZero(true))).toBe(0x80000000000000000000n)
		expect(calculateBinary('divide', binaryInteger(1n), binaryZero()).flags).toBe(E.zeroDivide)
		expect(calculateBinary('divide', binaryZero(), binaryZero()).flags).toBe(E.invalid)
		expect(calculateBinary('multiply', binaryInfinity(), binaryZero()).flags).toBe(E.invalid)
		expect(compareBinary(binaryInfinity(true), binaryInteger(-1n))).toBe(-1)
	})
	it('rounds overflow and gradual underflow without huge shifts', () => {
		expect(roundBinary(false, 1n, 1000000).flags).toBe(E.overflow | E.inexact)
		expect(extended(roundBinary(false, 1n, -1000000, 1n, EXTENDED_FORMAT, 'up').value)).toBe(1n)
		expect(extended(roundBinary(false, 1n, -16445).value)).toBe(1n)
		expect(roundBinary(false, 1n, -16445).flags).toBe(0)
		expect(extended(roundBinary(false, 1n, -16446).value)).toBe(0n)
	})
	it.each([0x3f800000n, 0x80000000n, 1n, 0x7f800000n])('round-trips independently specified binary32 bits %s', bits => {
		expect(packBinary(unpackBinary(bits, 23, 8), 23, 8)).toBe(bits)
	})
})
