/**
 * Address <-> source line relation of one assembled AArch64 program, for the
 * gutter, breakpoints and source stepping: a row per instruction word, and a
 * few per run of data. A macro-expanded instruction maps to its invocation.
 */

import type { AssemblyImage } from '../../../core/assembly/emitter'
import type { SourceIndex } from '../../../core/sourceIndex'
import { imageSourceIndex } from '../../../core/imageProgram'
import type { ProgramImage } from '../../contracts'

export const a64SourceIndex = (entryFile: string, image: AssemblyImage): SourceIndex =>
	imageSourceIndex(entryFile, image, { instructionBytes: 4 })

/** The nearest symbol at or below `address`, with the offset past it, or null. */
export function symbolFor(symbols: ProgramImage['symbols'], address: number): { name: string, offset: number } | null {
	let best: { name: string, address: number } | null = null
	for (const symbol of symbols) {
		if (symbol.address <= address && (!best || symbol.address > best.address)) best = symbol
	}
	return best && { name: best.name, offset: address - best.address }
}
