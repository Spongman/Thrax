import { EMPTY_SOURCE_INDEX, SourceIndex, type SourceEntry } from '../../core/sourceIndex'
import type { AssembledProgram, Diagnostic, Disassembly, ProgramImage } from '../contracts'
import { decode, format } from './isa'

export class AvrProgram implements AssembledProgram {
	readonly sourceIndex: SourceIndex
	readonly symbols
	readonly labels
	readonly symbolSites = new Map()
	readonly data
	constructor(
		readonly assembled: ProgramImage | null,
		readonly diagnostics: Diagnostic[],
		file: string
	) {
		this.labels = new Map(assembled?.symbols.map((symbol) => [symbol.name, symbol.address]))
		this.symbols = { locals: new Map(), globals: this.labels }
		const entries: SourceEntry[] = []
		for (const [index, mapping] of (assembled?.sourceMappings ?? []).entries()) {
			if (mapping.kind === 'instruction')
				entries.push({
					...mapping.source,
					address: mapping.address,
					length: mapping.byteLength,
					instruction: index
				})
			else
				for (let row = 0; row < Math.min(4, Math.ceil(mapping.byteLength / 4)); row++)
					entries.push({
						...mapping.source,
						address: mapping.address + row * 4,
						length: Math.min(4, mapping.byteLength - row * 4),
						offset: row * 4,
						truncated: row === 3 && mapping.byteLength > 16,
						instruction: null
					})
		}
		this.sourceIndex = assembled ? new SourceIndex(file, entries) : EMPTY_SOURCE_INDEX
		this.data = (assembled?.sourceMappings ?? [])
			.filter((mapping) => mapping.kind === 'data')
			.map((mapping) => {
				const bytes = new Uint8Array(mapping.byteLength)
				for (const section of assembled!.sections) {
					const start = Math.max(section.address, mapping.address),
						end = Math.min(
							section.address + section.bytes.length,
							mapping.address + mapping.byteLength
						)
					if (start < end)
						bytes.set(
							section.bytes.subarray(start - section.address, end - section.address),
							start - mapping.address
						)
				}
				return { address: mapping.address, bytes }
			})
	}
	image(): ProgramImage {
		if (!this.assembled) throw new Error('The AVR program did not assemble')
		const first =
			this.assembled.sourceMappings.find((mapping) => mapping.kind === 'instruction')?.address ?? 0
		return { ...this.assembled, entryAddress: first }
	}
}
export const disassembly: Disassembly = {
	row(row) {
		if (!row.instruction)
			return `.byte ${row.bytes.map((value) => '0x' + value.toString(16)).join(', ')}`
		try {
			return format(
				decode((row.bytes[0] << 8) | row.bytes[1], (row.bytes[2] << 8) | row.bytes[3]),
				row.address
			)
		} catch {
			return '.word 0x' + ((row.bytes[0] << 8) | row.bytes[1]).toString(16)
		}
	},
	at(memory, address) {
		if (address >= 65536 || memory.byte(address) === undefined) return null
		try {
			return format(
				decode(
					memory.byte(address)! | (memory.byte(address + 1)! << 8),
					memory.byte(address + 2)! | (memory.byte(address + 3)! << 8)
				),
				address
			)
		} catch {
			return null
		}
	}
}
