import { SourceIndex, type SourceEntry } from '../../core/sourceIndex'
import type { DataEntry, MipsInstruction } from './core/types'

const DATA_ROW_BYTES = 4
const MAX_DATA_ROWS = 4

/**
 * Reads the finished layout: instructions carry the addresses the assembler
 * gave them, and each data directive spreads over as many gutter rows as its
 * bytes fill, up to the point where showing more stops being useful.
 */
export function buildSourceIndex(entryFile: string, instructions: MipsInstruction[], data: DataEntry[]): SourceIndex {
	const entries: SourceEntry[] = []

	instructions.forEach((instruction, index) => {
		if (instruction.address === null) return
		entries.push({
			file: instruction.sourceFile ?? '',
			line: instruction.sourceLine,
			address: instruction.address,
			instruction: index,
		})
	})

	// Data holds no instructions, so its rows stand for the bytes alone.
	for (const entry of data) {
		if (entry.sourceLine === undefined) continue
		const size = entry.bytes.reduce<number>((total, item) => total + (typeof item === 'number' ? 1 : item.width), 0)
		const wanted = Math.ceil(size / DATA_ROW_BYTES)
		const rows = Math.min(wanted, MAX_DATA_ROWS)
		for (let row = 0; row < rows; row += 1) {
			const offset = row * DATA_ROW_BYTES
			entries.push({
				file: entry.sourceFile ?? '',
				line: entry.sourceLine,
				address: entry.address + offset,
				instruction: null,
				directive: entry.directive,
				offset,
				length: Math.min(DATA_ROW_BYTES, size - offset),
				truncated: row === rows - 1 && wanted > rows,
			})
		}
	}

	return new SourceIndex(entryFile, entries)
}
