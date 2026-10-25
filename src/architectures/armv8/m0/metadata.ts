import { RegisterFormat, type ArchitectureVariant, type RegisterDescriptor } from '../../contracts'
import { EXAMPLES } from './examples'
import { LANGUAGE } from './layout'

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
