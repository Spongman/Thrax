import { FPU_VIEWS, M68K_VARIANTS } from './variants'
import { describeToken, installEditor } from './editor'
import { createArchitectureServices } from '../../core/architectureServices'
import type {
	ArchitectureDefinition,
	ArchitectureServices,
} from '../contracts'
import { assembleM68k } from './assembler'
import { manifest } from './manifest'
import { m68kFpuProfile, m68kProfile } from './profile'
import { M68kAssembly, m68kDisassembly } from './program'
import { M68kRuntime } from './runtime'
import { effectiveCoprocessor, M68K_SETTINGS, type M68kSettings } from './settings'

const view = (settings: Partial<M68kSettings>) => {
	const coprocessor = effectiveCoprocessor(settings)
	return coprocessor === 'none' ? M68K_VARIANTS.select(settings.cpuModel).view : FPU_VIEWS[coprocessor]
}
const variantKey = (model: string, coprocessor: string) => (coprocessor === 'none' ? model : `${model}+${coprocessor}`)

const definition: ArchitectureDefinition<ArchitectureServices<M68kSettings>> = {
	...manifest,
	...M68K_VARIANTS.select('68000').view,
	settings: M68K_SETTINGS,
	variant: settings => view(settings as Partial<M68kSettings>),
	createServices() {
		return createArchitectureServices<M68kSettings>(({ program: inspectionProgram }) => {
			const current = () => inspectionProgram() as M68kAssembly | null
			const disassembly = () => m68kDisassembly(current()?.model ?? '68000', (current()?.coprocessor ?? 'none') !== 'none')
			return {
				assemble(sources, settings) {
					return assembleM68k(sources, settings.cpuModel, effectiveCoprocessor(settings))
				},
				createMachine(program, _settings, options) {
					if (!(program instanceof M68kAssembly)) throw new Error('Not a 68000 program')
					const next = new M68kRuntime(program, options)
					return next
				},
				profile: settings => (effectiveCoprocessor(settings) === 'none' ? m68kProfile : m68kFpuProfile),
				disassembly: {
					row: (row, next) => disassembly().row(row, next),
					at: (memory, address) => disassembly().at(memory, address)
				},
				describeToken,
				installEditor,
			}
		}, {
			variant: settings => variantKey(settings.cpuModel, effectiveCoprocessor(settings)),
			programVariant: program => variantKey((program as M68kAssembly).model, (program as M68kAssembly).coprocessor),
		})
	}
}
export default definition
