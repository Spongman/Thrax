import { describeToken, installEditor } from './editor'
import { createArchitectureServices } from '../../core/architectureServices'
import type {
	ArchitectureDefinition,
	ArchitectureServices,
} from '../contracts'
import { assembleM68k } from './assembler'
import { EXAMPLES, EXAMPLES_68010, EXAMPLES_68020 } from './examples'
import { manifest } from './manifest'
import { m68kProfile, REGISTERS } from './profile'
import { M68kAssembly, m68kDisassembly } from './program'
import { M68kRuntime } from './runtime'
import { M68K_SETTINGS, type M68kSettings } from './settings'

const VARIANTS = {
	'68000': {
		language: 'thrax-m68k',
		registers: REGISTERS,
		registerBanks: [{ id: 'cpu', label: '68000 family' }],
		examples: EXAMPLES
	},
	'68010': {
		language: 'thrax-m68k',
		registers: REGISTERS,
		registerBanks: [{ id: 'cpu', label: '68000 family' }],
		examples: EXAMPLES_68010
	},
	'68020': {
		language: 'thrax-m68k',
		registers: REGISTERS,
		registerBanks: [{ id: 'cpu', label: '68000 family' }],
		examples: EXAMPLES_68020
	}
}

const definition: ArchitectureDefinition<ArchitectureServices<M68kSettings>> = {
	...manifest,
	language: 'thrax-m68k',
	registers: REGISTERS,
	registerBanks: [{ id: 'cpu', label: '68000 family' }],
	examples: EXAMPLES,
	settings: M68K_SETTINGS,
	variant(settings) {
		return settings.cpuModel === '68020'
			? VARIANTS['68020']
			: settings.cpuModel === '68010'
				? VARIANTS['68010']
				: VARIANTS['68000']
	},
	createServices() {
		return createArchitectureServices<M68kSettings>(() => {
			let model: M68kSettings['cpuModel'] = '68000'
			return {
				assemble(sources, settings) {
					model = settings.cpuModel
					return assembleM68k(sources, model)
				},
				createMachine(program, _settings, options) {
					if (!(program instanceof M68kAssembly)) throw new Error('Not a 68000 program')
					const next = new M68kRuntime(program, options)
					return next
				},
				profile: () => m68kProfile,
				disassembly: {
					row: (row, next) => m68kDisassembly(model).row(row, next),
					at: (memory, address) => m68kDisassembly(model).at(memory, address)
				},
				describeToken,
				installEditor,
			}
		})
	}
}
export default definition
