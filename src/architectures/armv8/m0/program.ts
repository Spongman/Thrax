import type { AssemblyImage } from '../../../core/assembly/emitter'
import { SourceIndex, type SourceEntry } from '../../../core/sourceIndex'
import type { AssembledProgram, Diagnostic, Disassembly, ProgramImage } from '../../contracts'
import { decode, disassemble } from './isa'

export class M0Program implements AssembledProgram {
	readonly sourceIndex: SourceIndex
	readonly labels
	readonly symbols
	readonly symbolSites = new Map()
	readonly data
	constructor(
		file: string,
		readonly assembled: AssemblyImage | null,
		readonly diagnostics: Diagnostic[],
	) {
		this.labels = new Map(assembled?.symbols.map((s) => [s.name, s.address]))
		this.symbols = { locals: new Map(), globals: this.labels }
		const entries: SourceEntry[] = []
		for (const [index, m] of (assembled?.sourceMappings ?? []).entries()) {
			if (m.kind === 'instruction')
				entries.push({ ...m.source, address: m.address, length: m.byteLength, instruction: index })
			else
				for (let n = 0; n < Math.min(4, Math.ceil(m.byteLength / 4)); n++)
					entries.push({
						...m.source,
						address: m.address + n * 4,
						length: Math.min(4, m.byteLength - n * 4),
						instruction: null,
						offset: n * 4,
						truncated: n === 3 && m.byteLength > 16,
					})
		}
		this.sourceIndex = new SourceIndex(file, entries)
		this.data = (assembled?.sourceMappings ?? [])
			.filter((m) => m.kind === 'data')
			.map((m) => ({ address: m.address, bytes: readBytes(assembled!, m.address, m.byteLength) }))
	}
	image(): ProgramImage {
		if (!this.assembled) throw new Error('The Thumb program did not assemble')
		return this.assembled
	}
}
function readBytes(image: ProgramImage, address: number, length: number) {
	const bytes = new Uint8Array(length)
	for (const s of image.sections) {
		const from = Math.max(address, s.address),
			to = Math.min(address + length, s.address + s.bytes.length)
		if (from < to) bytes.set(s.bytes.subarray(from - s.address, to - s.address), from - address)
	}
	return bytes
}
export const disassembly: Disassembly = {
	row(row) {
		if (!row.instruction) return `.byte ${row.bytes.join(', ')}`
		try {
			return disassemble(
				decode((row.bytes[0] << 8) | row.bytes[1], (row.bytes[2] << 8) | row.bytes[3]),
				row.address,
			)
		} catch {
			return '.hword 0x' + ((row.bytes[0] << 8) | row.bytes[1]).toString(16)
		}
	},
	at(memory, address) {
		const a = memory.byte(address),
			b = memory.byte(address + 1)
		if (a === undefined || b === undefined) return null
		try {
			return disassemble(
				decode(a | (b << 8), (memory.byte(address + 2) ?? 0) | ((memory.byte(address + 3) ?? 0) << 8)),
				address,
			)
		} catch {
			return null
		}
	},
}
