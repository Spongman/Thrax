/**
 * MIT Beta under BSim: UASM assembled through the shared engine with the
 * bundled beta.uasm, run on the Beta CPU with BSim's console and halt.
 */

import { createArchitectureServices } from '../../core/architectureServices'

import type { ArchitectureDefinition, ArchitectureServices, AssembledProgram, RegisterBank } from '../contracts'
import { EXAMPLES } from './examples'
import { manifest } from './manifest'
import { BetaAssembly, betaDisassembly } from './program'
import { betaProfile } from './profile'
import { BETA_REGISTERS } from './registers'
import { BetaRuntime } from './runtime'
import { BETA_SETTINGS, type BetaSettings } from './settings'
import { assembleUasm } from './uasm'
import { describeUasmToken, libraryMacros } from './editor/dataTips'
import { UASM_LANGUAGE_ID } from './editor/grammar'

const BANKS: readonly RegisterBank[] = [
	{ id: 'integer', label: 'Registers' },
	{ id: 'control', label: 'Control' },
]

/** Only this module's own assemblies can be loaded into its machines. */
function betaAssembly(program: AssembledProgram): BetaAssembly {
	if (!(program instanceof BetaAssembly)) throw new Error('Not a Beta program')
	return program
}

const definition: ArchitectureDefinition<ArchitectureServices<BetaSettings>> = {
	id: manifest.id,
	name: manifest.name,
	language: UASM_LANGUAGE_ID,
	fileExtensions: manifest.fileExtensions,
	registers: BETA_REGISTERS,
	registerBanks: BANKS,
	examples: EXAMPLES,
	settings: BETA_SETTINGS,
	createServices(): ArchitectureServices<BetaSettings> {
		return createArchitectureServices<BetaSettings>(({ check, program: inspectionProgram }) => {
			/** The loaded program, or a successful preview before the first load. */
			const current = () => inspectionProgram() as BetaAssembly | null
			return {
				disassembly: betaDisassembly,
				// UASM has one translation unit: the entry file, with the rest reached by `.include`.
				assemble({ files, entries }, settings) {
					const main = files.find((file) => file.name === entries[0]) ?? files[0]
					const result = assembleUasm(main, { files })
					// Caught here rather than when the machine loads it, so it is marked like any other error.
					const end = Math.max(0, ...(result.image?.sections ?? []).map((section) => section.address + section.bytes.length))
					if (end > settings.memoryBytes) {
						result.diagnostics.push({ severity: 'error', file: main.name, message: `The program needs ${end} bytes of memory; the machine has ${settings.memoryBytes}` })
					}
					const program = new BetaAssembly(main.name, result.image, result.diagnostics, result.directives, result.values)
					return program
				},
				createMachine(program, settings, options) {
					const assembly = betaAssembly(program)
					const next = new BetaRuntime(assembly, {
						memoryBytes: settings.memoryBytes,
						// `.options tty` or `notty` in the source wins over the setting.
						tty: assembly.directives.options.tty ?? settings.tty,
						clock: assembly.directives.options.clock === true,
						segmentation: assembly.directives.options.segmentation === true,
						historyLimit: options.historyLimit,
						speed: options.speed,
					})
					return next
				},
				profile: (settings) => betaProfile(settings.memoryBytes),
				exportWords: (program) => betaAssembly(program).words(),
				describeToken: (text, column, state) => describeUasmToken(text, column, state, {
					value: (name) => current()?.values.get(name),
					macro: (name) => libraryMacros().get(name) ?? [],
				}),
				async installEditor(monaco, host) {
					const { installEditor } = await import('./editor')
					check()
					const contribution = installEditor(monaco, {
						files: () => host.files(),
						active: () => host.active(),
						open: (file, line) => host.open(file, line),
						sourceIndex: () => current()?.betaIndex ?? null,
						inspection: () => host.inspection(),
						values: () => current()?.values ?? null,
					})
					return contribution
				},
			}
		})
	},
}

export default definition
