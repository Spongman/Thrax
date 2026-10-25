/**
 * The NMOS 6502 and W65C02S: ca65-style assembly through the shared engine, run on a
 * bare CPU with 64 KiB of RAM and a console, keyboard and timer in the I/O
 * page at $F000.
 */

import { BASE6502_VARIANTS as MOS6502_VARIANTS } from './variants'
import { lazyLanguageProviders } from '../../services/assemblyLanguage'
import { createArchitectureServices } from '../../core/architectureServices'

import type { ArchitectureDefinition, ArchitectureServices, AssembledProgram, RegisterBank } from '../contracts'
import { assembleMos6502 } from './assembler'
import { describeMos6502Token } from './editor/dataTips'
import { modelFor, W65C02_MODEL } from './isa'
import { manifest } from './manifest'
import { mos6502Profile } from './profile'
import { Mos6502Assembly, disassemblyFor } from './program'
import { Mos6502Runtime } from './runtime'
import { MOS6502_SETTINGS, type Mos6502Settings } from './settings'

/** Only this module's own assemblies can be loaded into its machines. */
function mos6502Assembly(program: AssembledProgram): Mos6502Assembly {
	if (!(program instanceof Mos6502Assembly)) throw new Error('Not a 6502 program')
	return program
}

const definition: ArchitectureDefinition<ArchitectureServices<Mos6502Settings>> = {
	id: manifest.id,
	name: manifest.name,
	fileExtensions: manifest.fileExtensions,
	...MOS6502_VARIANTS.select('nmos6502').view,
	settings: MOS6502_SETTINGS,
	variant: settings => MOS6502_VARIANTS.select(settings.cpuModel).view,
	createServices(): ArchitectureServices<Mos6502Settings> {
		return createArchitectureServices<Mos6502Settings>(({ check, program: inspectionProgram }) => {
			/** The loaded program, or a successful preview before the first load. */
			const current = () => inspectionProgram() as Mos6502Assembly | null
			return {
				disassembly: {
					row: (row, next) => disassemblyFor(current()?.model).row(row, next),
					at: (memory, address) => disassemblyFor(current()?.model).at(memory, address),
				},
				// One translation unit: the entry file, with the rest reached by `.include`.
				assemble({ files, entries }, settings) {
					const main = files.find((file) => file.name === entries[0]) ?? files[0]
					const model = modelFor(settings.cpuModel)
					const result = assembleMos6502(main, { files, model })
					const program = new Mos6502Assembly(main.name, result.image, result.diagnostics, result.breakpoints, result.values, model)
					return program
				},
				createMachine(program, settings, options) {
					const next = new Mos6502Runtime(mos6502Assembly(program), {
						model: modelFor(settings.cpuModel),
						decimal: settings.decimalMode,
						historyLimit: options.historyLimit,
						speed: options.speed,
					})
					return next
				},
				profile: () => mos6502Profile,
				describeToken: (text, column, state) => describeMos6502Token(text, column, state, { model: current()?.model, value: (name) => current()?.values.get(name) }),
				async installEditor(monaco, host) {
					check()
					const sources = {
						files: () => host.files(),
						active: () => host.active(),
						open: (file: string, line: number) => host.open(file, line),
						inspection: () => host.inspection(),
						values: () => current()?.values ?? null,
					}
					return lazyLanguageProviders(monaco, MOS6502_VARIANTS.options.map(({ value }) => {
						const variant = MOS6502_VARIANTS.select(value)
						return { id: variant.view.language, load: async () => {
							const { installEditor } = await import('./editor')
							check()
							return installEditor(monaco, sources, variant.model)
						} }
					}))
				},
			}
		}, { variant: settings => modelFor(settings.cpuModel).id, programVariant: program => mos6502Assembly(program).model.id })
	},
}

export default definition
