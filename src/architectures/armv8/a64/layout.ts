/**
 * Where an AArch64 program lives: one bounded region of memory from TEXT_BASE,
 * code first, data at DATA_BASE, the program break after the data, and the
 * stack growing down from the top.
 */

export const TEXT_BASE = 0x0040_0000
export const DATA_BASE = 0x0042_0000

/** Memory-mapped keyboard and display, after MARS's layout. */
export const MMIO_BASE = 0xFFFF_0000
export const MMIO_RECEIVER_CONTROL = MMIO_BASE
export const MMIO_RECEIVER_DATA = MMIO_BASE + 4
export const MMIO_TRANSMITTER_CONTROL = MMIO_BASE + 8
export const MMIO_TRANSMITTER_DATA = MMIO_BASE + 12

const MB = 1 << 20

export const DEFAULT_MEMORY_BYTES = 4 * MB

export const MEMORY_SIZES: readonly { value: number, label: string }[] = [
	{ value: 1 * MB, label: '1 MB' },
	{ value: 4 * MB, label: '4 MB' },
	{ value: 16 * MB, label: '16 MB' },
]

/** One past the highest address, and where SP starts. */
export const memoryTop = (memoryBytes: number) => TEXT_BASE + memoryBytes
