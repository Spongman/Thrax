/**
 * A32 (32-bit ARM instruction set) constants, as the ARM Architecture
 * Reference Manual numbers them.  Shared by every ARM target that runs A32
 * code: the 26-bit ARMv2a machine and ARMv8-A's AArch32 state.
 */

import { decodeVfp } from './vfp'

/** Architecture profiles: which instructions decode and assemble. */
export const ARCH_V2A = 0
export const ARCH_V8 = 1

/** Condition field, bits 31-28. */
export const COND_EQ = 0
export const COND_NE = 1
export const COND_CS = 2
export const COND_CC = 3
export const COND_MI = 4
export const COND_PL = 5
export const COND_VS = 6
export const COND_VC = 7
export const COND_HI = 8
export const COND_LS = 9
export const COND_GE = 10
export const COND_LT = 11
export const COND_GT = 12
export const COND_LE = 13
export const COND_AL = 14
/** Never, on ARMv2 and v3; unconditional space on later architectures. */
export const COND_NV = 15

/** Condition suffixes by field value; AL is written as nothing. */
export const COND_NAMES: readonly string[] = Object.freeze(['eq', 'ne', 'cs', 'cc', 'mi', 'pl', 'vs', 'vc', 'hi', 'ls', 'ge', 'lt', 'gt', 'le', '', 'nv'])

/** Every spelling an assembler accepts, `al`, `hs` and `lo` included. */
export const CONDITIONS: ReadonlyMap<string, number> = new Map([
	...COND_NAMES.map((name, index): [string, number] => [name, index]).filter(([name]) => name !== ''),
	['al', COND_AL], ['hs', COND_CS], ['lo', COND_CC],
])

/** Data-processing opcodes, bits 24-21. */
export const OP_AND = 0
export const OP_EOR = 1
export const OP_SUB = 2
export const OP_RSB = 3
export const OP_ADD = 4
export const OP_ADC = 5
export const OP_SBC = 6
export const OP_RSC = 7
export const OP_TST = 8
export const OP_TEQ = 9
export const OP_CMP = 10
export const OP_CMN = 11
export const OP_ORR = 12
export const OP_MOV = 13
export const OP_BIC = 14
export const OP_MVN = 15

export const DP_NAMES: readonly string[] = Object.freeze(['and', 'eor', 'sub', 'rsb', 'add', 'adc', 'sbc', 'rsc', 'tst', 'teq', 'cmp', 'cmn', 'orr', 'mov', 'bic', 'mvn'])

/** TST, TEQ, CMP and CMN only set flags. */
export const isTestOp = (op: number) => op >= OP_TST && op <= OP_CMN
/** MOV and MVN take no first operand. */
export const isMoveOp = (op: number) => op === OP_MOV || op === OP_MVN
/** Logical operations take C from the shifter and leave V alone. */
export const isLogicalOp = (op: number) => op === OP_AND || op === OP_EOR || op === OP_TST || op === OP_TEQ || op === OP_ORR || op === OP_MOV || op === OP_BIC || op === OP_MVN

/** Shift types, bits 6-5. */
export const SHIFT_LSL = 0
export const SHIFT_LSR = 1
export const SHIFT_ASR = 2
export const SHIFT_ROR = 3
/** ROR #0 in an encoding; never a field value. */
export const SHIFT_RRX = 4

export const SHIFT_NAMES: readonly string[] = Object.freeze(['lsl', 'lsr', 'asr', 'ror', 'rrx'])

/** Flag bits, where both the 26-bit R15 and the 32-bit CPSR hold them. */
export const FLAG_N = 0x80000000
export const FLAG_Z = 0x40000000
export const FLAG_C = 0x20000000
export const FLAG_V = 0x10000000
export const FLAGS_NZCV = 0xF0000000

export const R_SP = 13
export const R_LR = 14
export const R_PC = 15

/** Register names as disassembly writes them. */
export const REGISTER_NAMES: readonly string[] = Object.freeze(['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10', 'r11', 'r12', 'sp', 'lr', 'pc'])

/** Every register spelling an assembler accepts, APCS names included; keys are lower case. */
export const REGISTER_ALIASES: ReadonlyMap<string, number> = new Map([
	...Array.from({ length: 16 }, (_unused, index): [string, number] => [`r${index}`, index]),
	['a1', 0], ['a2', 1], ['a3', 2], ['a4', 3],
	['v1', 4], ['v2', 5], ['v3', 6], ['v4', 7], ['v5', 8], ['v6', 9], ['v7', 10], ['v8', 11],
	['sb', 9], ['sl', 10], ['fp', 11], ['ip', 12], ['sp', 13], ['lr', 14], ['pc', 15],
])

/** Instruction classes the decoder sorts words into. */
export const FORMAT_UNDEFINED = 0
export const FORMAT_DATA = 1
export const FORMAT_MULTIPLY = 2
export const FORMAT_SWAP = 3
export const FORMAT_TRANSFER = 4
export const FORMAT_BLOCK = 5
export const FORMAT_BRANCH = 6
export const FORMAT_SWI = 7
/** A coprocessor instruction; with no coprocessor attached it is undefined. */
export const FORMAT_COPROCESSOR = 8
// ARMv8 only from here.
/** LDRH STRH LDRSB LDRSH LDRD STRD. */
export const FORMAT_EXTRA_TRANSFER = 9
/** MRS and MSR. */
export const FORMAT_STATUS = 10
/** BX and BLX to a register. */
export const FORMAT_EXCHANGE = 11
/** CLZ, REV, RBIT, the extends and the bitfield instructions. */
export const FORMAT_MEDIA = 12
/** SDIV and UDIV. */
export const FORMAT_DIVIDE = 13
/** MOVW and MOVT. */
export const FORMAT_WIDE_MOVE = 14
/** NOP and the other hints, PLD and the barriers: nothing to do here. */
export const FORMAT_HINT = 15
export const FORMAT_BREAKPOINT = 16
/** LDREX and STREX. */
export const FORMAT_EXCLUSIVE = 17
/** BLX to a label, which always enters Thumb. */
export const FORMAT_BLX_IMMEDIATE = 18
/** A VFPv4-D16 instruction in coprocessor 10 or 11; see vfp.ts. */
export const FORMAT_VFP = 19

export const FORMAT_NAMES: readonly string[] = Object.freeze([
	'Undefined', 'Data processing', 'Multiply', 'Swap', 'Load/store', 'Load/store multiple', 'Branch', 'SWI', 'Coprocessor',
	'Load/store halfword or doubleword', 'Status register', 'Branch and exchange', 'Media', 'Divide', 'Move wide', 'Hint', 'Breakpoint',
	'Load/store exclusive', 'Branch with link and exchange (immediate)', 'Floating point (VFP)',
])

/** Sorts a word into its FORMAT_*, by the encoding map of `arch`. */
export function formatOf(word: number, arch = ARCH_V2A): number {
	if (arch === ARCH_V8) return formatOfV8(word)
	switch ((word >>> 25) & 7) {
		case 0:
			if ((word & 0x0FC000F0) === 0x00000090) return FORMAT_MULTIPLY
			if ((word & 0x0FB00FF0) === 0x01000090) return FORMAT_SWAP
			// Bit 7 and bit 4 both set is the multiply space; the rest is reserved here.
			if ((word & 0x90) === 0x90) return FORMAT_UNDEFINED
			// TST, TEQ, CMP and CMN without S are where ARMv3 put MRS and MSR.
			if ((word & 0x01900000) === 0x01000000) return FORMAT_UNDEFINED
			return FORMAT_DATA
		case 1:
			if ((word & 0x01900000) === 0x01000000) return FORMAT_UNDEFINED
			return FORMAT_DATA
		case 2: return FORMAT_TRANSFER
		case 3: return word & 0x10 ? FORMAT_UNDEFINED : FORMAT_TRANSFER
		case 4: return FORMAT_BLOCK
		case 5: return FORMAT_BRANCH
		case 6: return FORMAT_COPROCESSOR
		default: return word & 0x01000000 ? FORMAT_SWI : FORMAT_COPROCESSOR
	}
}

/** The ARMv8 AArch32 map (ARM DDI 0487, F4), for the instructions this library knows. */
function formatOfV8(word: number): number {
	if (word >>> 28 === COND_NV) return unconditionalFormat(word)
	switch ((word >>> 25) & 7) {
		case 0:
			if ((word & 0x0F900000) === 0x01000000 && (word & 0x90) !== 0x90) return miscellaneousFormat(word)
			if ((word & 0x0F0000F0) === 0x00000090) {
				// UMAAL (0100) is left out; 0101 and 0111 are unallocated.
				const op = (word >>> 20) & 15
				return op === 4 || op === 5 || op === 7 ? FORMAT_UNDEFINED : FORMAT_MULTIPLY
			}
			if ((word & 0x0F0000F0) === 0x01000090) {
				// SWP is gone from ARMv8; only the word exclusives are here.
				if ((word & 0x0FF00FFF) === 0x01900F9F || (word & 0x0FF00FF0) === 0x01800F90) return FORMAT_EXCLUSIVE
				return FORMAT_UNDEFINED
			}
			if ((word & 0x90) === 0x90) {
				// The unprivileged forms (P clear, W set) are left out.
				if ((word & 0x01200000) === 0x00200000) return FORMAT_UNDEFINED
				if (!(word & 0x00400000) && word & 0xF00) return FORMAT_UNDEFINED
				return FORMAT_EXTRA_TRANSFER
			}
			return FORMAT_DATA
		case 1:
			if ((word & 0x0FB00000) === 0x03000000) return FORMAT_WIDE_MOVE
			if ((word & 0x0FB00000) === 0x03200000) {
				if (word & 0x000F0000) return FORMAT_STATUS
				return (word & 0xFF) <= 5 || (word & 0xF0) === 0xF0 ? FORMAT_HINT : FORMAT_UNDEFINED
			}
			if ((word & 0x01900000) === 0x01000000) return FORMAT_UNDEFINED
			return FORMAT_DATA
		case 2: return FORMAT_TRANSFER
		case 3: return word & 0x10 ? mediaFormat(word) : FORMAT_TRANSFER
		case 4: return FORMAT_BLOCK
		case 5: return FORMAT_BRANCH
		case 6: return decodeVfp(word) ? FORMAT_VFP : FORMAT_COPROCESSOR
		default: return word & 0x01000000 ? FORMAT_SWI : decodeVfp(word) ? FORMAT_VFP : FORMAT_COPROCESSOR
	}
}

/** Where TST, TEQ, CMP and CMN have no S: MRS, MSR, BX, BLX, CLZ, BKPT. */
function miscellaneousFormat(word: number): number {
	const op = (word >>> 21) & 3
	switch ((word >>> 4) & 7) {
		case 0:
			// The banked forms (bit 9) are left out.
			if (word & 0x200) return FORMAT_UNDEFINED
			if (op & 1) return (word & 0xFFF0) === 0xF000 ? FORMAT_STATUS : FORMAT_UNDEFINED
			return (word & 0x000F0FFF) === 0x000F0000 ? FORMAT_STATUS : FORMAT_UNDEFINED
		case 1:
			if (op === 1 && (word & 0x000FFF00) === 0x000FFF00) return FORMAT_EXCHANGE
			if (op === 3 && (word & 0x000F0F00) === 0x000F0F00) return FORMAT_MEDIA
			return FORMAT_UNDEFINED
		case 3: return op === 1 && (word & 0x000FFF00) === 0x000FFF00 ? FORMAT_EXCHANGE : FORMAT_UNDEFINED
		case 7: return op === 1 && word >>> 28 === COND_AL ? FORMAT_BREAKPOINT : FORMAT_UNDEFINED
		default: return FORMAT_UNDEFINED
	}
}

/** Bits 27-25 011 with bit 4 set: extends, reversals, divides and bitfields. */
function mediaFormat(word: number): number {
	const op1 = (word >>> 20) & 31
	const op2 = (word >>> 5) & 7
	if ((op1 & 0x18) === 0x08) {
		const low = op1 & 7
		// SXTB SXTH UXTB UXTH and their A forms; the 16-bit pair forms are left out.
		if (op2 === 3 && (low === 2 || low === 3 || low === 6 || low === 7) && (word & 0x300) === 0) return FORMAT_MEDIA
		// REV REV16 RBIT REVSH.
		if ((op2 === 1 || op2 === 5) && (low === 3 || low === 7) && (word & 0x000F0F00) === 0x000F0F00) return FORMAT_MEDIA
		return FORMAT_UNDEFINED
	}
	if ((op1 === 0x11 || op1 === 0x13) && op2 === 0 && (word & 0xF000) === 0xF000) return FORMAT_DIVIDE
	// SBFX, UBFX, then BFC and BFI.
	if (((op1 & 0x1E) === 0x1A || (op1 & 0x1E) === 0x1E) && (op2 & 3) === 2) return FORMAT_MEDIA
	if ((op1 & 0x1E) === 0x1C && (op2 & 3) === 0) return FORMAT_MEDIA
	return FORMAT_UNDEFINED
}

/** Condition 1111: BLX to a label, PLD, and the barriers. */
function unconditionalFormat(word: number): number {
	if ((word & 0x0E000000) === 0x0A000000) return FORMAT_BLX_IMMEDIATE
	// PLD and PLDW, immediate and register.
	if ((word & 0x0F30F000) === 0x0510F000 || (word & 0x0F30F010) === 0x0710F000) return FORMAT_HINT
	// CLREX, DSB, DMB, ISB.
	const barrier = (word >>> 4) & 15
	if (((word & 0xFFFFFF00) >>> 0) === 0xF57FF000 && (barrier === 1 || barrier === 4 || barrier === 5 || barrier === 6)) return FORMAT_HINT
	return FORMAT_UNDEFINED
}

/** The 24-bit branch field as a signed byte offset from PC + 8. */
export const branchOffset = (word: number) => ((word << 8) >> 6)

/** Registers in a block transfer's list, lowest first. */
export function registerList(mask: number): number[] {
	const registers: number[] = []
	for (let index = 0; index < 16; index++) if (mask & (1 << index)) registers.push(index)
	return registers
}

export function popCount(mask: number): number {
	let count = 0
	for (let bits = mask & 0xFFFF; bits; bits &= bits - 1) count++
	return count
}

/**
 * The 12-bit immediate field for `value`, an 8-bit constant rotated right by
 * twice the 4-bit rotation, or -1 when no rotation fits.  The smallest
 * rotation wins, as assemblers choose.
 */
export function encodeImmediate(value: number): number {
	const unsigned = value >>> 0
	for (let rotate = 0; rotate < 16; rotate++) {
		const shift = rotate * 2
		const constant = shift === 0 ? unsigned : ((unsigned << shift) | (unsigned >>> (32 - shift))) >>> 0
		if (constant <= 0xFF) return (rotate << 8) | constant
	}
	return -1
}

/** The value a 12-bit immediate field stands for. */
export function decodeImmediate(field: number): number {
	const constant = field & 0xFF
	const shift = ((field >>> 8) & 0xF) * 2
	return shift === 0 ? constant : ((constant >>> shift) | (constant << (32 - shift))) >>> 0
}
