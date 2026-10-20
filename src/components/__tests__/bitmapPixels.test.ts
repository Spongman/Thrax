import { describe, expect, it } from 'vitest'
import type { MemoryInspector } from '../../architectures/contracts'
import { BYTE_PALETTE, pixelBytes, pixelColor } from '../bitmapPixels'

const bytes = [0x11, 0x22, 0x33, 0xFF, 0x0E]

const memoryOf = (wordBytes: number): MemoryInspector => ({
	wordBytes,
	littleEndian: true,
	byte: (address) => bytes[address],
	word: (address) => address === 0 ? 0xFF332211 : undefined,
})

describe('bitmap pixels', () => {
	it('reads a word of 0x00RRGGBB per pixel where words are four bytes', () => {
		const memory = memoryOf(4)
		expect(pixelBytes(memory)).toBe(4)
		expect(pixelColor(memory, 0)).toBe(0x332211)
		expect(pixelColor(memory, 8)).toBeUndefined()
	})

	it('reads a byte per pixel on a byte machine, its low nibble picking a colour', () => {
		const memory = memoryOf(1)
		expect(pixelBytes(memory)).toBe(1)
		expect(pixelColor(memory, 4)).toBe(0x0088ff)
		expect(pixelColor(memory, 3)).toBe(BYTE_PALETTE[15])
		expect(pixelColor(memory, 9)).toBeUndefined()
	})

	it.each([true, false])('reads all four pixel bytes on a 16-bit machine (little-endian: %s)', (littleEndian) => {
		const memory: MemoryInspector = {
			...memoryOf(2),
			littleEndian,
			word: () => { throw new Error('A 16-bit word cannot hold a pixel') },
		}
		expect(pixelBytes(memory)).toBe(4)
		expect(pixelColor(memory, 0)).toBe(littleEndian ? 0x332211 : 0x2233ff)
		expect(pixelColor(memory, 3)).toBeUndefined()
	})
})
