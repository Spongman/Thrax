import type { AssemblyImage } from '../../core/assembly/emitter'
import { SourceIndex, type SourceEntry } from '../../core/sourceIndex'
import type { AssembledProgram, Diagnostic, Disassembly, ProgramImage } from '../contracts'
import { disassemble } from './isa'

export class RiscvAssembly implements AssembledProgram {
	readonly sourceIndex: SourceIndex
	readonly labels: Map<string, number>
	readonly symbols
	readonly symbolSites = new Map()
	readonly data
	constructor(
		entry: string,
		readonly assembled: AssemblyImage | null,
		readonly diagnostics: Diagnostic[],
		readonly compressed = false
	) {
		let instruction = 0
		const rows: SourceEntry[] = []
		for (const mapping of assembled?.sourceMappings ?? []) {
			if (mapping.kind === 'instruction') {
				const section = assembled!.sections.find(
					(section) => mapping.address >= section.address && mapping.address < section.address + section.bytes.length
				)
				for (let offset = 0; offset < mapping.byteLength;) {
					const byte = section?.bytes[mapping.address + offset - section.address] ?? 3
					const length = compressed && (byte & 3) !== 3 ? 2 : 4
					rows.push({ ...mapping.source, address: mapping.address + offset, instruction: instruction++, length })
					offset += length
				}
			} else {
				const count = Math.min(4, Math.ceil(mapping.byteLength / 4))
				for (let index = 0; index < count; index++)
					rows.push({
						...mapping.source,
						address: mapping.address + index * 4,
						instruction: null,
						length: Math.min(4, mapping.byteLength - index * 4),
						offset: index * 4,
						truncated: index === count - 1 && mapping.byteLength > count * 4
					})
			}
		}
		this.sourceIndex = new SourceIndex(entry, rows)
		this.labels = new Map((assembled?.symbols ?? []).map((s) => [s.name, s.address]))
		this.symbols = { locals: new Map(), globals: this.labels }
		this.data = (assembled?.sourceMappings ?? [])
			.filter((m) => m.kind === 'data')
			.map((m) => {
				const bytes = new Uint8Array(m.byteLength)
				for (const section of assembled?.sections ?? []) {
					const from = Math.max(m.address, section.address),
						to = Math.min(m.address + m.byteLength, section.address + section.bytes.length)
					if (to > from)
						bytes.set(section.bytes.subarray(from - section.address, to - section.address), from - m.address)
				}
				return { address: m.address, bytes }
			})
	}
	image(): ProgramImage {
		if (!this.assembled) throw new Error('Program did not assemble')
		return this.assembled
	}
}
export const createRiscvDisassembly = (compressed: boolean): Disassembly => ({
	row: (row) =>
		row.instruction
			? disassemble(
					row.bytes.reduce((word, byte) => (word * 256 + byte) >>> 0, 0),
					row.address,
					compressed
				)
			: `.byte ${row.bytes.join(', ')}`,
	at: (memory, address) => {
		const first = memory.byte(address),
			second = memory.byte(address + 1)
		if (first === undefined || second === undefined || address % (compressed ? 2 : 4)) return null
		const half = first | (second << 8)
		if (compressed && (half & 3) !== 3) return disassemble(half, address, true)
		const third = memory.byte(address + 2),
			fourth = memory.byte(address + 3)
		return third === undefined || fourth === undefined
			? null
			: disassemble((half | (third << 16) | (fourth << 24)) >>> 0, address, compressed)
	}
})

export const riscvDisassembly = createRiscvDisassembly(false)
