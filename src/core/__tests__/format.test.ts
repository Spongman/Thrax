import { describe, expect, it } from 'vitest'
import { formatHex, formatRegister, formatWord, formatWordDigits, parseWord } from '../format'

describe('formatWord', () => {
	it('renders a word as 0x-prefixed, zero-padded, uppercase hex', () => {
		expect(formatWord(0x0040000c)).toBe('0x0040000C')
		expect(formatWord(0)).toBe('0x00000000')
	})

	it('wraps negative and over-wide values to 32 bits', () => {
		expect(formatWord(-1)).toBe('0xFFFFFFFF')
	})
})

describe('formatWordDigits', () => {
	it('renders the same digits without the 0x prefix', () => {
		expect(formatWordDigits(0x0040000c)).toBe('0040000C')
	})
})

describe('formatHex', () => {
	it('pads to the requested width', () => {
		expect(formatHex(0xff, 2)).toBe('FF')
		expect(formatHex(0x0f, 2)).toBe('0F')
	})
})

describe('formatRegister', () => {
	it('pads a narrow register to its own width', () => {
		expect(formatRegister(0x5, 8)).toBe('0x05')
		expect(formatRegister(0x1234, 16)).toBe('0x1234')
		expect(formatRegister(1, 1)).toBe('0x1')
		expect(formatRegister(-1, 16)).toBe('0xFFFF')
	})

	it('writes 32-bit registers as a word', () => {
		expect(formatRegister(0x5, 32)).toBe('0x00000005')
	})
})

describe('parseWord', () => {
	it.each([
		['0x10010000', 0x10010000],
		['255', 255],
		['-5', -5],
		[' 12 ', 12],
		['0X7FFF', 0x7fff],
	])('parses %s as %d', (text, value) => {
		expect(parseWord(text)).toBe(value)
	})

	it.each([
		['', 'empty string'],
		['0x', 'hex prefix with no digits'],
		['1e3', 'exponent notation'],
		['ff', 'bare hex digits without a prefix'],
		['12.5', 'a float'],
	])('rejects %s (%s)', (text) => {
		expect(parseWord(text)).toBeNull()
	})

	it.each([0, 1, 0x0040000c, 0x7fffffff, -1, -0x80000000])('round-trips through formatWord for %d', (value) => {
		expect(parseWord(formatWord(value))).toBe(value >>> 0)
	})
})
