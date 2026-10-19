/**
 * A32 disassembly in the divided (pre-UAL) syntax ARMv2 code is written in:
 * condition before the S, B or block mode, as in `addeqs` and `ldmeqfd`.
 * Branch targets are absolute; immediates are decimal below 256 and hex above.
 */

import {
	COND_NAMES, DP_NAMES, FORMAT_BLOCK, FORMAT_BRANCH, FORMAT_COPROCESSOR, FORMAT_DATA, FORMAT_MULTIPLY, FORMAT_SWAP, FORMAT_SWI, FORMAT_TRANSFER,
	R_PC, R_SP, REGISTER_NAMES, SHIFT_NAMES, branchOffset, decodeImmediate, formatOf, isMoveOp, isTestOp,
} from './isa'

const register = (index: number) => REGISTER_NAMES[index & 15]

export const hexAddress = (value: number) => `0x${(value >>> 0).toString(16).padStart(8, '0')}`

/** An immediate as disassembly writes it: small values in decimal. */
export function immediateText(value: number): string {
	const unsigned = value >>> 0
	return unsigned < 256 ? `#${unsigned}` : `#0x${unsigned.toString(16)}`
}

/** `{r0-r3, lr}`, with runs of three or more as ranges. */
export function registerListText(mask: number): string {
	const parts: string[] = []
	for (let index = 0; index < 16; index++) {
		if (!(mask & (1 << index))) continue
		let end = index
		while (end < 15 && mask & (1 << (end + 1))) end++
		if (end - index >= 2) {
			parts.push(`${register(index)}-${register(end)}`)
			index = end
		} else {
			parts.push(register(index))
		}
	}
	return `{${parts.join(', ')}}`
}

/** Operand 2 of a register form: `rm`, `rm, lsl #2`, `rm, lsr rs` or `rm, rrx`. */
function shiftedRegister(word: number): string {
	const rm = register(word & 15)
	const type = (word >>> 5) & 3
	if (word & 0x10) return `${rm}, ${SHIFT_NAMES[type]} ${register(word >>> 8)}`
	const amount = (word >>> 7) & 31
	if (amount === 0) {
		if (type === 0) return rm
		if (type === 3) return `${rm}, rrx`
		return `${rm}, ${SHIFT_NAMES[type]} #32`
	}
	return `${rm}, ${SHIFT_NAMES[type]} #${amount}`
}

/** Stack names when the base is SP, which is how push and pop read in ARMv2 code. */
const BLOCK_MODES = ['da', 'ia', 'db', 'ib']
const LOAD_STACK = ['fa', 'fd', 'ea', 'ed']
const STORE_STACK = ['ed', 'ea', 'fd', 'fa']

/** One instruction word at `address`, as text. */
export function disassembleA32(word: number, address: number): string {
	const cond = COND_NAMES[word >>> 28]
	switch (formatOf(word)) {
		case FORMAT_DATA: {
			const op = (word >>> 21) & 15
			const s = (word >>> 20) & 1
			const rd = (word >>> 12) & 15
			const rn = (word >>> 16) & 15
			const operand = word & 0x02000000 ? immediateText(decodeImmediate(word & 0xFFF)) : shiftedRegister(word)
			if (isTestOp(op)) {
				// Rd = PC writes the status bits: the P suffix.
				return `${DP_NAMES[op]}${cond}${rd === R_PC ? 'p' : ''} ${register(rn)}, ${operand}`
			}
			const suffix = `${cond}${s ? 's' : ''}`
			if (isMoveOp(op)) return `${DP_NAMES[op]}${suffix} ${register(rd)}, ${operand}`
			return `${DP_NAMES[op]}${suffix} ${register(rd)}, ${register(rn)}, ${operand}`
		}
		case FORMAT_MULTIPLY: {
			const accumulate = word & 0x00200000
			const suffix = `${cond}${word & 0x00100000 ? 's' : ''}`
			const operands = `${register(word >>> 16)}, ${register(word)}, ${register(word >>> 8)}`
			return accumulate ? `mla${suffix} ${operands}, ${register(word >>> 12)}` : `mul${suffix} ${operands}`
		}
		case FORMAT_SWAP:
			return `swp${cond}${word & 0x00400000 ? 'b' : ''} ${register(word >>> 12)}, ${register(word)}, [${register(word >>> 16)}]`
		case FORMAT_TRANSFER: {
			const load = word & 0x00100000
			const pre = word & 0x01000000
			const up = word & 0x00800000
			const writeback = word & 0x00200000
			const rn = (word >>> 16) & 15
			const mnemonic = `${load ? 'ldr' : 'str'}${cond}${word & 0x00400000 ? 'b' : ''}${!pre && writeback ? 't' : ''}`
			const rd = register(word >>> 12)
			let offset: string
			if (word & 0x02000000) {
				offset = `${up ? '' : '-'}${shiftedRegister(word)}`
			} else {
				const amount = word & 0xFFF
				if (rn === R_PC && pre && !writeback) {
					// PC-relative: the address it reaches is what a reader wants.
					const target = (address + 8 + (up ? amount : -amount)) >>> 0
					return `${mnemonic} ${rd}, [pc, #${up ? '' : '-'}${amount}]  ; ${hexAddress(target)}`
				}
				offset = amount === 0 && up ? '' : `#${up ? '' : '-'}${amount}`
			}
			if (!pre) return `${mnemonic} ${rd}, [${register(rn)}]${offset ? `, ${offset}` : ''}`
			return `${mnemonic} ${rd}, [${register(rn)}${offset ? `, ${offset}` : ''}]${writeback ? '!' : ''}`
		}
		case FORMAT_BLOCK: {
			const load = word & 0x00100000
			const rn = (word >>> 16) & 15
			const mode = (word >>> 23) & 3
			const name = rn === R_SP ? (load ? LOAD_STACK : STORE_STACK)[mode] : BLOCK_MODES[mode]
			return `${load ? 'ldm' : 'stm'}${cond}${name} ${register(rn)}${word & 0x00200000 ? '!' : ''}, ${registerListText(word & 0xFFFF)}${word & 0x00400000 ? '^' : ''}`
		}
		case FORMAT_BRANCH:
			return `b${word & 0x01000000 ? 'l' : ''}${cond} ${hexAddress(address + 8 + branchOffset(word))}`
		case FORMAT_SWI:
			return `swi${cond} 0x${(word & 0xFFFFFF).toString(16)}`
		case FORMAT_COPROCESSOR:
			return `.word 0x${(word >>> 0).toString(16).padStart(8, '0')}  ; coprocessor ${(word >>> 8) & 15}`
		default:
			return `.word 0x${(word >>> 0).toString(16).padStart(8, '0')}  ; undefined`
	}
}
