import type { MemoryInspector } from '../architectures/contracts'

/** What a byte-wide pixel's low four bits pick, as easy6502 and the C64 colour them. */
export const BYTE_PALETTE: readonly number[] = Object.freeze([
	0x000000, 0xffffff, 0x880000, 0xaaffee, 0xcc44cc, 0x00cc55, 0x0000aa, 0xeeee77,
	0xdd8855, 0x664400, 0xff7777, 0x333333, 0x777777, 0xaaff66, 0x0088ff, 0xbbbbbb,
])

/** Bytes per pixel: a word of 0x00RRGGBB, or one byte where the target's word is one. */
export const pixelBytes = (memory: MemoryInspector) => memory.wordBytes === 1 ? 1 : 4

/** The 24-bit colour of the pixel at `address`, or undefined where nothing was written. */
export function pixelColor(memory: MemoryInspector, address: number): number | undefined {
	if (pixelBytes(memory) === 1) {
		const byte = memory.byte(address)
		return byte === undefined ? undefined : BYTE_PALETTE[byte & 0x0f]
	}
	if (memory.wordBytes === 2) {
		let color = 0
		for (let offset = 0; offset < 4; offset++) {
			const byte = memory.byte(address + offset)
			if (byte === undefined) return undefined
			color |= byte << ((memory.littleEndian ? offset : 3 - offset) * 8)
		}
		return color & 0x00ffffff
	}
	const word = memory.word(address)
	return word === undefined ? undefined : word & 0x00ffffff
}
