/**
 * The Zilog Z80: Zilog-syntax assembly on the shared engine, run on a bare
 * 64 KiB machine with a console device in memory and on I/O ports.
 */

import { createArchitectureServices } from '../../core/architectureServices'

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
		return createArchitectureServices<Z80Settings>(({ check, program: inspectionProgram }) => {
			/** The loaded program, or a successful preview before the first load. */
			const current = () => inspectionProgram() as Z80Assembly | null
			return {
				disassembly: z80Disassembly,
				// One translation unit: the entry file, with the rest reached by INCLUDE.
				assemble({ files, entries }) {
					const main = files.find((file) => file.name === entries[0]) ?? files[0]
					const result = assembleZ80(main, { files })
					const program = new Z80Assembly(main.name, result.image, result.diagnostics, result.values)
					return program
				},
				createMachine(program, _settings, options) {
					const next = new Z80Runtime(z80Assembly(program), { historyLimit: options.historyLimit, speed: options.speed })
					return next
				},
				profile: () => z80Profile,
				describeToken: (text, column, state) => describeZ80Token(text, column, state, { value: (name) => current()?.values.get(name) }),
				async installEditor(monaco, host) {
					const { installEditor } = await import('./editor')
					check()
					const contribution = installEditor(monaco, {
						files: () => host.files(),
						active: () => host.active(),
						open: (file, line) => host.open(file, line),
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
