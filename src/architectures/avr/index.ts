import { examples } from './examples'
import { defineSettings } from '../../core/settings'
import type {
	ArchitectureDefinition,
	ArchitectureServices,
	Disposable,
	MachineProfile,
	RegisterDescriptor
} from '../contracts'
import { assembleAvr } from './assembler'
import { installEditor } from './editor'
import { manifest } from './manifest'
import { AvrProgram, disassembly } from './program'
import { AvrRuntime } from './runtime'

const registers: RegisterDescriptor[] = [
	...Array.from({ length: 32 }, (_, i) => ({
		id: `r${i}`,
		name: `r${i}`,
		bank: 'cpu',
		bits: 8,
		editable: true
	})),
	{ id: 'PC', name: 'PC (bytes)', bank: 'cpu', bits: 16, editable: true, role: 'programCounter' },
	{ id: 'SP', name: 'SP (data)', bank: 'cpu', bits: 16, editable: true, role: 'stackPointer' },
	{ id: 'SREG', name: 'SREG', bank: 'cpu', bits: 8, editable: true, role: 'flags' }
]
const profile: MachineProfile = {
	resetRegisters: {
		...Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`r${i}`, 0])),
		PC: 0,
		SP: 65535,
		SREG: 0
	},
	resetPc: 0,
	dataBase: 0x10100,
	memorySections: [
		{ id: 'flash', label: 'Flash (byte addresses)', start: 0, end: 65535, code: true },
		{ id: 'sram', label: 'SRAM (data + 0x10000)', start: 0x10100, end: 0x1ffff }
	],
	isMappedAddress: (value) => Number.isInteger(value) && value >= 0 && value < 131072
}
const definition: ArchitectureDefinition = {
	...manifest,
	language: 'avr',
	registers,
	registerBanks: [{ id: 'cpu', label: 'CPU' }],
	examples,
	settings: defineSettings({ defaults: {}, fields: [] }),
	createServices(): ArchitectureServices {
		let machine: AvrRuntime | undefined
		let disposed = false
		const contributions: Disposable[] = []
		const check = () => {
			if (disposed) throw new Error('Architecture services have been disposed')
		}
		return {
			assemble(sources) {
				check()
				const result = assembleAvr(sources)
				return new AvrProgram(
					result.image,
					result.diagnostics,
					sources.entries[0] ?? sources.files[0]?.name ?? 'main.asm'
				)
			},
			createMachine(program, _settings, options) {
				check()
				if (
					!(program instanceof AvrProgram) ||
					program.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
				)
					throw new Error('Not a valid AVR program')
				const next = new AvrRuntime(program, options)
				machine?.dispose()
				machine = next
				return next
			},
			profile: () => profile,
			disassembly,
			async installEditor(monaco, host) {
				check()
				const contribution = installEditor(monaco, host)
				contributions.push(contribution)
				return contribution
			},
			dispose() {
				if (disposed) return
				disposed = true
				machine?.dispose()
				for (const contribution of contributions.splice(0).reverse()) contribution.dispose()
			}
		}
	}
}
export default definition
