import { describeRiscvToken, installEditor } from './editor'
import { createArchitectureServices } from '../../core/architectureServices'
import type { ArchitectureDefinition, ArchitectureServices } from '../contracts'
import { assembleRiscv } from './assembler'
import { COMPRESSED_EXAMPLES, EXAMPLES } from './examples'
import { manifest } from './manifest'
import { REGISTERS, riscvProfile } from './profile'
import { RiscvAssembly, createRiscvDisassembly, riscvDisassembly } from './program'
import { RiscvRuntime } from './runtime'
import { RISCV_SETTINGS, type RiscvSettings } from './settings'

const compressedVariant = {
	language: 'thrax-riscv',
	registers: REGISTERS,
	registerBanks: [{ id: 'cpu', label: 'Integer' }],
	examples: COMPRESSED_EXAMPLES
}
const compressedDisassembly = createRiscvDisassembly(true)

const definition: ArchitectureDefinition<ArchitectureServices<RiscvSettings>> = {
	...manifest,
	language: 'thrax-riscv',
	registers: REGISTERS,
	registerBanks: [{ id: 'cpu', label: 'Integer' }],
	examples: EXAMPLES,
	settings: RISCV_SETTINGS,
	variant: (settings) => (settings.isa === 'rv32imc' ? compressedVariant : definition),
	createServices() {
		return createArchitectureServices<RiscvSettings>(() => {
			let compressed = false
			return {
				assemble(sources, settings) {
					compressed = settings.isa === 'rv32imc'
					return assembleRiscv(sources, compressed)
				},
				createMachine(program, _settings, options) {
					if (!(program instanceof RiscvAssembly)) throw new Error('Not a RISC-V program')
					const next = new RiscvRuntime(program, options)
					return next
				},
				profile: () => riscvProfile,
				get disassembly() {
					return compressed ? compressedDisassembly : riscvDisassembly
				},
				describeToken: describeRiscvToken,
				installEditor,
			}
		})
	}
}
export default definition
