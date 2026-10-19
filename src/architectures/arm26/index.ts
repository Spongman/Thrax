/**
 * ARM in 26-bit mode (ARMv2a: the ARM2 and ARM3 of the Acorn Archimedes):
 * GNU as or armasm through the shared engine, run on the 26-bit CPU with a
 * RISC OS-style SWI console and a memory-mapped keyboard.
 */

import { describeArmToken } from '../arm/editor/dataTips'
import { ARM_LANGUAGE_ID } from '../arm/editor/grammar'
import { dialectId } from '../arm/assembler/dialect'
import { ArmAssembly, armDisassembly, bytesAt } from '../arm/program'
import type { ArchitectureDefinition, ArchitectureServices, AssembledProgram, Disposable } from '../contracts'
import { assembleArm26 } from './assemble'
import { EXAMPLES } from './examples'
import { TEXT_BASE } from './machine'
import { manifest } from './manifest'
import { arm26Profile } from './profile'
import { ARM26_BANKS, ARM26_REGISTERS } from './registers'
import { Arm26Runtime } from './runtime'
import { ARM26_SETTINGS, type Arm26Settings } from './settings'

/** Only this module's own assemblies can be loaded into its machines. */
function armAssembly(program: AssembledProgram): ArmAssembly {
	if (!(program instanceof ArmAssembly)) throw new Error('Not an ARM program')
	return program
}

const definition: ArchitectureDefinition<ArchitectureServices<Arm26Settings>> = {
	id: manifest.id,
	name: manifest.name,
	language: ARM_LANGUAGE_ID,
	fileExtensions: manifest.fileExtensions,
	registers: ARM26_REGISTERS,
	registerBanks: ARM26_BANKS,
	examples: EXAMPLES,
	settings: ARM26_SETTINGS,
	createServices(): ArchitectureServices<Arm26Settings> {
		let machine: Arm26Runtime | undefined
		/** The last program that assembled, whose symbols the data tips show. */
		let latest: ArmAssembly | null = null
		let disposed = false
		const contributions: Disposable[] = []
		const check = () => {
			if (disposed) throw new Error('Architecture services have been disposed')
		}
		return {
			disassembly: armDisassembly,
			// One translation unit: the entry file, with the rest reached by .include.
			assemble({ files, entries }, settings) {
				check()
				const main = files.find((file) => file.name === entries[0]) ?? files[0]
				const result = assembleArm26(main, { files, fallbackDialect: dialectId(settings.dialect) })
				// Caught here rather than when the machine loads it, so it is marked like any other error.
				const end = Math.max(0, ...(result.image?.sections ?? []).map((section) => section.address + section.bytes.length))
				if (end > settings.memoryBytes) {
					result.diagnostics.push({ severity: 'error', file: main.name, message: `The program needs ${end} bytes of memory; the machine has ${settings.memoryBytes}` })
				}
				const failed = result.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
				const program = new ArmAssembly(main.name, failed ? null : result.image, result.diagnostics, result.values, result.dialect)
				if (!failed && result.image) latest = program
				return program
			},
			createMachine(program, settings, options) {
				check()
				const next = new Arm26Runtime(armAssembly(program), { memoryBytes: settings.memoryBytes, historyLimit: options.historyLimit, speed: options.speed })
				machine?.dispose()
				machine = next
				return next
			},
			profile: (settings) => arm26Profile(settings.memoryBytes),
			exportWords(program) {
				const image = armAssembly(program).image()
				const end = Math.max(TEXT_BASE, ...image.sections.map((section) => section.address + section.bytes.length))
				const bytes = bytesAt(image, TEXT_BASE, Math.ceil((end - TEXT_BASE) / 4) * 4)
				const view = new DataView(bytes.buffer)
				return Array.from({ length: bytes.length / 4 }, (_unused, index) => view.getUint32(index * 4, true))
			},
			describeToken: (text, column, state) => describeArmToken(text, column, state, { value: (name) => latest?.values.get(name) }),
			async installEditor(monaco, host) {
				check()
				const { installEditor } = await import('../arm/editor')
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
