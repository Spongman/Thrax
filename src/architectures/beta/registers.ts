import type { RegisterDescriptor } from '../contracts'
import { R_XP, R_ZERO } from './cpu'

export { R_XP, R_ZERO }

/** Software conventions (beta.pdf section 7.1). */
export const R_BP = 27
export const R_LP = 28
export const R_SP = 29

/** Index of the PC among BETA_REGISTERS, after R0-R31. */
export const PC_INDEX = 32

/** A bit field of a register, for views that break one down. */
export interface RegisterField {
	name: string
	bit: number
	width: number
	description: string
}

export interface BetaRegisterDescriptor extends RegisterDescriptor {
	fields?: readonly RegisterField[]
}

const ALIASES: Readonly<Record<number, string>> = { [R_BP]: 'BP', [R_LP]: 'LP', [R_SP]: 'SP', [R_XP]: 'XP' }
const ROLES: Readonly<Record<number, RegisterDescriptor['role']>> = { [R_LP]: 'link', [R_SP]: 'stackPointer' }

/** R0-R31, then the PC. R31 always reads 0, so it is not editable. */
export const BETA_REGISTERS: readonly BetaRegisterDescriptor[] = Object.freeze([
	...Array.from({ length: 32 }, (_unused, index): BetaRegisterDescriptor => {
		const alias = ALIASES[index]
		const role = ROLES[index]
		return Object.freeze({
			id: `R${index}`,
			name: alias ?? `R${index}`,
			bank: 'integer',
			bits: 32,
			editable: index !== R_ZERO,
			aliases: Object.freeze(alias ? [`R${index}`, `r${index}`, alias.toLowerCase()] : [`r${index}`]),
			...(role ? { role } : {}),
		})
	}),
	Object.freeze({
		id: 'PC',
		name: 'PC',
		bank: 'control',
		bits: 32,
		editable: true,
		role: 'programCounter' as const,
		fields: Object.freeze([
			Object.freeze({ name: 'S', bit: 31, width: 1, description: 'Supervisor mode: interrupts disabled, privileged operations allowed' }),
			Object.freeze({ name: 'address', bit: 0, width: 31, description: 'Byte address of the next instruction' }),
		]),
	}),
])
