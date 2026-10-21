import { RGB32_BE } from '../../core/bitmapFormats'
import type { MachineProfile, RegisterDescriptor } from '../contracts'
import { DATA_BASE, MEMORY_BYTES, REGISTER_NAMES, TEXT_BASE } from './isa'

export const REGISTERS: readonly RegisterDescriptor[] = [
	...REGISTER_NAMES.map((name, i) => ({
		id: name,
		name,
		bank: 'cpu',
		group: i < 8 ? 'Data' : 'Address',
		bits: 32,
		editable: true,
		aliases: i === 15 ? ['SP'] : undefined,
		role: i === 15 ? ('stackPointer' as const) : undefined
	})),
	{ id: 'PC', name: 'PC', bank: 'cpu', bits: 32, editable: true, role: 'programCounter' },
	{ id: 'SR', name: 'SR', bank: 'cpu', bits: 16, editable: false },
	{ id: 'CCR', name: 'CCR', bank: 'cpu', bits: 8, editable: true },
	...['X', 'N', 'Z', 'V', 'C'].map((name) => ({
		id: name,
		name,
		bank: 'cpu',
		group: 'Condition codes',
		bits: 1,
		editable: true,
		format: 2
	}))
]
export const m68kProfile: MachineProfile = {
	bitmap: RGB32_BE,
	resetRegisters: {
		...Object.fromEntries(REGISTER_NAMES.map((name, i) => [name, i === 15 ? MEMORY_BYTES - 16 : 0])),
		PC: TEXT_BASE,
		SR: 0x2000,
		CCR: 0,
		X: 0,
		N: 0,
		Z: 0,
		V: 0,
		C: 0
	},
	resetPc: TEXT_BASE,
	dataBase: DATA_BASE,
	memorySections: [
		{ id: 'ram', label: 'RAM', start: 0, end: MEMORY_BYTES - 1 },
		{ id: 'text', label: 'text', start: TEXT_BASE, end: DATA_BASE - 1, code: true },
		{ id: 'data', label: 'data / bitmap', start: DATA_BASE, end: MEMORY_BYTES - 1 }
	],
	isMappedAddress: (value) => Number.isInteger(value) && value >= 0 && value < MEMORY_BYTES
}
