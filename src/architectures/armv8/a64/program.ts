/** AArch64 assembly results behind the neutral program contract. */

import { ImageProgram } from '../../../core/imageProgram'

import type { AssemblyImage } from '../../../core/assembly/emitter'
import type { Diagnostic, Disassembly, CodeRow } from '../../contracts'
import { disassemble } from './disassemble'


/** An assembled AArch64 program; `image` is what a machine loads. */
export class A64Assembly extends ImageProgram<AssemblyImage> {
	constructor(
		entryFile: string,
		assembled: AssemblyImage | null,
		diagnostics: Diagnostic[],
		/** Every symbol's value, `.equ` included, for data tips. */
		readonly values: ReadonlyMap<string, number> = new Map(),
	) {
		super(entryFile, assembled, diagnostics, { instructionBytes: 4 })
	}

}

const hexByte = (byte: number) => `0x${(byte & 0xFF).toString(16).toUpperCase().padStart(2, '0')}`

/** The word a code row's bytes spell, most significant first. */
const wordOf = (bytes: readonly number[]) => bytes.reduce((word, byte) => ((word << 8) | (byte & 0xff)) >>> 0, 0)

export const a64Disassembly: Disassembly = {
	row: (row: CodeRow) => row.instruction
		? disassemble(wordOf(row.bytes), row.address)
		: `${row.bytes.map(hexByte).join(', ')}${row.truncated ? ', …' : ''}`,
	at: (memory, address) => {
		const word = memory.word(address)
		return word === undefined ? null : disassemble(word, address)
	},
}
