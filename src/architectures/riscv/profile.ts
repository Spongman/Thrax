import { RGB32_LE } from '../../core/bitmapFormats'
import type { MachineProfile, RegisterDescriptor } from '../contracts'
import { ABI, DATA_BASE, MEMORY_BYTES, TEXT_BASE } from './isa'
export const REGISTERS: readonly RegisterDescriptor[] = [
	...ABI.map((name, index) => ({
		id: `x${index}`,
		name: `x${index} (${name})`,
		bank: 'cpu',
		bits: 32,
		editable: index !== 0,
		aliases: index === 8 ? [name, 'fp'] : [name],
		role: index === 1 ? ('link' as const) : index === 2 ? ('stackPointer' as const) : undefined
	})),
	{ id: 'PC', name: 'PC', bank: 'cpu', bits: 32, editable: true, role: 'programCounter' }
]
export const riscvProfile: MachineProfile = {
	bitmap: RGB32_LE,
	resetRegisters: {
		...Object.fromEntries(ABI.map((_, index) => [`x${index}`, index === 2 ? MEMORY_BYTES - 16 : 0])),
		PC: TEXT_BASE
	},
	resetPc: TEXT_BASE,
	dataBase: DATA_BASE,
	memorySections: [
		{ id: 'ram', label: 'RAM', start: 0, end: MEMORY_BYTES - 1 },
		{ id: 'text', label: 'text', start: TEXT_BASE, end: DATA_BASE - 1, code: true },
		{ id: 'data', label: 'data', start: DATA_BASE, end: MEMORY_BYTES - 1 }
	],
	isMappedAddress: (value) => Number.isInteger(value) && value >= 0 && value < MEMORY_BYTES
}
