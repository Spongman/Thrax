/** ARM assembly results behind the neutral program contract, and A32 disassembly. */

import type { AssemblyImage } from '../../core/assembly/emitter'
import { EMPTY_SOURCE_INDEX, SourceIndex, type SourceEntry } from '../../core/sourceIndex'
import type { AssembledProgram, CodeRow, DataDeclaration, Diagnostic, Disassembly, ProgramImage, SourceLocation, SymbolTables } from '../contracts'
import { disassembleA32 } from './a32/disassemble'
import { ARCH_V2A } from './a32/isa'

/** Data rows are a word wide, like the instructions beside them. */
const DATA_ROW_BYTES = 4
/** Long data, such as a string or a table, stops after this many rows. */
const MAX_DATA_ROWS = 4

/** The gutter's view of an image: a row per instruction, a few per run of data. */
export function armSourceIndex(entryFile: string, image: AssemblyImage): SourceIndex {
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

/** An assembled ARM program; `image` is what a machine loads. */
export class ArmAssembly implements AssembledProgram {
	readonly sourceIndex: SourceIndex
	readonly symbols: SymbolTables
	readonly labels: ReadonlyMap<string, number>
	readonly data: readonly DataDeclaration[]
	readonly symbolSites = NO_SITES
	/** Labels by address, the first defined where several share one. */
	private readonly byAddress = new Map<number, string>()
	private readonly sorted: readonly { name: string, address: number }[]

	constructor(
		entryFile: string,
		readonly assembled: AssemblyImage | null,
		readonly diagnostics: Diagnostic[],
		/** Every symbol's value, assignments included, for data tips. */
		readonly values: ReadonlyMap<string, number> = new Map(),
		/** The dialect it was read in. */
		readonly dialect = 0,
		/** The ARCH_* profile it was assembled for. */
		readonly arch = ARCH_V2A,
	) {
		this.sourceIndex = assembled ? armSourceIndex(entryFile, assembled) : EMPTY_SOURCE_INDEX
		const symbols = (assembled?.symbols ?? []).filter((symbol) => !symbol.name.startsWith('.L'))
		const labels = new Map(symbols.map(({ name, address }) => [name, address]))
		this.labels = labels
		this.symbols = { locals: new Map(), globals: labels }
		for (const { name, address } of symbols) if (!this.byAddress.has(address)) this.byAddress.set(address, name)
		this.sorted = [...symbols].sort((left, right) => left.address - right.address)
		this.data = (assembled?.sourceMappings ?? [])
			.filter((mapping) => mapping.kind === 'data')
			.map((mapping) => ({ address: mapping.address, bytes: bytesAt(assembled!, mapping.address, mapping.byteLength) }))
	}

	image(): ProgramImage {
		if (!this.assembled) throw new Error('The program did not assemble')
		return this.assembled
	}

	/** The label at `address`, if any. */
	symbolAt(address: number): string | undefined {
		return this.byAddress.get(address)
	}

	/** Nearest label at or below `address`, with the offset past it. */
	symbolFor(address: number): { name: string; offset: number } | null {
		const symbols = this.sorted
		let low = 0
		let high = symbols.length - 1
		while (low <= high) {
			const middle = (low + high) >> 1
			if (symbols[middle].address <= address) low = middle + 1
			else high = middle - 1
		}
		return high < 0 ? null : { name: symbols[high].name, offset: address - symbols[high].address }
	}
}

/** `length` bytes of the image from `address`, zero where nothing was emitted. */
export function bytesAt(image: ProgramImage, address: number, length: number): Uint8Array {
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

/** A32 disassembly in the syntax of the ARCH_* profile `arch`. */
export const a32Disassembly = (arch: number): Disassembly => ({
	row: (row: CodeRow) => row.instruction
		? disassembleA32(wordOf(row.bytes), row.address, arch)
		: `${row.bytes.map(hexByte).join(', ')}${row.truncated ? ', …' : ''}`,
	at: (memory, address) => {
		const word = memory.word(address)
		return word === undefined ? null : disassembleA32(word, address, arch)
	},
})

export const armDisassembly: Disassembly = a32Disassembly(ARCH_V2A)
