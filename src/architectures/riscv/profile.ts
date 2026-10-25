import { RGB32_LE } from '../../core/bitmapFormats'
import { RegisterFormat, type MachineProfile, type RegisterDescriptor } from '../contracts'
import { ABI, DATA_BASE, FABI, MEMORY_BYTES, TEXT_BASE } from './isa'
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
/**
 * f0-f31 show their low word, which holds a single (NaN-boxed under D). With D
 * each pairs with a high word `fN.hi`, so the double view reads all 64 bits.
 */
export const floatRegisters = (flen: number): RegisterDescriptor[] => [
	...FABI.map((name, index) => ({
		id: `f${index}`,
		name: `f${index} (${name})`,
		bank: 'fpu',
		group: 'Floating Point',
		bits: 32,
		editable: true,
		format: RegisterFormat.FLOAT,
		aliases: [name],
		pairsWith: flen === 64 ? `f${index}.hi` : undefined
	})),
	{ id: 'fcsr', name: 'fcsr', bank: 'fpu', group: 'Control and Status', bits: 8, editable: true },
	{ id: 'frm', name: 'frm', bank: 'fpu', group: 'Control and Status', bits: 3, editable: true },
	{ id: 'fflags', name: 'fflags', bank: 'fpu', group: 'Control and Status', bits: 5, editable: true }
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
