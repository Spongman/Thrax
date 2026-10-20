/**
 * The NMOS 6502 and W65C02S: ca65-style assembly through the shared engine, run on a
 * bare CPU with 64 KiB of RAM and a console, keyboard and timer in the I/O
 * page at $F000.
 */

import type { ArchitectureDefinition, ArchitectureServices, AssembledProgram, Disposable, RegisterBank } from '../contracts'
import { assembleMos6502 } from './assembler'
import { describeMos6502Token } from './editor/dataTips'
import { MOS6502_LANGUAGE_ID } from './editor/grammar'
import { CMOS_EXAMPLES, EXAMPLES } from './examples'
import { modelFor, W65C02_MODEL } from './isa'
import { manifest } from './manifest'
import { mos6502Profile } from './profile'
import { Mos6502Assembly, disassemblyFor } from './program'
import { MOS6502_REGISTERS } from './registers'
import { Mos6502Runtime } from './runtime'
import { MOS6502_SETTINGS, type Mos6502Settings } from './settings'

const BANKS: readonly RegisterBank[] = [{ id: 'cpu', label: 'Registers' }]
const NMOS_VARIANT = { language: MOS6502_LANGUAGE_ID, registers: MOS6502_REGISTERS, registerBanks: BANKS, examples: EXAMPLES }
const CMOS_VARIANT = { ...NMOS_VARIANT, language: 'ca65-w65c02', examples: CMOS_EXAMPLES }

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
	variant: settings => settings.cpuModel === 'w65c02' ? CMOS_VARIANT : NMOS_VARIANT,
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
			disassembly: {
				row: (row, next) => disassemblyFor(latest?.model).row(row, next),
				at: (memory, address) => disassemblyFor(latest?.model).at(memory, address),
			},
			// One translation unit: the entry file, with the rest reached by `.include`.
			assemble({ files, entries }, settings) {
				check()
				const main = files.find((file) => file.name === entries[0]) ?? files[0]
				const model = modelFor(settings.cpuModel)
				const result = assembleMos6502(main, { files, model })
				const program = new Mos6502Assembly(main.name, result.image, result.diagnostics, result.breakpoints, result.values, model)
				if (result.image) latest = program
				return program
			},
			createMachine(program, settings, options) {
				check()
				const next = new Mos6502Runtime(mos6502Assembly(program), {
					model: modelFor(settings.cpuModel),
					decimal: settings.decimalMode,
					historyLimit: options.historyLimit,
					speed: options.speed,
				})
				machine?.dispose()
				machine = next
				return next
			},
			profile: () => mos6502Profile,
			describeToken: (text, column, state) => describeMos6502Token(text, column, state, { model: latest?.model, value: (name) => latest?.values.get(name) }),
			async installEditor(monaco, host) {
				check()
				const { installEditor } = await import('./editor')
				check()
				const sources = {
					files: () => host.files(),
					active: () => host.active(),
					open: (file: string, line: number) => host.open(file, line),
					inspection: () => host.inspection(),
					values: () => latest?.values ?? null,
				}
				const parts = [installEditor(monaco, sources), installEditor(monaco, sources, W65C02_MODEL)]
				const contribution = { dispose: () => parts.splice(0).reverse().forEach((part) => part.dispose()) }
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
