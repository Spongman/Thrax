/** Z80 assembly results behind the neutral program contract. */

import { ImageProgram } from '../../core/imageProgram'

import type { AssemblyImage } from '../../core/assembly/emitter'
import type { Diagnostic, Disassembly, CodeRow } from '../contracts'
import { decode, hex8 } from './disassemble'

/** An assembled Z80 program; `image` is what a machine loads. */
export class Z80Assembly extends ImageProgram<AssemblyImage> {
	constructor(
		entryFile: string,
		assembled: AssemblyImage | null,
		diagnostics: Diagnostic[],
		/** Every symbol's value, equates included, for data tips. */
		readonly values: ReadonlyMap<string, number> = new Map(),
	) {
		super(entryFile, assembled, diagnostics, { instructionBytes: 'mapping' })
	}

}

export const z80Disassembly: Disassembly = {
	row: (row: CodeRow) => row.instruction
		? decode((offset) => row.bytes[offset] ?? 0, row.address).text
		: `DB ${row.bytes.map(hex8).join(',')}${row.truncated ? ',…' : ''}`,
	at: (memory, address) => {
		if (memory.byte(address) === undefined) return null
		return decode((offset) => memory.byte((address + offset) & 0xFFFF) ?? 0, address).text
	},
}
