/**
 * ARMv8-A: programs in the execution state the settings choose, assembled
 * and run by that state. AArch64 is the one implemented: GNU as A64 source on
 * the shared engine, run at EL0 under Linux system calls.
 */

import type { ArchitectureDefinition, ArchitectureServices, Disposable, Machine } from '../contracts'
import { A64_REGISTER_BANKS, A64_REGISTERS } from './a64/registers'
import { createA64State } from './a64/state'
import { A64_LANGUAGE_ID } from './editor/grammar'
import { EXAMPLES } from './examples'
import type { ExecutionState } from './executionState'
import { manifest } from './manifest'
import { ARMV8_SETTINGS, DEFAULT_ARMV8_SETTINGS, type Armv8Settings } from './settings'

/** Each execution state the setting can name, made fresh per activation. */
const STATES: Readonly<Record<string, () => ExecutionState>> = {
	aarch64: createA64State,
}

const definition: ArchitectureDefinition<ArchitectureServices<Armv8Settings>> = {
	id: manifest.id,
	name: manifest.name,
	language: A64_LANGUAGE_ID,
	fileExtensions: manifest.fileExtensions,
	registers: A64_REGISTERS,
	registerBanks: A64_REGISTER_BANKS,
	examples: EXAMPLES,
	settings: ARMV8_SETTINGS,
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
			async installEditor(monaco, host) {
				check()
				const { installEditor } = await import('./editor')
				check()
				const contribution = installEditor(monaco, {
					files: () => host.files(),
					active: () => host.active(),
					open: (file, line) => host.open(file, line),
					inspection: () => host.inspection(),
					values: () => current().values(),
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
