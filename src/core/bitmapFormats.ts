import type { BitmapFormat } from '../architectures/contracts'

export const BYTE_PALETTE: readonly number[] = Object.freeze([
	0x000000, 0xffffff, 0x880000, 0xaaffee, 0xcc44cc, 0x00cc55, 0x0000aa, 0xeeee77,
	0xdd8855, 0x664400, 0xff7777, 0x333333, 0x777777, 0xaaff66, 0x0088ff, 0xbbbbbb,
])
export const TEACHING_BITMAP: BitmapFormat = Object.freeze({ kind: 'indexed8', palette: BYTE_PALETTE, indexMask: 15 })
export const RGB32_LE: BitmapFormat = Object.freeze({ kind: 'rgb32', littleEndian: true })
export const RGB32_BE: BitmapFormat = Object.freeze({ kind: 'rgb32', littleEndian: false })
