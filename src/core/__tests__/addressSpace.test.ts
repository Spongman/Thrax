import { describe, expect, it } from 'vitest'
import { segmentAddress } from '../addressSpace'

describe('segmented address arithmetic', () => {
	it('preserves overlapping segment aliases and 20-bit physical wrapping', () => {
		expect(segmentAddress(0x1234, 0x5678)).toBe(0x179b8)
		expect(segmentAddress(0x1000, 0x10)).toBe(segmentAddress(0x1001, 0))
		expect(segmentAddress(0xffff, 0x10)).toBe(0)
		expect(segmentAddress(0xffff, 0xffff)).toBe(0xffef)
	})
	it('wraps native offsets before translation and can represent banked buses', () => {
		expect(segmentAddress(0x1234, 0x10002)).toBe(0x12342)
		expect(segmentAddress(0x1234, -1)).toBe(0x2233f)
		expect(segmentAddress(0xab, 0x12345, 16, 24, 16)).toBe(0xab2345)
	})
	it.each([NaN, Infinity, 1.5])('rejects invalid address components %s', value => {
		expect(() => segmentAddress(value, 0)).toThrow(RangeError)
		expect(() => segmentAddress(0, value)).toThrow(RangeError)
	})
})
