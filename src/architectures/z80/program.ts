/** Z80 assembly results behind the neutral program contract. */

import type { AssemblyImage } from '../../core/assembly/emitter'
import { EMPTY_SOURCE_INDEX, SourceIndex, type SourceEntry } from '../../core/sourceIndex'
import type { AssembledProgram, CodeRow, DataDeclaration, Diagnostic, Disassembly, ProgramImage, SourceLocation, SymbolTables } from '../contracts'
import { decode, hex8 } from './disassemble'

/** Data rows show this many bytes, like a short instruction. */
const DATA_ROW_BYTES = 4
/** Long data, such as a string or DS, stops after this many rows. */
const MAX_DATA_ROWS = 4

/** The gutter's view of an image: a row per instruction at its own length, a few per run of data. */
function sourceIndexOf(entryFile: string, image: AssemblyImage): SourceIndex {
	const entries: SourceEntry[] = []
	let instruction = 0
	for (const { address, byteLength, kind, source } of image.sourceMappings) {
		const { file, line } = source
		if (kind === 'instruction') {
			entries.push({ file, line, address, instruction: instruction++, length: byteLength })
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

const NO_SITES: ReadonlyMap<string, ReadonlyMap<string, SourceLocation>> = new Map()

/** An assembled Z80 program; `image` is what a machine loads. */
export class Z80Assembly implements AssembledProgram {
	readonly sourceIndex: SourceIndex
	readonly symbols: SymbolTables
	readonly labels: ReadonlyMap<string, number>
	readonly data: readonly DataDeclaration[]
	readonly symbolSites = NO_SITES

	constructor(
		entryFile: string,
		readonly assembled: AssemblyImage | null,
		readonly diagnostics: Diagnostic[],
		/** Every symbol's value, equates included, for data tips. */
		readonly values: ReadonlyMap<string, number> = new Map(),
	) {
		this.sourceIndex = assembled ? sourceIndexOf(entryFile, assembled) : EMPTY_SOURCE_INDEX
		const labels = new Map((assembled?.symbols ?? []).map(({ name, address }) => [name, address]))
		this.labels = labels
		this.symbols = { locals: new Map(), globals: labels }
		this.data = (assembled?.sourceMappings ?? [])
			.filter((mapping) => mapping.kind === 'data')
			.map((mapping) => ({ address: mapping.address, bytes: bytesAt(assembled!, mapping.address, mapping.byteLength) }))
	}

	image(): ProgramImage {
		if (!this.assembled) throw new Error('The program did not assemble')
		return this.assembled
	}
}

/** `length` bytes of the image from `address`, zero where nothing was emitted. */
function bytesAt(image: ProgramImage, address: number, length: number): Uint8Array {
	const bytes = new Uint8Array(length)
	for (const section of image.sections) {
		const from = Math.max(address, section.address)
		const to = Math.min(address + length, section.address + section.bytes.length)
		if (from < to) bytes.set(section.bytes.subarray(from - section.address, to - section.address), from - address)
	}
	return bytes
}

export const z80Disassembly: Disassembly = {
	row: (row: CodeRow) => row.instruction
		? decode((offset) => row.bytes[offset] ?? 0, row.address).text
		: `DB ${row.bytes.map(hex8).join(',')}${row.truncated ? ',…' : ''}`,
	at: (memory, address) => {
		if (memory.byte(address) === undefined) return null
		return decode((offset) => memory.byte((address + offset) & 0xFFFF) ?? 0, address).text
	},
}
