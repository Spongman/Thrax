import { describe, expect, it } from 'vitest'
import { RamInspector } from '../ramInspector'

describe('RAM inspection', () => {
	it('reads live subarray contents with native byte order and aligned words', () => {
		const storage = Uint8Array.of(99, 0x12, 0x34, 0x56, 0x89, 99)
		const bytes = storage.subarray(1, 5)
		const little = new RamInspector(bytes, { wordBytes: 4, littleEndian: true, base: 0x400000 })
		const big = new RamInspector(bytes, { wordBytes: 2, littleEndian: false, base: 0x400000 })
		const bigWord = new RamInspector(bytes, { wordBytes: 4, littleEndian: false })
		expect(little.word(0x400003)).toBe(0x89563412)
		expect(bigWord.word(3)).toBe(0x12345689)
		expect(big.word(0x400001)).toBe(0x1234)
		expect(big.word(0x400003)).toBe(0x5689)
		bytes[0] = 42
		expect(little.byte(0x400000)).toBe(42)
		expect(big.word(0x400000)).toBe(0x2a34)
	})

	it('rejects invalid addresses without wrapping or reading a partial last word', () => {
		const memory = new RamInspector(Uint8Array.of(1, 2, 3), { wordBytes: 2, littleEndian: true, base: 0x100000000 })
		expect(memory.word(0x100000001)).toBe(0x0201)
		expect(memory.byte(0x100000002)).toBe(3)
		expect(memory.word(0x100000002)).toBeUndefined()
		for (const address of [-1, 0, 0x100000000 - 1, 0x100000000 + 0.5, 0x100000003, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
			expect(memory.byte(address)).toBeUndefined()
			expect(memory.word(address)).toBeUndefined()
		}
	})

	it('uses byte words for byte-oriented panels', () => {
		const memory = new RamInspector(Uint8Array.of(1, 2), { wordBytes: 1, littleEndian: true })
		expect(memory.word(1)).toBe(2)
		expect(memory.word(2)).toBeUndefined()
	})
})
