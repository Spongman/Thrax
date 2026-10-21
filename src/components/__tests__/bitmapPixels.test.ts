import { RGB32_LE, TEACHING_BITMAP } from '../../core/bitmapFormats'
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
	it('lets a byte CPU display RGB words and overrides guest byte order explicitly', () => {
		const memory = memoryOf(1)
		expect(pixelColor(memory, 0, RGB32_LE)).toBe(0x332211)
		expect(pixelColor(memory, 0, { kind: 'rgb32', littleEndian: false })).toBe(0x2233ff)
	})
	it('reads a word of 0x00RRGGBB per pixel where words are four bytes', () => {
		const memory = memoryOf(4)
		expect(pixelBytes(RGB32_LE)).toBe(4)
		expect(pixelColor(memory, 0, RGB32_LE)).toBe(0x332211)
		expect(pixelColor(memory, 8, RGB32_LE)).toBeUndefined()
	})

	it('reads indexed pixels independently of the CPU word size', () => {
		const memory = memoryOf(8)
		expect(pixelBytes(TEACHING_BITMAP)).toBe(1)
		expect(pixelColor(memory, 4, TEACHING_BITMAP)).toBe(0x0088ff)
		expect(pixelColor(memory, 3, TEACHING_BITMAP)).toBe(BYTE_PALETTE[15])
		expect(pixelColor(memory, 9, TEACHING_BITMAP)).toBeUndefined()
	})

	it('uses the entire byte as a configured palette index, including the Mandelbrot interior entry', () => {
		const palette = Array.from({ length: 17 }, (_, index) => index === 16 ? 0 : 0x001000 + index)
		const memory = { ...memoryOf(1), byte: (address: number) => address }
		expect(pixelColor(memory, 15, TEACHING_BITMAP, palette)).toBe(0x00100f)
		expect(pixelColor(memory, 16, TEACHING_BITMAP, palette)).toBe(0)
		expect(pixelColor(memory, 17, TEACHING_BITMAP, palette)).toBeUndefined()
	})

	it.each([true, false])('reads all four pixel bytes on a 16-bit machine (little-endian: %s)', (littleEndian) => {
		const memory: MemoryInspector = {
			...memoryOf(2),
			littleEndian,
			word: () => { throw new Error('A 16-bit word cannot hold a pixel') },
		}
		expect(pixelBytes({ kind: 'rgb32', littleEndian })).toBe(4)
		expect(pixelColor(memory, 0, { kind: 'rgb32', littleEndian })).toBe(littleEndian ? 0x332211 : 0x2233ff)
		expect(pixelColor(memory, 3, { kind: 'rgb32', littleEndian })).toBeUndefined()
	})
})
