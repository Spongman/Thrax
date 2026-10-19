/** MIPS assembly results behind the neutral program contract. */

import type { AssemblyImage } from '../../core/assembly/emitter'
import type { AssembleResult } from './assembler'
import { disassemble, disassembleData } from './core/disassembler'
import type { MemoryConfigurationValues } from './memoryConfigurations'
import type { MipsProgram } from '../../core/types'
import type { AssembledProgram, CodeRow, Diagnostic, Disassembly, ProgramImage } from '../contracts'

/** An assembled MIPS program; the private fields are what the simulator loads. */
export class MipsAssembly implements AssembledProgram {
	readonly diagnostics: Diagnostic[]
	readonly program: MipsProgram
	readonly machineCode: number[]
	private readonly assembled: AssemblyImage | null

	constructor(result: AssembleResult, readonly layout: MemoryConfigurationValues) {
		this.diagnostics = result.diagnostics
		this.program = result.program
		this.machineCode = result.machineCode
		this.assembled = result.image
	}

	get sourceIndex() { return this.program.sourceIndex }
	get symbols() { return this.program.symbols }
	get symbolSites() { return this.program.symbolSites }
	get labels() { return this.program.labels }
	get data() { return this.program.data }

	/** The engine's addressed bytes; symbols are every label, global names winning. */
	image(): ProgramImage {
		return {
			sections: this.assembled?.sections ?? [],
			entryAddress: this.layout.textBaseAddress,
			symbols: [...this.program.labels].map(([name, address]) => ({ name, address })),
			sourceMappings: this.assembled?.sourceMappings ?? [],
		}
	}
}

/** The word a code row's bytes spell, most significant first. */
const wordOf = (bytes: readonly number[]) => bytes.reduce((word, byte) => ((word << 8) | (byte & 0xff)) >>> 0, 0)

export const mipsDisassembly: Disassembly = {
	row: (row: CodeRow, next?: CodeRow) => row.instruction
		? disassemble(wordOf(row.bytes), row.address) ?? ''
		: disassembleData(row, next),
	// Memory nothing wrote reads as zero, which is `nop`.
	at: (memory, address) => disassemble(memory.word(address) ?? 0, address),
}
