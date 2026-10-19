import { describe, expect, it } from 'vitest'
import type { MemoryInspector } from '../../architectures/contracts'
import { codeRowOf } from '../sourceIndex'

const memoryOf = (bytes: number[], wordBytes: number, littleEndian = true): MemoryInspector => ({
	wordBytes,
	littleEndian,
	byte: (address) => bytes[address],
	word: () => undefined,
})

describe('gutter rows', () => {
	it('writes a word-sized instruction most significant byte first', () => {
		const row = codeRowOf({ address: 0, instruction: 0 }, memoryOf([0x78, 0x56, 0x34, 0x12], 4))
		expect(row).toEqual({ address: 0, instruction: true, bytes: [0x12, 0x34, 0x56, 0x78] })
		expect(codeRowOf({ address: 0, instruction: 0 }, memoryOf([0x12, 0x34, 0x56, 0x78], 4, false)).bytes).toEqual([0x12, 0x34, 0x56, 0x78])
	})

	it('reads as many bytes as a variable-length instruction holds, in address order on a byte machine', () => {
		const memory = memoryOf([0xEA, 0xAD, 0x34, 0x12, 0xA9], 1)
		expect(codeRowOf({ address: 1, instruction: 1, length: 3 }, memory).bytes).toEqual([0xAD, 0x34, 0x12])
		expect(codeRowOf({ address: 0, instruction: 0, length: 1 }, memory).bytes).toEqual([0xEA])
	})

	it('reads data rows in address order', () => {
		const row = codeRowOf({ address: 1, instruction: null, length: 2, directive: '.byte', offset: 0 }, memoryOf([0, 7, 8, 9], 4))
		expect(row).toEqual({ address: 1, instruction: false, bytes: [7, 8], directive: '.byte', offset: 0, truncated: undefined })
	})
})
