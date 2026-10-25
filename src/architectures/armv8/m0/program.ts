import { ImageProgram } from '../../../core/imageProgram'
import type { AssemblyImage } from '../../../core/assembly/emitter'
import type { Diagnostic, Disassembly } from '../../contracts'
import { decode, disassemble } from './isa'

export class M0Program extends ImageProgram<AssemblyImage> {
	constructor(
		file: string,
		assembled: AssemblyImage | null,
		diagnostics: Diagnostic[],
		readonly values: ReadonlyMap<string, number> = new Map(),
	) {
		super(file, assembled, diagnostics, { instructionBytes: 'mapping' })
	}
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
