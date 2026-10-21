/** 6502 assembly results behind the neutral program contract. */

import { ImageProgram } from '../../core/imageProgram'

import type { AssemblyImage } from '../../core/assembly/emitter'
import type { Diagnostic, Disassembly, CodeRow } from '../contracts'
import { disassemble, hex2, instructionLength } from './disassemble'
import { NMOS_MODEL, type CpuModel } from './isa'

/** An assembled 6502 program; `image` is what a machine loads. */
export class Mos6502Assembly extends ImageProgram<AssemblyImage> {
	constructor(
		entryFile: string,
		assembled: AssemblyImage | null,
		diagnostics: Diagnostic[],
		/** `.breakpoint` addresses. */
		readonly breakpoints: readonly number[] = [],
		/** Every symbol's value, assignments included, for data tips. */
		readonly values: ReadonlyMap<string, number> = new Map(),
		readonly model: CpuModel = NMOS_MODEL,
	) {
		super(entryFile, assembled, diagnostics, { instructionBytes: 'mapping' })
	}

}

export const disassemblyFor = (model: CpuModel = NMOS_MODEL): Disassembly => ({
	row: (row: CodeRow) => row.instruction
		? disassemble(row.bytes, row.address, undefined, model)
		: `.byte ${row.bytes.map(hex2).join(', ')}${row.truncated ? ', …' : ''}`,
	at: (memory, address) => {
		const opcode = memory.byte(address)
		if (opcode === undefined) return null
		const bytes = Array.from({ length: instructionLength(opcode, model) }, (_, offset) => memory.byte((address + offset) & 0xFFFF) ?? 0)
		return disassemble(bytes, address, undefined, model)
	},
})
export const mos6502Disassembly = disassemblyFor()
