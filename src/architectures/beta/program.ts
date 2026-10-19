/** UASM assembly results behind the neutral program contract. */

import type { AssemblyImage } from '../../core/assembly/emitter'
import { SourceIndex, EMPTY_SOURCE_INDEX, type SourceEntry } from '../../core/sourceIndex'
import type { AssembledProgram, CodeRow, DataDeclaration, Diagnostic, Disassembly, ProgramImage, SourceLocation, SymbolTables } from '../contracts'
import { disassemble } from './disassemble'
import { BetaSourceIndex, EMPTY_BETA_SOURCE_INDEX } from './sourceIndex'
import type { UasmDirectives } from './uasm'

/** Data rows are a word wide, like the instructions beside them. */
const DATA_ROW_BYTES = 4
/** Long data, such as a string or STORAGE, stops after this many rows. */
const MAX_DATA_ROWS = 4

/** The gutter's view of an image: a row per instruction word, a few per run of data. */
function sourceIndexOf(entryFile: string, image: AssemblyImage): SourceIndex {
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

const NO_SITES: ReadonlyMap<string, ReadonlyMap<string, SourceLocation>> = new Map()

/** An assembled UASM program; `image` is what a machine loads. */
export class BetaAssembly implements AssembledProgram {
	readonly sourceIndex: SourceIndex
	/** Address-to-line lookups the editor integration and the call stack use. */
	readonly betaIndex: BetaSourceIndex
	readonly symbols: SymbolTables
	readonly labels: ReadonlyMap<string, number>
	readonly data: readonly DataDeclaration[]
	readonly symbolSites = NO_SITES
	/** `.breakpoint` addresses. */
	readonly breakpoints: readonly number[]

	constructor(
		entryFile: string,
		readonly assembled: AssemblyImage | null,
		readonly diagnostics: Diagnostic[],
		readonly directives: UasmDirectives,
		/** Every symbol's value, assignments included, for data tips. */
		readonly values: ReadonlyMap<string, number> = new Map(),
	) {
		this.breakpoints = directives.breakpoints
		this.sourceIndex = assembled ? sourceIndexOf(entryFile, assembled) : EMPTY_SOURCE_INDEX
		this.betaIndex = assembled ? new BetaSourceIndex(assembled) : EMPTY_BETA_SOURCE_INDEX
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

	/** Memory from address 0 to the end of the image as little-endian words, gaps zero. */
	words(): number[] {
		const image = this.image()
		const end = Math.max(0, ...image.sections.map((section) => section.address + section.bytes.length))
		const bytes = bytesAt(image, 0, Math.ceil(end / 4) * 4)
		const view = new DataView(bytes.buffer)
		return Array.from({ length: bytes.length / 4 }, (_, index) => view.getUint32(index * 4, true))
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

const hexByte = (byte: number) => `0x${(byte & 0xFF).toString(16).toUpperCase().padStart(2, '0')}`

/** The word a code row's bytes spell, most significant first. */
const wordOf = (bytes: readonly number[]) => bytes.reduce((word, byte) => ((word << 8) | (byte & 0xff)) >>> 0, 0)

export const betaDisassembly: Disassembly = {
	row: (row: CodeRow) => row.instruction
		? disassemble(wordOf(row.bytes), row.address)
		: `${row.bytes.map(hexByte).join(', ')}${row.truncated ? ', …' : ''}`,
	at: (memory, address) => {
		const word = memory.word(address)
		return word === undefined ? null : disassemble(word, address)
	},
}
