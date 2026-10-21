/** Common workbench metadata for addressed assembler output. */
import type { AssembledProgram, DataDeclaration, Diagnostic, ProgramImage, SourceLocation, SymbolTables } from '../architectures/contracts'
import { EMPTY_SOURCE_INDEX, SourceIndex, type SourceEntry } from './sourceIndex'

type Mapping = ProgramImage['sourceMappings'][number]
export interface ImageProgramLayout {
	/** One mapping can hold several real instructions (for example a pseudo-op). */
	instructionBytes: number | 'mapping' | ((address: number, mapping: Mapping, image: ProgramImage) => number)
	dataRowBytes?: number
	maxDataRows?: number
	includeSymbol?: (name: string) => boolean
}

/** Read image bytes without allocating or searching an architecture's simulated RAM. */
export function imageBytes(image: ProgramImage, address: number, length: number): Uint8Array {
	const bytes = new Uint8Array(length)
	for (const section of image.sections) {
		const from = Math.max(address, section.address)
		const to = Math.min(address + length, section.address + section.bytes.length)
		if (from < to) bytes.set(section.bytes.subarray(from - section.address, to - section.address), from - address)
	}
	return bytes
}

export function imageEnd(image: ProgramImage | null): number {
	let end = 0
	for (const section of image?.sections ?? []) end = Math.max(end, section.address + section.bytes.length)
	return end
}

/** The same data-row policy for every CPU; instruction boundaries come from its adapter. */
export function imageSourceIndex(entry: string, image: ProgramImage, layout: ImageProgramLayout): SourceIndex {
	const rows: SourceEntry[] = []
	const dataBytes = layout.dataRowBytes ?? 4
	const maxRows = layout.maxDataRows ?? 4
	let instruction = 0
	for (const mapping of image.sourceMappings) {
		if (mapping.kind === 'instruction') {
			for (let offset = 0; offset < mapping.byteLength;) {
				const address = mapping.address + offset
				const length = typeof layout.instructionBytes === 'function'
					? layout.instructionBytes(address, mapping, image)
					: layout.instructionBytes === 'mapping' ? mapping.byteLength : layout.instructionBytes
				if (!Number.isInteger(length) || length <= 0 || length > mapping.byteLength - offset) {
					throw new Error(`Invalid instruction span at 0x${address.toString(16)}`)
				}
				rows.push({ file: mapping.source.file, line: mapping.source.line, address, instruction: instruction++, length })
				offset += length
			}
			continue
		}
		const wanted = Math.ceil(mapping.byteLength / dataBytes)
		const count = Math.min(maxRows, wanted)
		for (let row = 0; row < count; row++) {
			const offset = row * dataBytes
			rows.push({
				file: mapping.source.file, line: mapping.source.line, address: mapping.address + offset,
				instruction: null, offset, length: Math.min(dataBytes, mapping.byteLength - offset),
				truncated: row === count - 1 && wanted > count,
			})
		}
	}
	return new SourceIndex(entry, rows)
}

/** Shared adapter; derived classes keep their own dialect/model and loading conventions. */
export class ImageProgram<Image extends ProgramImage = ProgramImage> implements AssembledProgram {
	readonly sourceIndex: SourceIndex
	readonly labels: Map<string, number>
	readonly symbols: SymbolTables
	readonly symbolSites: ReadonlyMap<string, ReadonlyMap<string, SourceLocation>> = new Map()
	readonly data: readonly DataDeclaration[]

	constructor(
		entry: string,
		readonly assembled: Image | null,
		readonly diagnostics: Diagnostic[],
		layout: ImageProgramLayout,
	) {
		this.sourceIndex = assembled ? imageSourceIndex(entry, assembled, layout) : EMPTY_SOURCE_INDEX
		this.labels = new Map((assembled?.symbols ?? [])
			.filter(({ name }) => !layout.includeSymbol || layout.includeSymbol(name))
			.map(({ name, address }) => [name, address]))
		this.symbols = { locals: new Map(), globals: this.labels }
		this.data = (assembled?.sourceMappings ?? [])
			.filter((mapping) => mapping.kind === 'data')
			.map((mapping) => ({ address: mapping.address, bytes: imageBytes(assembled!, mapping.address, mapping.byteLength) }))
	}

	image(): ProgramImage {
		if (!this.assembled) throw new Error('The program did not assemble')
		return this.assembled
	}

	end(): number { return imageEnd(this.assembled) }
}
