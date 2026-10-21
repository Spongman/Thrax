/** UASM assembly results behind the neutral program contract. */

import { ImageProgram, imageBytes, imageEnd } from '../../core/imageProgram'

import type { AssemblyImage } from '../../core/assembly/emitter'
import type { Diagnostic, Disassembly, CodeRow } from '../contracts'
import { disassemble } from './disassemble'
import { BetaSourceIndex, EMPTY_BETA_SOURCE_INDEX } from './sourceIndex'
import type { UasmDirectives } from './uasm'

/** An assembled UASM program; `image` is what a machine loads. */
export class BetaAssembly extends ImageProgram<AssemblyImage> {
	readonly betaIndex: BetaSourceIndex
	readonly breakpoints: readonly number[]

	constructor(
		entryFile: string,
		assembled: AssemblyImage | null,
		diagnostics: Diagnostic[],
		readonly directives: UasmDirectives,
		/** Every symbol's value, assignments included, for data tips. */
		readonly values: ReadonlyMap<string, number> = new Map(),
	) {
		super(entryFile, assembled, diagnostics, { instructionBytes: 4 })
		this.breakpoints = directives.breakpoints
		this.betaIndex = assembled ? new BetaSourceIndex(assembled) : EMPTY_BETA_SOURCE_INDEX
	}

	/** Memory from address 0 to the end of the image as little-endian words, gaps zero. */
	words(): number[] {
		const image = this.image()
		const end = imageEnd(image)
		const bytes = imageBytes(image, 0, Math.ceil(end / 4) * 4)
		const view = new DataView(bytes.buffer)
		return Array.from({ length: bytes.length / 4 }, (_, index) => view.getUint32(index * 4, true))
	}
}

const hexByte = (byte: number) => `0x${(byte & 0xFF).toString(16).toUpperCase().padStart(2, '0')}`

/** The word a code row's bytes spell, most significant first. */
const wordOf = (bytes: readonly number[]) => bytes.reduce((word, byte) => ((word << 8) | (byte & 0xff)) >>> 0, 0)

export const betaDisassembly: Disassembly = {
	row: (row: CodeRow) => row.instruction
		? disassemble(wordOf(row.bytes), row.address)
		: `${row.bytes.map(hexByte).join(', ')}${row.truncated ? ', …' : ''}`,
	at: (memory, address) => {
		const word = memory.word(address)
		return word === undefined ? null : disassemble(word, address)
	},
}
