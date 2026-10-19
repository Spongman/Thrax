import { RegisterFormat, type RegisterDescriptor } from '../contracts'
import { FLAG_B, FLAG_C, FLAG_D, FLAG_I, FLAG_N, FLAG_V, FLAG_Z } from './cpu'

/** The status flags in NV-BDIZC order, with the P bit each one is. */
export const FLAGS: readonly { id: string, bit: number, description: string }[] = Object.freeze([
	{ id: 'N', bit: FLAG_N, description: 'Negative: bit 7 of the last result' },
	{ id: 'V', bit: FLAG_V, description: 'Overflow: the last signed ADC, SBC or BIT bit 6' },
	{ id: 'B', bit: FLAG_B, description: 'Break: only in the copy of P that PHP and BRK push' },
	{ id: 'D', bit: FLAG_D, description: 'Decimal: ADC and SBC work in BCD' },
	{ id: 'I', bit: FLAG_I, description: 'Interrupt disable: IRQ is ignored while set' },
	{ id: 'Z', bit: FLAG_Z, description: 'Zero: the last result was 0' },
	{ id: 'C', bit: FLAG_C, description: 'Carry: out of bit 7, or no borrow' },
])

const register = (id: string, bits: number, role?: RegisterDescriptor['role'], editable = true): RegisterDescriptor =>
	Object.freeze({ id, name: id, bank: 'cpu', group: 'Registers', bits, editable, aliases: Object.freeze([id.toLowerCase()]), ...(role ? { role } : {}) })

/** A X Y SP PC P, the flags, then the cycle counter. */
export const MOS6502_REGISTERS: readonly RegisterDescriptor[] = Object.freeze([
	register('A', 8),
	register('X', 8),
	register('Y', 8),
	register('SP', 8, 'stackPointer'),
	register('PC', 16, 'programCounter'),
	register('P', 8, 'flags'),
	...FLAGS.map(({ id }): RegisterDescriptor => Object.freeze({
		id, name: id, bank: 'cpu', group: 'Flags', bits: 1, editable: id !== 'B', format: RegisterFormat.FLAG,
	})),
	Object.freeze({ id: 'CYC', name: 'Cycles', bank: 'cpu', group: 'Counters', bits: 32, editable: false }),
])
