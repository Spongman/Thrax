import { ImageProgram } from '../../core/imageProgram'
import type { AssemblyImage } from '../../core/assembly/emitter'
import type { Diagnostic, Disassembly } from '../contracts'
import { disassemble } from './isa'

export class RiscvAssembly extends ImageProgram<AssemblyImage> {
	constructor(
		entry: string,
		assembled: AssemblyImage | null,
		diagnostics: Diagnostic[],
		readonly compressed = false,
		/** Float register width: 0 without F, 32 with F, 64 with D. */
		readonly flen = 0
	) {
		super(entry, assembled, diagnostics, { instructionBytes: (address, _mapping, image) => {
			const section = image.sections.find((section) => address >= section.address && address < section.address + section.bytes.length)
			const byte = section?.bytes[address - section.address] ?? 3
			return compressed && (byte & 3) !== 3 ? 2 : 4
		} })
	}
}
export const createRiscvDisassembly = (compressed: boolean, flen = 0): Disassembly => ({
	row: (row) =>
		row.instruction
			? disassemble(
					row.bytes.reduce((word, byte) => (word * 256 + byte) >>> 0, 0),
					row.address,
					compressed,
					flen
				)
			: `.byte ${row.bytes.join(', ')}`,
	at: (memory, address) => {
		const first = memory.byte(address),
			second = memory.byte(address + 1)
		if (first === undefined || second === undefined || address % (compressed ? 2 : 4)) return null
		const half = first | (second << 8)
		if (compressed && (half & 3) !== 3) return disassemble(half, address, true, flen)
		const third = memory.byte(address + 2),
			fourth = memory.byte(address + 3)
		return third === undefined || fourth === undefined
			? null
			: disassemble((half | (third << 16) | (fourth << 24)) >>> 0, address, compressed, flen)
	}
})

export const riscvDisassembly = createRiscvDisassembly(false)
