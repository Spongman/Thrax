/**
 * ARM: programs in the execution state the settings choose, assembled
 * and run by that state. AArch64 runs GNU as A64 source on the shared engine;
 * AArch32 runs A32 source in GNU as or armasm syntax through the shared ARM
 * library. Those states run in user mode under Linux system calls. Cortex-M0
 * runs ARMv6-M Thumb in Thread mode with its explicit teaching console ABI.
 */

import { ARCH_V8 } from '../arm/a32/isa'
import { ARM_LANGUAGE_ID } from '../arm/editor/grammar'
import type { ArchitectureDefinition, ArchitectureServices, ArchitectureVariant, Disposable, Machine } from '../contracts'
import { A32_EXAMPLES } from './a32/examples'
import { A32_REGISTER_BANKS, A32_REGISTERS } from './a32/registers'
import { createA32State } from './a32/state'
import { A64_REGISTER_BANKS, A64_REGISTERS } from './a64/registers'
import { createA64State } from './a64/state'
import { A64_LANGUAGE_ID } from './editor/grammar'
import { EXAMPLES } from './examples'
import type { ExecutionState } from './executionState'
import { manifest } from './manifest'
import { createM0State, M0_VARIANT } from './m0/state'
import { ARMV8_SETTINGS, DEFAULT_ARMV8_SETTINGS, type Armv8Settings } from './settings'

/** Each execution state the setting can name, made fresh per activation. */
const STATES: Readonly<Record<string, () => ExecutionState>> = {
	aarch64: createA64State,
	aarch32: createA32State,
	'cortex-m0': createM0State,
}

/** What each state edits, shows and offers; an unknown one falls back to AArch64. */
const VARIANTS: Readonly<Record<string, ArchitectureVariant>> = {
	aarch64: Object.freeze({ language: A64_LANGUAGE_ID, registers: A64_REGISTERS, registerBanks: A64_REGISTER_BANKS, examples: EXAMPLES }),
	aarch32: Object.freeze({ language: ARM_LANGUAGE_ID, registers: A32_REGISTERS, registerBanks: A32_REGISTER_BANKS, examples: A32_EXAMPLES }),
	'cortex-m0': M0_VARIANT,
}

const definition: ArchitectureDefinition<ArchitectureServices<Armv8Settings>> = {
	id: manifest.id,
	name: manifest.name,
	...VARIANTS.aarch64,
	fileExtensions: manifest.fileExtensions,
	settings: ARMV8_SETTINGS,
	variant: ({ executionState }) => VARIANTS[executionState as string] ?? VARIANTS.aarch64,
	createServices(): ArchitectureServices<Armv8Settings> {
		const states = new Map<string, ExecutionState>()
		let machine: Machine | undefined
		let latest: ExecutionState | null = null
		let disposed = false
		const contributions: Disposable[] = []
		const check = () => {
			if (disposed) throw new Error('Architecture services have been disposed')
		}
		/** The state a setting names; an unknown one falls back to AArch64. */
		const stateFor = ({ executionState }: Armv8Settings): ExecutionState => {
			const id = STATES[executionState] ? executionState : 'aarch64'
			let state = states.get(id)
			if (!state) states.set(id, state = STATES[id]())
			return state
		}
		/** The state that last assembled, which disassembly and data tips follow. */
		const current = () => latest ?? stateFor(DEFAULT_ARMV8_SETTINGS)
		return {
			disassembly: {
				row: (row, next) => current().disassembly.row(row, next),
				at: (memory, address) => current().disassembly.at(memory, address),
			},
			assemble(sources, settings) {
				check()
				latest = stateFor(settings)
				return latest.assemble(sources, settings)
			},
			createMachine(program, settings, options) {
				check()
				const next = stateFor(settings).createMachine(program, settings, options)
				machine?.dispose()
				machine = next
				return next
			},
			profile: (settings) => stateFor(settings).profile(settings),
			describeToken: (text, column, inspection) => current().describeToken(text, column, inspection),
			// Every state's language, so files read right whichever state is chosen.
			async installEditor(monaco, host) {
				check()
				const [a64Editor, armEditor, m0Editor] = await Promise.all([import('./editor'), import('../arm/editor'), import('./m0/editor')])
				check()
				const sources = {
					files: () => host.files(),
					active: () => host.active(),
					open: (file: string, line: number) => host.open(file, line),
					inspection: () => host.inspection(),
					values: () => current().values(),
				}
				const parts = [a64Editor.installEditor(monaco, sources), armEditor.installEditor(monaco, sources, ARCH_V8), m0Editor.installM0Editor(monaco, host)]
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
