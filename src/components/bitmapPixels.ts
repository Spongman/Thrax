import type { BitmapFormat, MemoryInspector } from '../architectures/contracts'
export { BYTE_PALETTE } from '../core/bitmapFormats'

export const pixelBytes = (format: BitmapFormat) => format.kind === 'indexed8' ? 1 : 4

/** Read the configured pixel layout using side-effect-free byte inspection. */
export function pixelColor(memory: MemoryInspector, address: number, format: BitmapFormat, palette?: readonly number[] | null): number | undefined {
	if (format.kind === 'indexed8') {
		const byte = memory.byte(address)
		return byte === undefined ? undefined : (palette ? palette[byte] : format.palette[byte & (format.indexMask ?? 255)])
	}
	// A matching inspector word is a fast path, never the source of the format.
	if (memory.wordBytes === 4 && memory.littleEndian === format.littleEndian && address % 4 === 0) {
		const word = memory.word(address)
		return word === undefined ? undefined : word & 0x00ffffff
	}
	let color = 0
	for (let offset = 0; offset < 4; offset++) {
		const byte = memory.byte(address + offset)
		if (byte === undefined) return undefined
		color |= byte << ((format.littleEndian ? offset : 3 - offset) * 8)
	}
	return color & 0x00ffffff
}
