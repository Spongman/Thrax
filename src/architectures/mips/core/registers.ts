/**
 * General-purpose register naming.
 *
 * MIPS assembly names the same register either symbolically (`$t0`) or by
 * number (`$8`), so both the assembler and the simulator resolve names here.
 */

/** Canonical names, indexed by register number. */
export const REGISTER_NAMES = [
	'$zero', '$at', '$v0', '$v1', '$a0', '$a1', '$a2', '$a3',
	'$t0', '$t1', '$t2', '$t3', '$t4', '$t5', '$t6', '$t7',
	'$s0', '$s1', '$s2', '$s3', '$s4', '$s5', '$s6', '$s7',
	'$t8', '$t9', '$k0', '$k1', '$gp', '$sp', '$fp', '$ra',
]

/**
 * Every name the register file is keyed by, in a fixed order.  A history entry
 * names a register by its place here rather than by its name, since a number
 * fits a column and a string does not.
 */
export const REGISTER_FILE_NAMES = [...REGISTER_NAMES, '$pc', '$hi', '$lo']

const FILE_INDEX = new Map(REGISTER_FILE_NAMES.map((name, index) => [name, index]))

/** Where `name` sits in the register file, or -1 when it is not one of them. */
export function registerFileIndex(name: string): number {
	return FILE_INDEX.get(name) ?? -1
}

const NUMBERS: Record<string, number> = Object.fromEntries([
	...REGISTER_NAMES.map((name, number) => [name, number]),
	...REGISTER_NAMES.map((_name, number) => [`$${number}`, number]),
])

/** The register number for `name`, or null when it names no register. */
export function registerNumber(name: string): number | null {
	const number = NUMBERS[name.toLowerCase()]
	return number === undefined ? null : number
}
