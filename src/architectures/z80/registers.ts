/**
 * The Z80 register file as the panels show it: the 8-bit registers, the pairs
 * they make, the alternate set, the index and control registers, and F's
 * flags each as a bit of its own. The 8-bit registers and the pairs are views
 * of the same state, so an edit to one shows in the other.
 */

import { RegisterFormat, type RegisterBank, type RegisterDescriptor } from '../contracts'
import {
	SLOT_AF, SLOT_AF_ALT, SLOT_BC, SLOT_BC_ALT, SLOT_DE, SLOT_DE_ALT, SLOT_HL, SLOT_HL_ALT,
	SLOT_I, SLOT_IFF1, SLOT_IFF2, SLOT_IM, SLOT_IX, SLOT_IY, SLOT_PC, SLOT_R, SLOT_SP,
} from './cpu'

export const Z80_BANKS: readonly RegisterBank[] = [
	{ id: 'main', label: 'Registers' },
	{ id: 'alternate', label: 'Alternate' },
	{ id: 'control', label: 'Control' },
]

/** Where a register's bits live: a slot of the CPU state, and the bits of it. */
export interface RegisterField {
	slot: number
	shift: number
	mask: number
}

const field = (slot: number, shift = 0, mask = 0xFFFF): RegisterField => ({ slot, shift, mask })

/** Every register but the T-state count, which is not CPU state. */
export const REGISTER_FIELDS: Readonly<Record<string, RegisterField>> = {
	A: field(SLOT_AF, 8, 0xFF),
	F: field(SLOT_AF, 0, 0xFF),
	B: field(SLOT_BC, 8, 0xFF),
	C: field(SLOT_BC, 0, 0xFF),
	D: field(SLOT_DE, 8, 0xFF),
	E: field(SLOT_DE, 0, 0xFF),
	H: field(SLOT_HL, 8, 0xFF),
	L: field(SLOT_HL, 0, 0xFF),
	AF: field(SLOT_AF),
	BC: field(SLOT_BC),
	DE: field(SLOT_DE),
	HL: field(SLOT_HL),
	IX: field(SLOT_IX),
	IY: field(SLOT_IY),
	SP: field(SLOT_SP),
	PC: field(SLOT_PC),
	AF2: field(SLOT_AF_ALT),
	BC2: field(SLOT_BC_ALT),
	DE2: field(SLOT_DE_ALT),
	HL2: field(SLOT_HL_ALT),
	I: field(SLOT_I, 0, 0xFF),
	R: field(SLOT_R, 0, 0xFF),
	IFF1: field(SLOT_IFF1, 0, 1),
	IFF2: field(SLOT_IFF2, 0, 1),
	IM: field(SLOT_IM, 0, 3),
	FS: field(SLOT_AF, 7, 1),
	FZ: field(SLOT_AF, 6, 1),
	FH: field(SLOT_AF, 4, 1),
	FPV: field(SLOT_AF, 2, 1),
	FN: field(SLOT_AF, 1, 1),
	FC: field(SLOT_AF, 0, 1),
}

/** T-states since the program loaded: the cycle count. */
export const T_STATES = 'T'

const register = (id: string, name: string, bank: string, group: string, bits: number, extra: Partial<RegisterDescriptor> = {}): RegisterDescriptor =>
	Object.freeze({ id, name, bank, group, bits, editable: true, ...extra })

const flag = (id: string, name: string) => register(id, name, 'main', 'Flags', 1, { format: RegisterFormat.FLAG })

export const Z80_REGISTERS: readonly RegisterDescriptor[] = Object.freeze([
	register('A', 'A', 'main', '8-bit', 8, { aliases: ['a'] }),
	register('F', 'F', 'main', '8-bit', 8, { aliases: ['f'], role: 'flags' }),
	register('B', 'B', 'main', '8-bit', 8, { aliases: ['b'] }),
	register('C', 'C', 'main', '8-bit', 8, { aliases: ['c'] }),
	register('D', 'D', 'main', '8-bit', 8, { aliases: ['d'] }),
	register('E', 'E', 'main', '8-bit', 8, { aliases: ['e'] }),
	register('H', 'H', 'main', '8-bit', 8, { aliases: ['h'] }),
	register('L', 'L', 'main', '8-bit', 8, { aliases: ['l'] }),
	register('AF', 'AF', 'main', 'Pairs', 16, { aliases: ['af'] }),
	register('BC', 'BC', 'main', 'Pairs', 16, { aliases: ['bc'] }),
	register('DE', 'DE', 'main', 'Pairs', 16, { aliases: ['de'] }),
	register('HL', 'HL', 'main', 'Pairs', 16, { aliases: ['hl'] }),
	register('IX', 'IX', 'main', 'Pairs', 16, { aliases: ['ix'] }),
	register('IY', 'IY', 'main', 'Pairs', 16, { aliases: ['iy'] }),
	register('SP', 'SP', 'main', 'Pairs', 16, { aliases: ['sp'], role: 'stackPointer' }),
	register('PC', 'PC', 'main', 'Pairs', 16, { aliases: ['pc'], role: 'programCounter' }),
	flag('FS', 'S'),
	flag('FZ', 'Z'),
	flag('FH', 'H'),
	flag('FPV', 'P/V'),
	flag('FN', 'N'),
	flag('FC', 'C'),
	register('AF2', 'AF\'', 'alternate', 'Alternate', 16, { aliases: ['af\''] }),
	register('BC2', 'BC\'', 'alternate', 'Alternate', 16, { aliases: ['bc\''] }),
	register('DE2', 'DE\'', 'alternate', 'Alternate', 16, { aliases: ['de\''] }),
	register('HL2', 'HL\'', 'alternate', 'Alternate', 16, { aliases: ['hl\''] }),
	register('I', 'I', 'control', 'Control', 8, { aliases: ['i'] }),
	register('R', 'R', 'control', 'Control', 8, { aliases: ['r'] }),
	register('IFF1', 'IFF1', 'control', 'Interrupts', 1),
	register('IFF2', 'IFF2', 'control', 'Interrupts', 1),
	register('IM', 'IM', 'control', 'Interrupts', 2),
	register(T_STATES, 'T-states', 'control', 'Timing', 32, { editable: false }),
])
