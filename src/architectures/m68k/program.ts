import { ImageProgram } from '../../core/imageProgram'
import type { AssemblyImage } from '../../core/assembly/emitter'
import type { Diagnostic, Disassembly } from '../contracts'
import { decodeInstruction, disassemble } from './decode'
import type { CpuModel } from './settings'
import type { Coprocessor } from './fpuIsa'

export class M68kAssembly extends ImageProgram<AssemblyImage> {
	constructor(
		entry: string,
		assembled: AssemblyImage | null,
		diagnostics: Diagnostic[],
		readonly model: CpuModel,
		readonly coprocessor: Coprocessor = 'none'
	) {
		super(entry, assembled, diagnostics, { instructionBytes: 'mapping' })
	}
}
export function m68kDisassembly(model: CpuModel, fpu = false): Disassembly {
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
						model,
						fpu
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
					decodeInstruction((at) => ((memory.byte(at) ?? 0) << 8) | (memory.byte(at + 1) ?? 0), address, model, fpu)
				)
			} catch {
				return null
			}
		}
	}
}
