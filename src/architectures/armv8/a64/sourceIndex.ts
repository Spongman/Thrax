/**
 * Address <-> source line relation of one assembled AArch64 program, for the
 * gutter, breakpoints and source stepping: a row per instruction word, and a
 * few per run of data. A macro-expanded instruction maps to its invocation.
 */

import type { AssemblyImage } from '../../../core/assembly/emitter'
import { SourceIndex, type SourceEntry } from '../../../core/sourceIndex'
import type { ProgramImage } from '../../contracts'

/** Data rows are a word wide, like the instructions beside them. */
const DATA_ROW_BYTES = 4
/** Long data, such as a string or `.space`, stops after this many rows. */
const MAX_DATA_ROWS = 4

export function a64SourceIndex(entryFile: string, image: AssemblyImage): SourceIndex {
	const entries: SourceEntry[] = []
	let instruction = 0
	for (const { address, byteLength, kind, source } of image.sourceMappings) {
		const { file, line } = source
		if (kind === 'instruction') {
			for (let offset = 0; offset < byteLength; offset += 4) entries.push({ file, line, address: address + offset, instruction: instruction++ })
			continue
		}
		const wanted = Math.ceil(byteLength / DATA_ROW_BYTES)
		const rows = Math.min(wanted, MAX_DATA_ROWS)
		for (let row = 0; row < rows; row++) {
			const offset = row * DATA_ROW_BYTES
			entries.push({
				file, line, address: address + offset, instruction: null, offset,
				length: Math.min(DATA_ROW_BYTES, byteLength - offset),
				truncated: row === rows - 1 && wanted > rows,
			})
		}
	}
	return new SourceIndex(entryFile, entries)
}

/** The nearest symbol at or below `address`, with the offset past it, or null. */
export function symbolFor(symbols: ProgramImage['symbols'], address: number): { name: string, offset: number } | null {
	let best: { name: string, address: number } | null = null
	for (const symbol of symbols) {
		if (symbol.address <= address && (!best || symbol.address > best.address)) best = symbol
	}
	return best && { name: best.name, offset: address - best.address }
}
