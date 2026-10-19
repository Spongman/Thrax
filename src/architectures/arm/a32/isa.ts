/**
 * A32 (32-bit ARM instruction set) constants, as the ARM Architecture
 * Reference Manual numbers them.  Shared by every ARM target that runs A32
 * code: the 26-bit ARMv2a machine now, an AArch32 one later.
 */

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

export const FORMAT_NAMES: readonly string[] = Object.freeze(['Undefined', 'Data processing', 'Multiply', 'Swap', 'Load/store', 'Load/store multiple', 'Branch', 'SWI', 'Coprocessor'])

/** Sorts a word into its FORMAT_*, by the ARMv2a encoding map. */
export function formatOf(word: number): number {
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
