/**
 * What an A32 word is, regardless of machine state: its class, the registers
 * it reads and writes, and whether it loads, stores or transfers control.
 * Shared tools read this through an architecture's InstructionSet.
 */

import {
	COND_AL, FORMAT_BLOCK, FORMAT_BRANCH, FORMAT_DATA, FORMAT_MULTIPLY, FORMAT_SWAP, FORMAT_SWI, FORMAT_TRANSFER, R_LR, R_PC, formatOf, isMoveOp, isTestOp,
} from './isa'

export const A32_ALU = 1
export const A32_LOAD = 2
export const A32_STORE = 4
/** A conditional B or BL. */
export const A32_BRANCH = 8
/** An unconditional B or BL, or anything else that writes PC. */
export const A32_JUMP = 16
/** BL. */
export const A32_CALL = 32
export const A32_SWI = 64
export const A32_UNDEFINED = 128

export interface A32Class {
	format: number
	/** A32_* bits. */
	flags: number
	/** Registers read and written, as bit masks over R0-R15. */
	reads: number
	writes: number
}

/** Classifies `word`. */
export function classifyA32(word: number): A32Class {
	const format = formatOf(word)
	const conditional = word >>> 28 !== COND_AL
	let flags: number
	let reads = 0
	let writes = 0
	const rn = (word >>> 16) & 15
	const rd = (word >>> 12) & 15
	switch (format) {
		case FORMAT_DATA: {
			const op = (word >>> 21) & 15
			flags = A32_ALU
			if (!isMoveOp(op)) reads |= 1 << rn
			if (!(word & 0x02000000)) {
				reads |= 1 << (word & 15)
				if (word & 0x10) reads |= 1 << ((word >>> 8) & 15)
			}
			if (!isTestOp(op)) writes |= 1 << rd
			break
		}
		case FORMAT_MULTIPLY:
			flags = A32_ALU
			reads = (1 << (word & 15)) | (1 << ((word >>> 8) & 15)) | (word & 0x00200000 ? 1 << rd : 0)
			writes = 1 << rn
			break
		case FORMAT_SWAP:
			flags = A32_LOAD | A32_STORE
			reads = (1 << rn) | (1 << (word & 15))
			writes = 1 << rd
			break
		case FORMAT_TRANSFER: {
			const load = (word & 0x00100000) !== 0
			flags = load ? A32_LOAD : A32_STORE
			reads = 1 << rn
			if (word & 0x02000000) reads |= 1 << (word & 15)
			if (!load) reads |= 1 << rd
			else writes |= 1 << rd
			if (!(word & 0x01000000) || word & 0x00200000) writes |= 1 << rn
			break
		}
		case FORMAT_BLOCK: {
			const load = (word & 0x00100000) !== 0
			flags = load ? A32_LOAD : A32_STORE
			reads = 1 << rn
			if (load) writes = word & 0xFFFF
			else reads |= word & 0xFFFF
			if (word & 0x00200000) writes |= 1 << rn
			break
		}
		case FORMAT_BRANCH:
			flags = conditional ? A32_BRANCH : A32_JUMP
			if (word & 0x01000000) {
				flags |= A32_CALL
				writes = 1 << R_LR
			}
			return { format, flags, reads, writes }
		case FORMAT_SWI:
			flags = A32_SWI
			break
		default:
			flags = A32_UNDEFINED
	}
	if (writes & (1 << R_PC)) flags |= A32_JUMP
	return { format, flags, reads, writes }
}
