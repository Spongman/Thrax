/**
 * The AArch32 register file as the panels see it: R0-R14 and the PC, the
 * CPSR whole, and its flags bit by bit. Ids follow the shared ARM data tips:
 * R0-R14, with R15 as PC. The VFP tab lists S0-S31, which the panel's
 * double view pairs into D0-D15, and FPSCR.
 */

import { RegisterFormat, type RegisterBank, type RegisterDescriptor, type Registers } from '../../contracts'

export const A32_REGISTER_BANKS: readonly RegisterBank[] = Object.freeze([{ id: 'integer', label: 'Registers' }, { id: 'vfp', label: 'VFP' }])

const NAMES: Readonly<Record<number, string>> = { 11: 'R11 (FP)', 12: 'R12 (IP)', 13: 'SP', 14: 'LR' }
const ALIASES: Readonly<Record<number, readonly string[]>> = { 11: ['fp'], 12: ['ip'], 13: ['R13', 'r13', 'sp'], 14: ['R14', 'r14', 'lr'] }
const ROLES: Readonly<Record<number, RegisterDescriptor['role']>> = { 13: 'stackPointer', 14: 'link' }

/** Flags by descriptor id, and the CPSR bit each reads. */
export const FLAG_BITS: Readonly<Record<string, number>> = Object.freeze({ N: 31, Z: 30, C: 29, V: 28, Q: 27 })

export const A32_REGISTERS: readonly RegisterDescriptor[] = Object.freeze([
	...Array.from({ length: 15 }, (_unused, index): RegisterDescriptor => Object.freeze({
		id: `R${index}`,
		name: NAMES[index] ?? `R${index}`,
		bank: 'integer',
		group: 'General purpose',
		bits: 32,
		editable: true,
		aliases: Object.freeze(ALIASES[index] ? [`r${index}`, ...ALIASES[index]] : [`r${index}`]),
		...(ROLES[index] ? { role: ROLES[index] } : {}),
	})),
	Object.freeze({ id: 'PC', name: 'PC', bank: 'integer', group: 'Special', bits: 32, editable: true, aliases: Object.freeze(['R15', 'r15', 'pc']), role: 'programCounter' as const }),
	Object.freeze({ id: 'CPSR', name: 'CPSR', bank: 'integer', group: 'Special', bits: 32, editable: true, aliases: Object.freeze(['cpsr', 'apsr']), role: 'flags' as const }),
	...Object.keys(FLAG_BITS).map((name): RegisterDescriptor => Object.freeze({ id: name, name, bank: 'integer', group: 'Flags', bits: 1, editable: false, format: RegisterFormat.FLAG })),
	...Array.from({ length: 32 }, (_unused, index): RegisterDescriptor => Object.freeze({
		id: `S${index}`,
		name: `S${index}`,
		bank: 'vfp',
		group: 'S0-S31 (D0-D15 in the d view)',
		bits: 32,
		editable: true,
		format: RegisterFormat.FLOAT,
		aliases: Object.freeze(index % 2 === 0 ? [`s${index}`, `d${index / 2}`] : [`s${index}`]),
		// D<n> is S<2n+1>:S<2n>.
		...(index % 2 === 0 ? { pairsWith: `S${index + 1}` } : {}),
	})),
	Object.freeze({ id: 'FPSCR', name: 'FPSCR', bank: 'vfp', group: 'Status', bits: 32, editable: true, aliases: Object.freeze(['fpscr']) }),
])

export interface A32RegisterState {
	readonly r: ArrayLike<number>
	readonly pc: number
	readonly cpsr: number
	readonly s: ArrayLike<number>
	readonly fpscr: number
}

/** Every register by descriptor id, unsigned. */
export function a32RegisterValues(state: A32RegisterState): Registers {
	const values: Registers = {}
	for (let index = 0; index < 15; index++) values[`R${index}`] = state.r[index] >>> 0
	values.PC = state.pc
	values.CPSR = state.cpsr >>> 0
	for (const [name, bit] of Object.entries(FLAG_BITS)) values[name] = (state.cpsr >>> bit) & 1
	for (let index = 0; index < 32; index++) values[`S${index}`] = state.s[index] >>> 0
	values.FPSCR = state.fpscr >>> 0
	return values
}
