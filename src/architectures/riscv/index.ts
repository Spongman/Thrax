import { riscvIsa } from './variants'
import { describeRiscvToken, installEditor } from './editor'
import { createArchitectureServices } from '../../core/architectureServices'
import type { ArchitectureDefinition, ArchitectureServices } from '../contracts'
import { assembleRiscv } from './assembler'
import { manifest } from './manifest'
import { riscvProfile } from './profile'
import { RiscvAssembly, createRiscvDisassembly } from './program'
import { RiscvRuntime } from './runtime'
import { DEFAULT_RISCV_SETTINGS, RISCV_SETTINGS, type RiscvSettings } from './settings'

const disassemblies = new Map<string, ReturnType<typeof createRiscvDisassembly>>()
const disassemblyFor = (compressed: boolean, flen: number) => {
	const key = `${compressed}:${flen}`
	let disassembly = disassemblies.get(key)
	if (!disassembly) disassemblies.set(key, (disassembly = createRiscvDisassembly(compressed, flen)))
	return disassembly
}
const programIsa = (program: RiscvAssembly) =>
	`rv32im${program.flen ? 'f' : ''}${program.flen === 64 ? 'd' : ''}${program.compressed ? 'c' : ''}`

const definition: ArchitectureDefinition<ArchitectureServices<RiscvSettings>> = {
	...manifest,
	...riscvIsa(DEFAULT_RISCV_SETTINGS).view,
	settings: RISCV_SETTINGS,
	variant: (settings) => riscvIsa(settings).view,
	createServices() {
		return createArchitectureServices<RiscvSettings>(({ program: inspectionProgram }) => {
			const current = () => inspectionProgram() as RiscvAssembly | null
			return {
				assemble(sources, settings) {
					const isa = riscvIsa(settings)
					return assembleRiscv(sources, isa.compressed, isa.flen)
				},
				createMachine(program, _settings, options) {
					if (!(program instanceof RiscvAssembly)) throw new Error('Not a RISC-V program')
					const next = new RiscvRuntime(program, options)
					return next
				},
				profile: () => riscvProfile,
				get disassembly() {
					const program = current()
					return disassemblyFor(!!program?.compressed, program?.flen ?? 0)
				},
				describeToken: describeRiscvToken,
				installEditor,
			}
		}, { variant: settings => riscvIsa(settings).id, programVariant: program => programIsa(program as RiscvAssembly) })
	}
}
export default definition
