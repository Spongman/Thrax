/**
 * A32 disassembly in the divided (pre-UAL) syntax ARMv2 code is written in:
 * condition before the S, B or block mode, as in `addeqs` and `ldmeqfd`.
 * Branch targets are absolute; immediates are decimal below 256 and hex above.
 * ARMv8 code reads in unified (UAL) syntax instead: `addseq`, `ldrbeq`, `pop`.
 */

import {
	ARCH_V2A, ARCH_V8, COND_NAMES, DP_NAMES, FORMAT_BLOCK, FORMAT_BLX_IMMEDIATE, FORMAT_BRANCH, FORMAT_BREAKPOINT, FORMAT_COPROCESSOR,
	FORMAT_DATA, FORMAT_DIVIDE, FORMAT_EXCHANGE, FORMAT_EXCLUSIVE, FORMAT_EXTRA_TRANSFER, FORMAT_HINT, FORMAT_MEDIA, FORMAT_MULTIPLY, FORMAT_STATUS,
	FORMAT_SWAP, FORMAT_SWI, FORMAT_TRANSFER, FORMAT_WIDE_MOVE, OP_MOV, R_PC, R_SP, REGISTER_NAMES, SHIFT_NAMES, branchOffset, decodeImmediate,
	formatOf, isMoveOp, isTestOp,
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

/**
 * A load or store's address: `[rn, #-4]!`, `[rn], rm`, or a PC-relative one
 * with the address it reaches, which is what a reader wants.  `offsetRegister`
 * is the register operand's text, or null for the immediate `amount`.
 */
function addressText(address: number, rn: number, pre: number, up: number, writeback: number, offsetRegister: string | null, amount: number): string {
	let offset: string
	if (offsetRegister !== null) {
		offset = `${up ? '' : '-'}${offsetRegister}`
	} else {
		if (rn === R_PC && pre && !writeback) {
			const target = (address + 8 + (up ? amount : -amount)) >>> 0
			return `[pc, #${up ? '' : '-'}${amount}]  ; ${hexAddress(target)}`
		}
		offset = amount === 0 && up ? '' : `#${up ? '' : '-'}${amount}`
	}
	if (!pre) return `[${register(rn)}]${offset ? `, ${offset}` : ''}`
	return `[${register(rn)}${offset ? `, ${offset}` : ''}]${writeback ? '!' : ''}`
}

/** Stack names when the base is SP, which is how push and pop read in ARMv2 code. */
const BLOCK_MODES = ['da', 'ia', 'db', 'ib']
const LOAD_STACK = ['fa', 'fd', 'ea', 'ed']
const STORE_STACK = ['ed', 'ea', 'fd', 'fa']

/** One instruction word at `address`, as text, in the syntax of `arch`. */
export function disassembleA32(word: number, address: number, arch = ARCH_V2A): string {
	if (arch === ARCH_V8) return disassembleV8(word, address)
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
			return `${mnemonic} ${register(word >>> 12)}, ${addressText(address, rn, pre, up, writeback, word & 0x02000000 ? shiftedRegister(word) : null, word & 0xFFF)}`
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
			if ((word & 0x0F000010) === 0x0E000010)
				return `${word & 0x00100000 ? 'mrc' : 'mcr'}${cond} p${(word >>> 8) & 15}, ${(word >>> 21) & 7}, ${register(word >>> 12)}, c${(word >>> 16) & 15}, c${word & 15}, ${(word >>> 5) & 7}`
			return `.word 0x${(word >>> 0).toString(16).padStart(8, '0')}  ; coprocessor ${(word >>> 8) & 15}`
		default:
			return `.word 0x${(word >>> 0).toString(16).padStart(8, '0')}  ; undefined`
	}
}

const wordText = (word: number) => `.word 0x${(word >>> 0).toString(16).padStart(8, '0')}`

const UAL_BLOCK_MODES = ['da', '', 'db', 'ib']
const LONG_MULTIPLIES = ['umull', 'umlal', 'smull', 'smlal']
const EXTRA_LOADS = ['', 'h', 'sb', 'sh']
const HINTS = ['nop', 'yield', 'wfe', 'wfi', 'sev', 'sevl']
const BARRIERS: Record<number, string> = { 4: 'dsb', 5: 'dmb', 6: 'isb' }
const BARRIER_OPTIONS: Record<number, string> = { 15: 'sy', 14: 'st', 11: 'ish', 10: 'ishst', 7: 'nsh', 6: 'nshst', 3: 'osh', 2: 'oshst' }
const APSR_FIELDS: Record<number, string> = { 8: 'apsr_nzcvq', 4: 'apsr_g', 12: 'apsr_nzcvqg' }

/** The fields an MSR writes: the APSR names where they cover it, else `cpsr_fc` and the like. */
function psrFields(word: number): string {
	const mask = (word >>> 16) & 15
	const spsr = (word & 0x00400000) !== 0
	if (!spsr && APSR_FIELDS[mask]) return APSR_FIELDS[mask]
	const letters = ([[8, 'f'], [4, 's'], [2, 'x'], [1, 'c']] as const).filter(([bit]) => mask & bit).map(([, letter]) => letter).join('')
	return `${spsr ? 'spsr' : 'cpsr'}_${letters}`
}

/** One ARMv8 A32 word in UAL. */
function disassembleV8(word: number, address: number): string {
	const cond = COND_NAMES[word >>> 28]
	const rd = register(word >>> 12)
	const rn = register(word >>> 16)
	const rm = register(word)
	switch (formatOf(word, ARCH_V8)) {
		case FORMAT_DATA: {
			const op = (word >>> 21) & 15
			const s = word & 0x00100000 ? 's' : ''
			const immediate = (word & 0x02000000) !== 0
			const operand = immediate ? immediateText(decodeImmediate(word & 0xFFF)) : shiftedRegister(word)
			if (isTestOp(op)) return `${DP_NAMES[op]}${cond} ${rn}, ${operand}`
			if (op === OP_MOV && !immediate && (word & 0xFF0) !== 0) {
				// A shifted MOV reads as the shift it is.
				const type = (word >>> 5) & 3
				if (word & 0x10) return `${SHIFT_NAMES[type]}${s}${cond} ${rd}, ${rm}, ${register(word >>> 8)}`
				const amount = (word >>> 7) & 31
				if (type === 3 && amount === 0) return `rrx${s}${cond} ${rd}, ${rm}`
				return `${SHIFT_NAMES[type]}${s}${cond} ${rd}, ${rm}, #${amount === 0 ? 32 : amount}`
			}
			if (isMoveOp(op)) return `${DP_NAMES[op]}${s}${cond} ${rd}, ${operand}`
			return `${DP_NAMES[op]}${s}${cond} ${rd}, ${rn}, ${operand}`
		}
		case FORMAT_MULTIPLY: {
			const s = word & 0x00100000 ? 's' : ''
			const rs = register(word >>> 8)
			if (word & 0x00800000) return `${LONG_MULTIPLIES[(word >>> 21) & 3]}${s}${cond} ${rd}, ${rn}, ${rm}, ${rs}`
			switch ((word >>> 21) & 3) {
				case 0: return `mul${s}${cond} ${rn}, ${rm}, ${rs}`
				case 1: return `mla${s}${cond} ${rn}, ${rm}, ${rs}, ${rd}`
				default: return `mls${cond} ${rn}, ${rm}, ${rs}, ${rd}`
			}
		}
		case FORMAT_TRANSFER: {
			const pre = word & 0x01000000
			const writeback = word & 0x00200000
			const mnemonic = `${word & 0x00100000 ? 'ldr' : 'str'}${word & 0x00400000 ? 'b' : ''}${!pre && writeback ? 't' : ''}${cond}`
			const offset = word & 0x02000000 ? shiftedRegister(word) : null
			return `${mnemonic} ${rd}, ${addressText(address, (word >>> 16) & 15, pre, word & 0x00800000, writeback, offset, word & 0xFFF)}`
		}
		case FORMAT_EXTRA_TRANSFER: {
			const load = (word & 0x00100000) !== 0
			const kind = (word >>> 5) & 3
			// L clear with SH 10 is LDRD, with 11 STRD.
			const double = !load && kind >= 2
			const mnemonic = double ? (kind === 2 ? 'ldrd' : 'strd') : `${load ? 'ldr' : 'str'}${EXTRA_LOADS[kind]}`
			const registers = double ? `${rd}, ${register((word >>> 12) + 1)}` : rd
			const offset = word & 0x00400000 ? null : rm
			const amount = ((word >>> 4) & 0xF0) | (word & 15)
			return `${mnemonic}${cond} ${registers}, ${addressText(address, (word >>> 16) & 15, word & 0x01000000, word & 0x00800000, word & 0x00200000, offset, amount)}`
		}
		case FORMAT_BLOCK: {
			const load = word & 0x00100000
			const mode = (word >>> 23) & 3
			const writeback = word & 0x00200000
			const list = registerListText(word & 0xFFFF)
			const psr = word & 0x00400000 ? '^' : ''
			// LDMIA SP! and STMDB SP! are POP and PUSH.
			if (((word >>> 16) & 15) === R_SP && writeback && !psr && mode === (load ? 1 : 2)) return `${load ? 'pop' : 'push'}${cond} ${list}`
			return `${load ? 'ldm' : 'stm'}${UAL_BLOCK_MODES[mode]}${cond} ${rn}${writeback ? '!' : ''}, ${list}${psr}`
		}
		case FORMAT_BRANCH:
			return `b${word & 0x01000000 ? 'l' : ''}${cond} ${hexAddress(address + 8 + branchOffset(word))}`
		case FORMAT_BLX_IMMEDIATE:
			return `blx ${hexAddress(address + 8 + branchOffset(word) + ((word >>> 23) & 2))}`
		case FORMAT_SWI:
			return `svc${cond} ${immediateText(word & 0xFFFFFF)}`
		case FORMAT_STATUS:
			if (!(word & 0x00200000)) return `mrs${cond} ${rd}, ${word & 0x00400000 ? 'spsr' : 'apsr'}`
			return `msr${cond} ${psrFields(word)}, ${word & 0x02000000 ? immediateText(decodeImmediate(word & 0xFFF)) : rm}`
		case FORMAT_EXCHANGE:
			return `${word & 0x20 ? 'blx' : 'bx'}${cond} ${rm}`
		case FORMAT_DIVIDE:
			return `${word & 0x00200000 ? 'udiv' : 'sdiv'}${cond} ${rn}, ${rm}, ${register(word >>> 8)}`
		case FORMAT_WIDE_MOVE:
			return `${word & 0x00400000 ? 'movt' : 'movw'}${cond} ${rd}, ${immediateText(((word >>> 4) & 0xF000) | (word & 0xFFF))}`
		case FORMAT_MEDIA:
			return mediaText(word, cond, rd, rn, rm)
		case FORMAT_HINT:
			return hintText(word, address, cond)
		case FORMAT_BREAKPOINT:
			return `bkpt ${immediateText(((word >>> 4) & 0xFFF0) | (word & 15))}`
		case FORMAT_EXCLUSIVE:
			return word & 0x00100000 ? `ldrex${cond} ${rd}, [${rn}]` : `strex${cond} ${rd}, ${rm}, [${rn}]`
		case FORMAT_COPROCESSOR:
			return `${wordText(word)}  ; coprocessor ${(word >>> 8) & 15}`
		default:
			if (((word & 0xFFF000F0) >>> 0) === 0xE7F000F0) return `udf ${immediateText(((word >>> 4) & 0xFFF0) | (word & 15))}`
			return `${wordText(word)}  ; undefined`
	}
}

/** The hints, the barriers and PLD. */
function hintText(word: number, address: number, cond: string): string {
	if (word >>> 28 !== 15) {
		const hint = word & 0xFF
		return hint < HINTS.length ? `${HINTS[hint]}${cond}` : `dbg${cond} #${hint & 15}`
	}
	if (((word & 0xFFFFFF00) >>> 0) === 0xF57FF000) {
		const option = word & 15
		const barrier = BARRIERS[(word >>> 4) & 15]
		if (!barrier) return 'clrex'
		if (barrier === 'isb') return option === 15 ? 'isb' : `isb #${option}`
		return `${barrier} ${BARRIER_OPTIONS[option] ?? `#${option}`}`
	}
	const offset = word & 0x02000000 ? shiftedRegister(word) : null
	return `${word & 0x00400000 ? 'pld' : 'pldw'} ${addressText(address, (word >>> 16) & 15, 1, word & 0x00800000, 0, offset, word & 0xFFF)}`
}

const EXTEND_NAMES: Record<number, string> = { 2: 'sxtb', 3: 'sxth', 6: 'uxtb', 7: 'uxth' }

/** CLZ, the reversals, the extends and the bitfield instructions. */
function mediaText(word: number, cond: string, rd: string, rn: string, rm: string): string {
	if ((word & 0x0FF000F0) === 0x01600010) return `clz${cond} ${rd}, ${rm}`
	const op1 = (word >>> 20) & 31
	const op2 = (word >>> 5) & 7
	if ((op1 & 0x18) === 0x08) {
		if (op2 === 3) {
			const name = EXTEND_NAMES[op1 & 7]
			const rotation = ((word >>> 10) & 3) * 8
			const ror = rotation ? `, ror #${rotation}` : ''
			// Rn 1111 is the plain extend; any other adds Rn: SXTAB and the like.
			if (((word >>> 16) & 15) === R_PC) return `${name}${cond} ${rd}, ${rm}${ror}`
			return `${name.slice(0, 3)}a${name.slice(3)}${cond} ${rd}, ${rn}, ${rm}${ror}`
		}
		const name = op1 & 4 ? (op2 === 1 ? 'rbit' : 'revsh') : (op2 === 1 ? 'rev' : 'rev16')
		return `${name}${cond} ${rd}, ${rm}`
	}
	const lsb = (word >>> 7) & 31
	const high = (word >>> 16) & 31
	if ((op1 & 0x1E) === 0x1C) {
		const field = `#${lsb}, #${high - lsb + 1}`
		return (word & 15) === R_PC ? `bfc${cond} ${rd}, ${field}` : `bfi${cond} ${rd}, ${rm}, ${field}`
	}
	return `${op1 & 4 ? 'ubfx' : 'sbfx'}${cond} ${rd}, ${rm}, #${lsb}, #${high + 1}`
}
