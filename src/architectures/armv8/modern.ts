/**
 * ARM: programs in the execution state the settings choose, assembled
 * and run by that state. AArch64 runs GNU as A64 source on the shared engine;
 * AArch32 runs A32 source in GNU as or armasm syntax through the shared ARM
 * library. Those states run in user mode under Linux system calls. Cortex-M0
 * runs ARMv6-M Thumb in Thread mode with its explicit teaching console ABI.
 */

import { lazyLanguageProviders } from '../../services/assemblyLanguage'
import { createArchitectureServices } from '../../core/architectureServices'

import type { ArchitectureDefinition, ArchitectureServices, AssembledProgram } from '../contracts'
import type { ExecutionState } from './executionState'
import { manifest } from './manifest'
import { armView, MODERN_ARM_VARIANTS as ARM_VARIANTS } from './variants'
import { ARMV8_SETTINGS, type Armv8Settings } from './settings'

const definition: ArchitectureDefinition<ArchitectureServices<Armv8Settings>> = {
	id: manifest.id,
	name: manifest.name,
	...ARM_VARIANTS.select('aarch64').view,
	fileExtensions: manifest.fileExtensions,
	settings: ARMV8_SETTINGS,
	variant: settings => armView(ARM_VARIANTS, settings),
	createServices(): ArchitectureServices<Armv8Settings> {
		return createArchitectureServices<Armv8Settings>(({ check, program: inspectionProgram }) => {
			const states = new Map<string, ExecutionState>()
			const loading = new Map<string, Promise<void>>()
			const programs = new WeakMap<AssembledProgram, ExecutionState>()
			const idFor = ({ executionState }: Armv8Settings) => ARM_VARIANTS.valid(executionState) ? executionState : ARM_VARIANTS.defaultId
			const stateFor = (settings: Armv8Settings): ExecutionState => {
				const state = states.get(idFor(settings))
				if (!state) throw new Error('ARM backend is not prepared; await services.prepare(settings) first')
				return state
			}
			const current = () => {
				const program = inspectionProgram()
				return program ? programs.get(program) : states.values().next().value
			}

			return {
				isPrepared: settings => states.has(idFor(settings)),
				prepare(settings) {
					const id = idFor(settings)
					if (states.has(id)) return Promise.resolve()
					let pending = loading.get(id)
					if (!pending) {
						pending = ARM_VARIANTS.select(id).load().then(create => {
							check()
							states.set(id, create())
						}).finally(() => { loading.delete(id) })
						loading.set(id, pending)
					}
					return pending
				},
				disassembly: {
					row: (row, next) => current()?.disassembly.row(row, next) ?? '',
					at: (memory, address) => current()?.disassembly.at(memory, address) ?? null,
				},
				assemble(sources, settings) {
					const state = stateFor(settings)
					const program = state.assemble(sources, settings)
					programs.set(program, state)
					return program
				},
				createMachine(program, settings, options) {
					const state = stateFor(settings)
					const next = state.createMachine(program, settings, options)
					programs.set(program, state)
					return next
				},
				profile: (settings) => stateFor(settings).profile(settings),
				describeToken: (text, column, inspection) => current()?.describeToken(text, column, inspection, inspectionProgram()) ?? null,
				// Every state's language, so files read right whichever state is chosen.
				async installEditor(monaco, host) {
					check()
					const sources = {
						files: () => host.files(),
						active: () => host.active(),
						open: (file: string, line: number) => host.open(file, line),
						inspection: () => host.inspection(),
						values: () => current()?.values(inspectionProgram()) ?? null,
					}
					return lazyLanguageProviders(monaco, ARM_VARIANTS.options.map(({ value }) => {
						const variant = ARM_VARIANTS.select(value)
						return { id: variant.view.language!, load: async () => {
							const install = await variant.loadEditor()
							check()
							return install(monaco, sources)
						} }
					}))
				},
			}
		}, { variant: settings => ARM_VARIANTS.valid(settings.executionState) ? settings.executionState : ARM_VARIANTS.defaultId })
	},
}

export default definition
