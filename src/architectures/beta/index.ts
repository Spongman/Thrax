/**
 * MIT Beta under BSim: UASM assembled through the shared engine with the
 * bundled beta.uasm, run on the Beta CPU with BSim's console and halt.
 */

import type { ArchitectureDefinition, ArchitectureServices, AssembledProgram, Disposable, RegisterBank } from '../contracts'
import { EXAMPLES } from './examples'
import { manifest } from './manifest'
import { BetaAssembly, betaDisassembly } from './program'
import { betaProfile } from './profile'
import { BETA_REGISTERS } from './registers'
import { BetaRuntime } from './runtime'
import { BETA_SETTINGS, type BetaSettings } from './settings'
import type { BetaSourceIndex } from './sourceIndex'
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
		let machine: BetaRuntime | undefined
		/** The last program assembled, whose index finds library macros for the editor. */
		let index: BetaSourceIndex | null = null
		/** The last program that assembled, whose symbols the data tips show. */
		let latest: BetaAssembly | null = null
		let disposed = false
		const contributions: Disposable[] = []
		const check = () => {
			if (disposed) throw new Error('Architecture services have been disposed')
		}
		return {
			disassembly: betaDisassembly,
			// UASM has one translation unit: the entry file, with the rest reached by `.include`.
			assemble({ files, entries }, settings) {
				check()
				const main = files.find((file) => file.name === entries[0]) ?? files[0]
				const result = assembleUasm(main, { files })
				// Caught here rather than when the machine loads it, so it is marked like any other error.
				const end = Math.max(0, ...(result.image?.sections ?? []).map((section) => section.address + section.bytes.length))
				if (end > settings.memoryBytes) {
					result.diagnostics.push({ severity: 'error', file: main.name, message: `The program needs ${end} bytes of memory; the machine has ${settings.memoryBytes}` })
				}
				const program = new BetaAssembly(main.name, result.image, result.diagnostics, result.directives, result.values)
				if (result.image) {
					index = program.betaIndex
					latest = program
				}
				return program
			},
			createMachine(program, settings, options) {
				check()
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
				machine?.dispose()
				machine = next
				return next
			},
			profile: (settings) => betaProfile(settings.memoryBytes),
			exportWords: (program) => betaAssembly(program).words(),
			describeToken: (text, column, state) => describeUasmToken(text, column, state, {
				value: (name) => latest?.values.get(name),
				macro: (name) => libraryMacros().get(name) ?? [],
			}),
			async installEditor(monaco, host) {
				check()
				const { installEditor } = await import('./editor')
				check()
				const contribution = installEditor(monaco, {
					files: () => host.files(),
					active: () => host.active(),
					open: (file, line) => host.open(file, line),
					sourceIndex: () => index,
					inspection: () => host.inspection(),
					values: () => latest?.values ?? null,
				})
				contributions.push(contribution)
				return contribution
			},
			dispose() {
				if (disposed) return
				disposed = true
				machine?.dispose()
				for (const contribution of contributions.reverse()) contribution.dispose()
			},
		}
	},
}

export default definition
