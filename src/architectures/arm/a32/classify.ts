/**
 * What an A32 word is, regardless of machine state: its class, the registers
 * it reads and writes, and whether it loads, stores or transfers control.
 * Shared tools read this through an architecture's InstructionSet.
 */

import {
	ARCH_V2A, COND_AL, FORMAT_BLOCK, FORMAT_BLX_IMMEDIATE, FORMAT_BRANCH, FORMAT_BREAKPOINT, FORMAT_DATA, FORMAT_DIVIDE, FORMAT_EXCHANGE, FORMAT_EXCLUSIVE,
	FORMAT_EXTRA_TRANSFER, FORMAT_HINT, FORMAT_MEDIA, FORMAT_MULTIPLY, FORMAT_STATUS, FORMAT_SWAP, FORMAT_SWI, FORMAT_TRANSFER, FORMAT_WIDE_MOVE,
	R_LR, R_PC, formatOf, isMoveOp, isTestOp,
} from './isa'

export const A32_ALU = 1
export const A32_LOAD = 2
export const A32_STORE = 4
/** A conditional B or BL. */
export const A32_BRANCH = 8
/** An unconditional B or BL, or anything else that writes PC. */
export const A32_JUMP = 16
/** BL, or BLX. */
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

/** Classifies `word` under the encoding map of `arch`. */
export function classifyA32(word: number, arch = ARCH_V2A): A32Class {
	const format = formatOf(word, arch)
	const conditional = word >>> 28 !== COND_AL
	let flags: number
	let reads = 0
	let writes = 0
	const rn = (word >>> 16) & 15
	const rd = (word >>> 12) & 15
	const rm = word & 15
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
			// The long multiplies write RdLo too, and the accumulating ones read both.
			if (word & 0x00800000) {
				writes |= 1 << rd
				if (word & 0x00200000) reads |= 1 << rn
			}
			break
		case FORMAT_EXTRA_TRANSFER: {
			const load = (word & 0x00100000) !== 0
			const kind = (word >>> 5) & 3
			const double = !load && kind >= 2
			const loads = load || kind === 2
			const pair = double ? (1 << rd) | (1 << ((rd + 1) & 15)) : 1 << rd
			flags = loads ? A32_LOAD : A32_STORE
			reads = 1 << rn
			if (!(word & 0x00400000)) reads |= 1 << rm
			if (loads) writes |= pair
			else reads |= pair
			if (!(word & 0x01000000) || word & 0x00200000) writes |= 1 << rn
			break
		}
		case FORMAT_EXCLUSIVE:
			flags = word & 0x00100000 ? A32_LOAD : A32_STORE
			reads = (1 << rn) | (word & 0x00100000 ? 0 : 1 << rm)
			writes = 1 << rd
			break
		case FORMAT_STATUS:
			flags = A32_ALU
			if (!(word & 0x00200000)) writes = 1 << rd
			else if (!(word & 0x02000000)) reads = 1 << rm
			break
		case FORMAT_EXCHANGE:
			flags = conditional ? A32_BRANCH : A32_JUMP
			reads = 1 << rm
			if (word & 0x20) {
				flags |= A32_CALL
				writes = 1 << R_LR
			}
			return { format, flags, reads, writes }
		case FORMAT_BLX_IMMEDIATE:
			return { format, flags: A32_JUMP | A32_CALL, reads, writes: 1 << R_LR }
		case FORMAT_WIDE_MOVE:
			flags = A32_ALU
			// MOVT keeps the low half.
			if (word & 0x00400000) reads = 1 << rd
			writes = 1 << rd
			break
		case FORMAT_DIVIDE:
			flags = A32_ALU
			reads = (1 << rm) | (1 << ((word >>> 8) & 15))
			writes = 1 << rn
			break
		case FORMAT_MEDIA:
			flags = A32_ALU
			reads = 1 << rm
			writes = 1 << rd
			// BFI and BFC keep the rest of Rd; SXTAB and the like add Rn.
			if ((word & 0x0FE00070) === 0x07C00010) reads = (rm === R_PC ? 0 : 1 << rm) | (1 << rd)
			else if ((word & 0x0F800070) === 0x06800070 && rn !== R_PC) reads |= 1 << rn
			break
		case FORMAT_HINT:
			// Only PLD reads a register: its base and offset.
			flags = 0
			if ((word & 0x0F30F000) === 0x0510F000) reads = 1 << rn
			else if ((word & 0x0F30F010) === 0x0710F000) reads = (1 << rn) | (1 << rm)
			break
		case FORMAT_BREAKPOINT:
			flags = A32_SWI
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
