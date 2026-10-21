import { RGB32_LE } from '../../../core/bitmapFormats'
import { describeM0Token } from './dataTips'
import { RegisterFormat, type ArchitectureVariant, type RegisterDescriptor } from '../../contracts'
import { memoryTop } from '../a64/layout'
import type { ExecutionState } from '../executionState'
import { assembleM0 } from './assembler'
import { EXAMPLES } from './examples'
import { DATA_BASE, LANGUAGE, TEXT_BASE } from './isa'
import { disassembly, M0Program } from './program'
import { M0Runtime } from './runtime'

export const REGISTERS: readonly RegisterDescriptor[] = [
	...Array.from({ length: 15 }, (_, n): RegisterDescriptor => ({
		id: `R${n}`,
		name: n === 13 ? 'SP' : n === 14 ? 'LR' : `R${n}`,
		aliases: n === 13 ? ['sp', 'r13'] : n === 14 ? ['lr', 'r14'] : [`r${n}`],
		bank: 'cpu',
		bits: 32,
		editable: true,
		role: n === 13 ? 'stackPointer' : n === 14 ? 'link' : undefined,
	})),
	{
		id: 'PC',
		name: 'PC',
		aliases: ['r15', 'pc'],
		bank: 'cpu',
		bits: 32,
		editable: true,
		role: 'programCounter',
	},
	...['APSR', 'XPSR', 'MSP', 'PSP', 'CONTROL', 'PRIMASK'].map((id): RegisterDescriptor => ({
		id,
		name: id,
		bank: 'cpu',
		bits: 32,
		editable: id !== 'XPSR',
		role: id === 'APSR' ? 'flags' : undefined,
	})),
	...['N', 'Z', 'C', 'V'].map((id): RegisterDescriptor => ({
		id,
		name: id,
		bank: 'cpu',
		bits: 1,
		editable: false,
		format: RegisterFormat.FLAG,
	})),
]
export const M0_VARIANT: ArchitectureVariant = {
	language: LANGUAGE,
	registers: REGISTERS,
	registerBanks: [{ id: 'cpu', label: 'Cortex-M0' }],
	examples: EXAMPLES,
}
export function createM0State(): ExecutionState {
	let latest: M0Program | null = null
	return {
		id: 'cortex-m0',
		assemble(sources, settings) {
			const program = assembleM0(sources, settings.memoryBytes)
			if (program.assembled) latest = program
			return program
		},
		createMachine(program, settings, options) {
			if (!(program instanceof M0Program) || program.diagnostics.some((d) => d.severity === 'error'))
				throw new Error('Not a Cortex-M0 Thumb program')
			return new M0Runtime(program, settings.memoryBytes, options)
		},
		profile(settings) {
			const top = memoryTop(settings.memoryBytes)
			return {
				bitmap: RGB32_LE,
				resetPc: TEXT_BASE,
				resetRegisters: {
					...Object.fromEntries(REGISTERS.map((r) => [r.id, 0])),
					R13: top & ~7,
					MSP: top & ~7,
					PSP: top & ~7,
					XPSR: 1 << 24,
					PC: TEXT_BASE,
				},
				dataBase: DATA_BASE,
				memorySections: [
					{ id: 'text', label: 'Thumb code', start: TEXT_BASE, end: DATA_BASE - 1, code: true },
					{ id: 'data', label: 'Data and stack', start: DATA_BASE, end: top - 1 },
				],
				isMappedAddress: (value) => Number.isInteger(value) && value >= TEXT_BASE && value < top,
			}
		},
		disassembly,
		describeToken: (text, column, inspection) => describeM0Token(text, column, inspection, (name) => latest?.labels.get(name)),
		values: () => latest?.labels ?? null,
	}
}
