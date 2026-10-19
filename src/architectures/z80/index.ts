/**
 * The Zilog Z80: Zilog-syntax assembly on the shared engine, run on a bare
 * 64 KiB machine with a console device in memory and on I/O ports.
 */

import type { ArchitectureDefinition, ArchitectureServices, AssembledProgram, Disposable } from '../contracts'
import { assembleZ80 } from './asm'
import { describeZ80Token } from './editor/dataTips'
import { Z80_LANGUAGE_ID } from './editor/grammar'
import { EXAMPLES } from './examples'
import { manifest } from './manifest'
import { z80Profile } from './profile'
import { Z80Assembly, z80Disassembly } from './program'
import { Z80_BANKS, Z80_REGISTERS } from './registers'
import { Z80Runtime } from './runtime'
import { Z80_SETTINGS, type Z80Settings } from './settings'

/** Only this module's own assemblies can be loaded into its machines. */
function z80Assembly(program: AssembledProgram): Z80Assembly {
	if (!(program instanceof Z80Assembly)) throw new Error('Not a Z80 program')
	return program
}

const definition: ArchitectureDefinition<ArchitectureServices<Z80Settings>> = {
	id: manifest.id,
	name: manifest.name,
	language: Z80_LANGUAGE_ID,
	fileExtensions: manifest.fileExtensions,
	registers: Z80_REGISTERS,
	registerBanks: Z80_BANKS,
	examples: EXAMPLES,
	settings: Z80_SETTINGS,
	createServices(): ArchitectureServices<Z80Settings> {
		let machine: Z80Runtime | undefined
		/** The last program that assembled, whose symbols the data tips show. */
		let latest: Z80Assembly | null = null
		let disposed = false
		const contributions: Disposable[] = []
		const check = () => {
			if (disposed) throw new Error('Architecture services have been disposed')
		}
		return {
			disassembly: z80Disassembly,
			// One translation unit: the entry file, with the rest reached by INCLUDE.
			assemble({ files, entries }) {
				check()
				const main = files.find((file) => file.name === entries[0]) ?? files[0]
				const result = assembleZ80(main, { files })
				const program = new Z80Assembly(main.name, result.image, result.diagnostics, result.values)
				if (result.image) latest = program
				return program
			},
			createMachine(program, _settings, options) {
				check()
				const next = new Z80Runtime(z80Assembly(program), { historyLimit: options.historyLimit, speed: options.speed })
				machine?.dispose()
				machine = next
				return next
			},
			profile: () => z80Profile,
			describeToken: (text, column, state) => describeZ80Token(text, column, state, { value: (name) => latest?.values.get(name) }),
			async installEditor(monaco, host) {
				check()
				const { installEditor } = await import('./editor')
				check()
				const contribution = installEditor(monaco, {
					files: () => host.files(),
					active: () => host.active(),
					open: (file, line) => host.open(file, line),
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
