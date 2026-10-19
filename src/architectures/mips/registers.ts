/** The MIPS register files as the shared register panel lists them. */

import { CP0_REGISTERS, FP_CONDITION_FLAG_COUNT, FP_REGISTER_COUNT } from './core/coprocessor'
import { REGISTER_FILE_NAMES } from './core/registers'
import { RegisterFormat, type RegisterBank, type RegisterDescriptor } from '../contracts'

/** Tab ids are the ones the panel stored before it was shared. */
export const MIPS_REGISTER_BANKS: readonly RegisterBank[] = [
	{ id: 'registers', label: 'Registers' },
	{ id: 'coproc1', label: 'Coproc 1' },
	{ id: 'coproc0', label: 'Coproc 0' },
]

const INTEGER_GROUPS: ReadonlyArray<readonly [string, number]> = [
	['Zero/At', 2],
	['Return Values', 2],
	['Arguments', 4],
	['Temporaries', 8],
	['Saved', 8],
	['More Temps', 2],
	['Reserved', 2],
	['Pointers', 4],
	['Special', 3],
]

const ROLES: Readonly<Record<string, RegisterDescriptor['role']>> = { $sp: 'stackPointer', $ra: 'link', $pc: 'programCounter' }

/** Register-file order, which is also the order the groups list them in. */
const integerGroups = INTEGER_GROUPS.flatMap(([group, count]) => Array.from({ length: count }, () => group))

export const FLAG_ID = (index: number) => `cc${index}`
export const FP_ID = (index: number) => `$f${index}`

export const MIPS_REGISTERS: readonly RegisterDescriptor[] = [
	...REGISTER_FILE_NAMES.map((name, index): RegisterDescriptor => ({
		id: name,
		name,
		bank: 'registers',
		group: integerGroups[index],
		bits: 32,
		// $zero reads as zero however it is written.
		editable: index !== 0,
		aliases: index < 32 ? [`$${index}`] : [],
		role: ROLES[name],
	})),
	...Array.from({ length: FP_CONDITION_FLAG_COUNT }, (unused, index): RegisterDescriptor => ({
		id: FLAG_ID(index),
		name: FLAG_ID(index),
		bank: 'coproc1',
		group: 'Condition Flags',
		bits: 1,
		editable: false,
		format: RegisterFormat.FLAG,
		role: 'flags',
	})),
	...Array.from({ length: FP_REGISTER_COUNT }, (unused, index): RegisterDescriptor => ({
		id: FP_ID(index),
		name: FP_ID(index),
		bank: 'coproc1',
		group: 'Floating Point',
		bits: 32,
		editable: true,
		format: RegisterFormat.FLOAT,
		// Doubles occupy an even/odd pair.
		pairsWith: index % 2 === 0 ? FP_ID(index + 1) : undefined,
	})),
	...CP0_REGISTERS.map(({ name }): RegisterDescriptor => ({
		id: name,
		name,
		bank: 'coproc0',
		group: 'System Control',
		bits: 32,
		editable: true,
	})),
]
