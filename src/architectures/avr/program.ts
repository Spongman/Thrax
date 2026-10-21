import { ImageProgram } from '../../core/imageProgram'
import type { Diagnostic, Disassembly, ProgramImage } from '../contracts'
import { decode, format } from './isa'

export class AvrProgram extends ImageProgram<ProgramImage> {
	constructor(
		assembled: ProgramImage | null,
		diagnostics: Diagnostic[],
		file: string
	) {
		super(file, assembled, diagnostics, { instructionBytes: 'mapping' })
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
