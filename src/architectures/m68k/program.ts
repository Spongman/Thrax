import type { AssemblyImage } from '../../core/assembly/emitter'
import { SourceIndex, type SourceEntry } from '../../core/sourceIndex'
import type { AssembledProgram, Diagnostic, Disassembly, ProgramImage } from '../contracts'
import { decodeInstruction, disassemble } from './decode'
import type { CpuModel } from './settings'

export class M68kAssembly implements AssembledProgram {
	readonly sourceIndex: SourceIndex
	readonly labels: Map<string, number>
	readonly symbols
	readonly symbolSites = new Map()
	readonly data
	constructor(
		entry: string,
		readonly assembled: AssemblyImage | null,
		readonly diagnostics: Diagnostic[],
		readonly model: CpuModel
	) {
		let instruction = 0
		const entries: SourceEntry[] = []
		for (const mapping of assembled?.sourceMappings ?? []) {
			if (mapping.kind === 'instruction') {
				entries.push({
					...mapping.source,
					address: mapping.address,
					length: mapping.byteLength,
					instruction: instruction++
				})
				continue
			}
			const wanted = Math.ceil(mapping.byteLength / 4),
				rows = Math.min(4, wanted)
			for (let i = 0; i < rows; i++)
				entries.push({
					...mapping.source,
					address: mapping.address + i * 4,
					offset: i * 4,
					length: Math.min(4, mapping.byteLength - i * 4),
					instruction: null,
					truncated: i === rows - 1 && wanted > rows
				})
		}
		this.sourceIndex = new SourceIndex(entry, entries)
		this.labels = new Map((assembled?.symbols ?? []).map((symbol) => [symbol.name, symbol.address]))
		this.symbols = { locals: new Map(), globals: this.labels }
		this.data = (assembled?.sourceMappings ?? [])
			.filter((mapping) => mapping.kind === 'data')
			.map((mapping) => {
				const bytes = new Uint8Array(mapping.byteLength)
				for (const section of assembled?.sections ?? []) {
					const from = Math.max(mapping.address, section.address),
						to = Math.min(mapping.address + mapping.byteLength, section.address + section.bytes.length)
					if (from < to)
						bytes.set(section.bytes.subarray(from - section.address, to - section.address), from - mapping.address)
				}
				return { address: mapping.address, bytes }
			})
	}
	image(): ProgramImage {
		if (!this.assembled) throw new Error('The program did not assemble')
		return this.assembled
	}
}
export function m68kDisassembly(model: CpuModel): Disassembly {
	return {
		row: (row) => {
			if (!row.instruction)
				return `dc.b ${row.bytes.map((byte) => `$${byte.toString(16).padStart(2, '0')}`).join(',')}${row.truncated ? ',…' : ''}`
			try {
				return disassemble(
					decodeInstruction(
						(address) => {
							const i = address - row.address
							return ((row.bytes[i] ?? 0) << 8) | (row.bytes[i + 1] ?? 0)
						},
						row.address,
						model
					)
				)
			} catch {
				return `dc.w $${((row.bytes[0] << 8) | row.bytes[1]).toString(16)}`
			}
		},
		at: (memory, address) => {
			if (memory.byte(address) === undefined) return null
			try {
				return disassemble(
					decodeInstruction((at) => ((memory.byte(at) ?? 0) << 8) | (memory.byte(at + 1) ?? 0), address, model)
				)
			} catch {
				return null
			}
		}
	}
}
