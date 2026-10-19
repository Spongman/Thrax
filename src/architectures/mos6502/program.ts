/** 6502 assembly results behind the neutral program contract. */

import type { AssemblyImage } from '../../core/assembly/emitter'
import { EMPTY_SOURCE_INDEX, SourceIndex, type SourceEntry } from '../../core/sourceIndex'
import type { AssembledProgram, CodeRow, DataDeclaration, Diagnostic, Disassembly, ProgramImage, SourceLocation, SymbolTables } from '../contracts'
import { disassemble, hex2, instructionLength } from './disassemble'

/** Data rows are four bytes wide. */
const DATA_ROW_BYTES = 4
/** Long data, such as a string or `.res`, stops after this many rows. */
const MAX_DATA_ROWS = 4

/** The gutter's view of an image: a row per instruction, its own length long, and a few per run of data. */
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

/** An assembled 6502 program; `image` is what a machine loads. */
export class Mos6502Assembly implements AssembledProgram {
	readonly sourceIndex: SourceIndex
	readonly symbols: SymbolTables
	readonly labels: ReadonlyMap<string, number>
	readonly data: readonly DataDeclaration[]
	readonly symbolSites = NO_SITES

	constructor(
		entryFile: string,
		readonly assembled: AssemblyImage | null,
		readonly diagnostics: Diagnostic[],
		/** `.breakpoint` addresses. */
		readonly breakpoints: readonly number[] = [],
		/** Every symbol's value, assignments included, for data tips. */
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

export const mos6502Disassembly: Disassembly = {
	row: (row: CodeRow) => row.instruction
		? disassemble(row.bytes, row.address)
		: `.byte ${row.bytes.map(hex2).join(', ')}${row.truncated ? ', …' : ''}`,
	at: (memory, address) => {
		const opcode = memory.byte(address)
		if (opcode === undefined) return null
		const bytes = Array.from({ length: instructionLength(opcode) }, (_, offset) => memory.byte((address + offset) & 0xFFFF) ?? 0)
		return disassemble(bytes, address)
	},
}
