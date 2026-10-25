/**
 * The AArch64 register file as the panels see it: X0-X30, SP and PC as exact
 * 64-bit values, NZCV whole and bit by bit, the W views of X0-X30, and
 * the scalar views of V0-V31 with FPCR and FPSR.
 *
 * The panel reads a float register as 32 bits, paired with the next for a
 * double, so each Vn is listed by its low word (`Vn`, the S view) paired
 * with bits 32-63 (`Vn:hi`, a value without a row): its d view is Dn.
 */

import { RegisterFormat, type RegisterBank, type RegisterDescriptor, type RegisterValue, type Registers } from '../../contracts'
import { FLAG_C, FLAG_N, FLAG_V, FLAG_Z, MASK32, R_FP, R_LR } from './isa'

export const A64_REGISTER_BANKS: readonly RegisterBank[] = Object.freeze([
	{ id: 'integer', label: 'Registers' },
	{ id: 'w', label: 'W (32-bit)' },
	{ id: 'fp', label: 'FP' },
])

/** Id of the value holding bits 32-63 of Vn. */
export const vectorHighId = (index: number) => `V${index}:hi`

const FP_GROUP = 'V0-V31 (f: Sn, d: Dn)'

const xRegister = (index: number): RegisterDescriptor => Object.freeze({
	id: `X${index}`,
	name: index === R_FP ? 'X29 (FP)' : index === R_LR ? 'X30 (LR)' : `X${index}`,
	bank: 'integer',
	group: 'General purpose',
	bits: 64,
	editable: true,
	aliases: Object.freeze([`x${index}`, ...(index === R_FP ? ['fp'] : index === R_LR ? ['lr'] : [])]),
	...(index === R_LR ? { role: 'link' as const } : {}),
})

const FLAGS: readonly [string, number, string][] = [['N', FLAG_N, 'Negative'], ['Z', FLAG_Z, 'Zero'], ['C', FLAG_C, 'Carry'], ['V', FLAG_V, 'Overflow']]

/** X0-X30, SP, PC and NZCV, then the flags, then W0-W30. */
export const A64_REGISTERS: readonly RegisterDescriptor[] = Object.freeze([
	...Array.from({ length: 31 }, (_unused, index) => xRegister(index)),
	Object.freeze({ id: 'SP', name: 'SP', bank: 'integer', group: 'Special', bits: 64, editable: true, aliases: Object.freeze(['sp']), role: 'stackPointer' as const }),
	Object.freeze({ id: 'PC', name: 'PC', bank: 'integer', group: 'Special', bits: 64, editable: true, aliases: Object.freeze(['pc']), role: 'programCounter' as const }),
	Object.freeze({ id: 'NZCV', name: 'NZCV', bank: 'integer', group: 'Special', bits: 32, editable: true, aliases: Object.freeze(['nzcv']), role: 'flags' as const }),
	...FLAGS.map(([name]) => Object.freeze({ id: name, name, bank: 'integer', group: 'Flags', bits: 1, editable: false, format: RegisterFormat.FLAG })),
	...Array.from({ length: 31 }, (_unused, index) => Object.freeze({ id: `W${index}`, name: `W${index}`, bank: 'w', group: 'W views', bits: 32, editable: true, aliases: Object.freeze([`w${index}`]) })),
	...Array.from({ length: 32 }, (_unused, index): RegisterDescriptor => Object.freeze({
		id: `V${index}`, name: `V${index}`, bank: 'fp', group: FP_GROUP, bits: 32, editable: true, format: RegisterFormat.FLOAT,
		pairsWith: vectorHighId(index), aliases: Object.freeze([`v${index}`, `s${index}`, `d${index}`, `q${index}`]),
	})),
	Object.freeze({ id: 'FPCR', name: 'FPCR', bank: 'fp', group: 'FP control', bits: 32, editable: true, aliases: Object.freeze(['fpcr']) }),
	Object.freeze({ id: 'FPSR', name: 'FPSR', bank: 'fp', group: 'FP control', bits: 32, editable: true, aliases: Object.freeze(['fpsr']) }),
])

/** NZCV as the register shows it: the flags in bits 31 to 28. */
export const nzcvRegister = (nzcv: number) => (nzcv << 28) >>> 0

export interface A64RegisterState {
	readonly x: ArrayLike<bigint>
	readonly sp: bigint
	readonly pc: number
	readonly nzcv: number
	/** V0-V31 as doublewords, low first. */
	readonly v: ArrayLike<bigint>
	readonly fpcr: number
	readonly fpsr: number
}

/** Every register by descriptor id. */
export function a64RegisterValues(state: A64RegisterState): Registers {
	const values: Record<string, RegisterValue> = {}
	for (let index = 0; index < 31; index++) {
		values[`X${index}`] = state.x[index]
		values[`W${index}`] = Number(state.x[index] & MASK32)
	}
	values.SP = state.sp
	values.PC = BigInt(state.pc)
	values.NZCV = nzcvRegister(state.nzcv)
	for (const [name, bit] of FLAGS) values[name] = state.nzcv & bit ? 1 : 0
	for (let index = 0; index < 32; index++) {
		const low = state.v[2 * index]
		values[`V${index}`] = Number(low & MASK32)
		values[vectorHighId(index)] = Number(low >> 32n)
	}
	values.FPCR = state.fpcr >>> 0
	values.FPSR = state.fpsr >>> 0
	return values
}

/** What an edit of register `id` means: an X index (31 for SP), the PC, the flags, a V register's low or high word, FPCR, FPSR, or nothing. */
export function editTarget(id: string): { kind: 'x' | 'w' | 'pc' | 'nzcv' | 'vlow' | 'vhigh' | 'fpcr' | 'fpsr', index: number } | null {
	const vector = /^V(\d+)(:hi)?$/.exec(id)
	if (vector && Number(vector[1]) < 32) return { kind: vector[2] ? 'vhigh' : 'vlow', index: Number(vector[1]) }
	if (id === 'FPCR') return { kind: 'fpcr', index: 0 }
	if (id === 'FPSR') return { kind: 'fpsr', index: 0 }
	const match = /^([XW])(\d+)$/.exec(id)
	if (match && Number(match[2]) <= 30) return { kind: match[1] === 'X' ? 'x' : 'w', index: Number(match[2]) }
	if (id === 'SP') return { kind: 'x', index: 31 }
	if (id === 'PC') return { kind: 'pc', index: 0 }
	if (id === 'NZCV') return { kind: 'nzcv', index: 0 }
	return null
}
