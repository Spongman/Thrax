/** ARM assembly results behind the neutral program contract, and A32 disassembly. */

import { ImageProgram, imageSourceIndex } from '../../../core/imageProgram'

import type { AssemblyImage } from '../../../core/assembly/emitter'
import type { Diagnostic, Disassembly, CodeRow } from '../../contracts'
import { disassembleA32 } from './a32/disassemble'
import { ARCH_V2A } from './a32/isa'

/** Compatibility exports for architecture clients; policy is shared. */
export { imageBytes as bytesAt } from '../../../core/imageProgram'
export const armSourceIndex = (entry: string, image: AssemblyImage) => imageSourceIndex(entry, image, { instructionBytes: 4 })

/** An assembled ARM program; `image` is what a machine loads. */
export class ArmAssembly extends ImageProgram<AssemblyImage> {
	private readonly byAddress = new Map<number, string>()
	private readonly sorted: readonly { name: string, address: number }[]

	constructor(
		entryFile: string,
		assembled: AssemblyImage | null,
		diagnostics: Diagnostic[],
		/** Every symbol's value, assignments included, for data tips. */
		readonly values: ReadonlyMap<string, number> = new Map(),
		/** The dialect it was read in. */
		readonly dialect = 0,
		/** The ARCH_* profile it was assembled for. */
		readonly arch = ARCH_V2A,
	) {
		super(entryFile, assembled, diagnostics, { instructionBytes: 4, includeSymbol: (name) => !name.startsWith('.L') })
		const symbols = (assembled?.symbols ?? []).filter((symbol) => !symbol.name.startsWith('.L'))
		for (const { name, address } of symbols) if (!this.byAddress.has(address)) this.byAddress.set(address, name)
		this.sorted = [...symbols].sort((left, right) => left.address - right.address)
	}

	/** The label at `address`, if any. */
	symbolAt(address: number): string | undefined {
		return this.byAddress.get(address)
	}

	/** Nearest label at or below `address`, with the offset past it. */
	symbolFor(address: number): { name: string; offset: number } | null {
		const symbols = this.sorted
		let low = 0
		let high = symbols.length - 1
		while (low <= high) {
			const middle = (low + high) >> 1
			if (symbols[middle].address <= address) low = middle + 1
			else high = middle - 1
		}
		return high < 0 ? null : { name: symbols[high].name, offset: address - symbols[high].address }
	}
}

const hexByte = (byte: number) => `0x${(byte & 0xFF).toString(16).toUpperCase().padStart(2, '0')}`

/** The word a code row's bytes spell, most significant first. */
const wordOf = (bytes: readonly number[]) => bytes.reduce((word, byte) => ((word << 8) | (byte & 0xff)) >>> 0, 0)

/** A32 disassembly in the syntax of the ARCH_* profile `arch`. */
export const a32Disassembly = (arch: number): Disassembly => ({
	row: (row: CodeRow) => row.instruction
		? disassembleA32(wordOf(row.bytes), row.address, arch)
		: `${row.bytes.map(hexByte).join(', ')}${row.truncated ? ', …' : ''}`,
	at: (memory, address) => {
		const word = memory.word(address)
		return word === undefined ? null : disassembleA32(word, address, arch)
	},
})

export const armDisassembly: Disassembly = a32Disassembly(ARCH_V2A)
