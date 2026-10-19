/**
 * The NMOS 6502: ca65-style assembly through the shared engine, run on a
 * bare CPU with 64 KiB of RAM and a console, keyboard and timer in the I/O
 * page at $F000.
 */

import type { ArchitectureDefinition, ArchitectureServices, AssembledProgram, Disposable, RegisterBank } from '../contracts'
import { assembleMos6502 } from './assembler'
import { describeMos6502Token } from './editor/dataTips'
import { MOS6502_LANGUAGE_ID } from './editor/grammar'
import { EXAMPLES } from './examples'
import { manifest } from './manifest'
import { mos6502Profile } from './profile'
import { Mos6502Assembly, mos6502Disassembly } from './program'
import { MOS6502_REGISTERS } from './registers'
import { Mos6502Runtime } from './runtime'
import { MOS6502_SETTINGS, type Mos6502Settings } from './settings'

const BANKS: readonly RegisterBank[] = [{ id: 'cpu', label: 'Registers' }]

/** Only this module's own assemblies can be loaded into its machines. */
function mos6502Assembly(program: AssembledProgram): Mos6502Assembly {
	if (!(program instanceof Mos6502Assembly)) throw new Error('Not a 6502 program')
	return program
}

const definition: ArchitectureDefinition<ArchitectureServices<Mos6502Settings>> = {
	id: manifest.id,
	name: manifest.name,
	language: MOS6502_LANGUAGE_ID,
	fileExtensions: manifest.fileExtensions,
	registers: MOS6502_REGISTERS,
	registerBanks: BANKS,
	examples: EXAMPLES,
	settings: MOS6502_SETTINGS,
	createServices(): ArchitectureServices<Mos6502Settings> {
		let machine: Mos6502Runtime | undefined
		/** The last program that assembled, whose symbols the data tips show. */
		let latest: Mos6502Assembly | null = null
		let disposed = false
		const contributions: Disposable[] = []
		const check = () => {
			if (disposed) throw new Error('Architecture services have been disposed')
		}
		return {
			disassembly: mos6502Disassembly,
			// One translation unit: the entry file, with the rest reached by `.include`.
			assemble({ files, entries }) {
				check()
				const main = files.find((file) => file.name === entries[0]) ?? files[0]
				const result = assembleMos6502(main, { files })
				const program = new Mos6502Assembly(main.name, result.image, result.diagnostics, result.breakpoints, result.values)
				if (result.image) latest = program
				return program
			},
			createMachine(program, settings, options) {
				check()
				const next = new Mos6502Runtime(mos6502Assembly(program), {
					decimal: settings.decimalMode,
					historyLimit: options.historyLimit,
					speed: options.speed,
				})
				machine?.dispose()
				machine = next
				return next
			},
			profile: () => mos6502Profile,
			describeToken: (text, column, state) => describeMos6502Token(text, column, state, { value: (name) => latest?.values.get(name) }),
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
