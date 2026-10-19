/** AArch64 assembly results behind the neutral program contract. */

import type { AssemblyImage } from '../../../core/assembly/emitter'
import { EMPTY_SOURCE_INDEX, type SourceIndex } from '../../../core/sourceIndex'
import type { AssembledProgram, CodeRow, DataDeclaration, Diagnostic, Disassembly, ProgramImage, SourceLocation, SymbolTables } from '../../contracts'
import { disassemble } from './disassemble'
import { a64SourceIndex } from './sourceIndex'

const NO_SITES: ReadonlyMap<string, ReadonlyMap<string, SourceLocation>> = new Map()

/** An assembled AArch64 program; `image` is what a machine loads. */
export class A64Assembly implements AssembledProgram {
	readonly sourceIndex: SourceIndex
	readonly symbols: SymbolTables
	readonly labels: ReadonlyMap<string, number>
	readonly data: readonly DataDeclaration[]
	readonly symbolSites = NO_SITES

	constructor(
		entryFile: string,
		readonly assembled: AssemblyImage | null,
		readonly diagnostics: Diagnostic[],
		/** Every symbol's value, `.equ` included, for data tips. */
		readonly values: ReadonlyMap<string, number> = new Map(),
	) {
		this.sourceIndex = assembled ? a64SourceIndex(entryFile, assembled) : EMPTY_SOURCE_INDEX
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

	/** The highest address the image fills, plus one. */
	end(): number {
		return Math.max(0, ...(this.assembled?.sections ?? []).map((section) => section.address + section.bytes.length))
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

export const a64Disassembly: Disassembly = {
	row: (row: CodeRow) => row.instruction
		? disassemble(wordOf(row.bytes), row.address)
		: `${row.bytes.map(hexByte).join(', ')}${row.truncated ? ', …' : ''}`,
	at: (memory, address) => {
		const word = memory.word(address)
		return word === undefined ? null : disassemble(word, address)
	},
}
