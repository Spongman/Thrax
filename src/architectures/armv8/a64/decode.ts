/**
 * A64 decoding of the integer subset THRAX runs: one plain record per word,
 * shared by the CPU, the disassembler and the tools, and cached by word.
 *
 * Field meanings follow the reference manual's encoding diagrams; `imm` is the
 * operand already worked out (a bitmask, a shifted imm12, a byte offset).
 */

import { DOUBLE, expandImm8, SINGLE } from '../shared/fp'
import { decodeBitMasks, logicalImmediate } from './isa'

export class Op {
	static readonly UNDEFINED = 0
	/** ADD/ADDS/SUB/SUBS (immediate): `sub` and `setFlags` say which. */
	static readonly ADDSUB_IMM = 1
	/** AND/ORR/EOR/ANDS (immediate): `opc`. */
	static readonly LOGIC_IMM = 2
	/** MOVN/MOVZ/MOVK: `opc` 0, 2, 3; `imm` is imm16, `amount` the shift. */
	static readonly MOVE_WIDE = 3
	/** SBFM/BFM/UBFM: `opc` 0, 1, 2; `immr`, `imms`. */
	static readonly BITFIELD = 4
	static readonly EXTR = 5
	/** ADR/ADRP: `imm` is the offset from the PC or its page. */
	static readonly ADR = 6
	static readonly ADRP = 7
	static readonly B = 8
	static readonly BL = 9
	static readonly B_COND = 10
	/** CBZ/CBNZ: `opc` 1 for CBNZ. */
	static readonly CB = 11
	/** TBZ/TBNZ: `opc` 1 for TBNZ, `amount` the bit. */
	static readonly TB = 12
	static readonly BR = 13
	static readonly BLR = 14
	static readonly RET = 15
	static readonly SVC = 16
	static readonly HLT = 17
	static readonly BRK = 18
	static readonly NOP = 19
	/** AND/BIC/ORR/ORN/EOR/EON/ANDS/BICS (shifted register): `opc`, `invert`. */
	static readonly LOGIC_REG = 20
	/** ADD/ADDS/SUB/SUBS (shifted register). */
	static readonly ADDSUB_SHIFT = 21
	/** ADD/ADDS/SUB/SUBS (extended register): `shift` is the extend option. */
	static readonly ADDSUB_EXT = 22
	/** ADC/ADCS/SBC/SBCS. */
	static readonly ADC = 23
	/** CCMN/CCMP: `sub` for CCMP, `immediate` when Rm is a 5-bit immediate, `imm` the nzcv. */
	static readonly CCMP = 24
	/** CSEL/CSINC/CSINV/CSNEG: `opc` 0 to 3. */
	static readonly CSEL = 25
	/** MADD/MSUB/SMADDL/SMSUBL/UMADDL/UMSUBL/SMULH/UMULH: `opc`. */
	static readonly DP3 = 26
	/** UDIV/SDIV/LSLV/LSRV/ASRV/RORV: `opc` the opcode field. */
	static readonly DP2 = 27
	/** RBIT/REV16/REV32/REV/CLZ/CLS: `opc` the opcode field. */
	static readonly DP1 = 28
	/** Loads and stores of one register; `mode` says how the address forms. */
	static readonly LOAD_STORE = 29
	/** LDR (literal): `imm` the offset. */
	static readonly LOAD_LITERAL = 30
	/** LDP/STP/LDPSW. */
	static readonly LOAD_STORE_PAIR = 31
	// Scalar floating point: `size` is the operand bytes, 4 (S) or 8 (D).
	/** FMOV/FABS/FNEG/FSQRT/FCVT/FRINT*: `opc` the opcode field. */
	static readonly FP_DP1 = 32
	/** FMUL/FDIV/FADD/FSUB/FMAX/FMIN/FMAXNM/FMINNM/FNMUL: `opc`. */
	static readonly FP_DP2 = 33
	/** FMADD/FMSUB/FNMADD/FNMSUB: `opc` is o1:o0. */
	static readonly FP_DP3 = 34
	/** FCMP/FCMPE: `opc` bit 0 compares with zero, bit 1 signals. */
	static readonly FP_CMP = 35
	/** FCCMP/FCCMPE: `cond`, `imm` the nzcv, `opc` 1 for FCCMPE. */
	static readonly FP_CCMP = 36
	static readonly FP_CSEL = 37
	/** FMOV (immediate): `imm` the expanded bits, `amount` the imm8. */
	static readonly FP_IMM = 38
	/** FCVT[NPMZA][SU], SCVTF, UCVTF, FMOV (general): `shift` rmode, `opc` opcode, `sf` the integer width. */
	static readonly FP_INT = 39
	/** FCVTZ[SU], [SU]CVTF with fraction bits: `amount` fbits. */
	static readonly FP_FIXED = 40
	/** MRS and MSR (register): `imm` the system register, o0:op1:CRn:CRm:op2. */
	static readonly MRS = 41
	static readonly MSR = 42
}

/** System registers MRS and MSR reach, as o0:op1:CRn:CRm:op2. */
export const SYSREG_NZCV = 0x5A10
export const SYSREG_FPCR = 0x5A20
export const SYSREG_FPSR = 0x5A21
export const SYSREG_NAMES: Readonly<Record<number, string>> = { [SYSREG_NZCV]: 'nzcv', [SYSREG_FPCR]: 'fpcr', [SYSREG_FPSR]: 'fpsr' }

/** FP_DP1 opcodes. */
export const FP1_FMOV = 0
export const FP1_FABS = 1
export const FP1_FNEG = 2
export const FP1_FSQRT = 3
export const FP1_FCVT_S = 4
export const FP1_FCVT_D = 5
export const FP1_FRINTN = 8
export const FP1_FRINTP = 9
export const FP1_FRINTM = 10
export const FP1_FRINTZ = 11
export const FP1_FRINTA = 12
export const FP1_FRINTX = 14
export const FP1_FRINTI = 15

/** FP_DP2 opcodes. */
export const FP2_FMUL = 0
export const FP2_FDIV = 1
export const FP2_FADD = 2
export const FP2_FSUB = 3
export const FP2_FMAX = 4
export const FP2_FMIN = 5
export const FP2_FMAXNM = 6
export const FP2_FMINNM = 7
export const FP2_FNMUL = 8

/** FP_INT opcodes; rmode picks N, P, M or Z for the first two. */
export const FPI_FCVTS = 0
export const FPI_FCVTU = 1
export const FPI_SCVTF = 2
export const FPI_UCVTF = 3
export const FPI_FCVTAS = 4
export const FPI_FCVTAU = 5
/** FMOV from FP to general. */
export const FPI_FMOV_TO = 6
/** FMOV from general to FP. */
export const FPI_FMOV_FROM = 7

/** DP3 operations. */
export const DP3_MADD = 0
export const DP3_MSUB = 1
export const DP3_SMADDL = 2
export const DP3_SMSUBL = 3
export const DP3_UMADDL = 4
export const DP3_UMSUBL = 5
export const DP3_SMULH = 6
export const DP3_UMULH = 7

/** DP2 opcodes. */
export const DP2_UDIV = 2
export const DP2_SDIV = 3
export const DP2_LSLV = 8
export const DP2_LSRV = 9
export const DP2_ASRV = 10
export const DP2_RORV = 11

/** DP1 opcodes; REV is 2 in 32 bits and 3 in 64, where 2 is REV32. */
export const DP1_RBIT = 0
export const DP1_REV16 = 1
export const DP1_REV32 = 2
export const DP1_REV = 3
export const DP1_CLZ = 4
export const DP1_CLS = 5

/** How a load or store forms its address. */
export const MODE_OFFSET = 0
export const MODE_PRE = 1
export const MODE_POST = 2
/** Register offset: `rm`, extended by `shift` and scaled when `amount` is 1. */
export const MODE_REGISTER = 3
/** LDUR/STUR and friends: a 9-bit offset, unscaled, no writeback. */
export const MODE_UNSCALED = 4

/** What a load or store does with its data. */
export const ACCESS_STORE = 0
/** Load, zero-extended into the register. */
export const ACCESS_LOAD = 1
/** Load, sign-extended to 64 bits. */
export const ACCESS_SIGNED64 = 2
/** Load, sign-extended to 32 bits and zero-extended above. */
export const ACCESS_SIGNED32 = 3

export interface A64Instruction {
	readonly op: number
	readonly word: number
	/** A 64-bit operation, so its registers are X rather than W. */
	readonly sf: boolean
	readonly rd: number
	readonly rn: number
	readonly rm: number
	/** Ra of DP3; Rt2 of a pair. */
	readonly ra: number
	readonly opc: number
	readonly setFlags: boolean
	readonly sub: boolean
	readonly invert: boolean
	readonly immediate: boolean
	readonly imm: bigint
	/** Shift type, or extend option. */
	readonly shift: number
	readonly amount: number
	readonly cond: number
	readonly immr: number
	readonly imms: number
	/** Bitfield masks, for BITFIELD. */
	readonly wmask: bigint
	readonly tmask: bigint
	/** Bytes a load or store moves, per register. */
	readonly size: number
	readonly access: number
	readonly mode: number
	/** A load or store of SIMD&FP registers: B, H, S, D or Q by `size`. */
	readonly fp: boolean
}

const NONE: A64Instruction = Object.freeze({
	op: Op.UNDEFINED, word: 0, sf: false, rd: 0, rn: 0, rm: 0, ra: 0, opc: 0, setFlags: false, sub: false, invert: false, immediate: false,
	imm: 0n, shift: 0, amount: 0, cond: 0, immr: 0, imms: 0, wmask: 0n, tmask: 0n, size: 0, access: 0, mode: 0, fp: false,
})

const signExtend = (value: number, bits: number) => (value << (32 - bits)) >> (32 - bits)

function make(word: number, op: number, fields: Partial<A64Instruction>): A64Instruction {
	return Object.freeze({ ...NONE, word, op, rd: word & 31, rn: (word >>> 5) & 31, rm: (word >>> 16) & 31, ...fields })
}

const undefinedOf = (word: number) => make(word, Op.UNDEFINED, {})

function decodeDataImmediate(word: number): A64Instruction {
	const sf = (word >>> 31) === 1
	const width = sf ? 64 : 32
	switch ((word >>> 23) & 7) {
		case 0: case 1: {
			const immlo = (word >>> 29) & 3
			const immhi = signExtend((word >>> 5) & 0x7FFFF, 19)
			const offset = immhi * 4 + immlo
			if (word >>> 31) return make(word, Op.ADRP, { sf: true, imm: BigInt(offset) * 4096n })
			return make(word, Op.ADR, { sf: true, imm: BigInt(offset) })
		}
		case 2: {
			if ((word >>> 22) & 2) return undefinedOf(word)
			const shift12 = (word >>> 22) & 1
			const imm12 = BigInt((word >>> 10) & 0xFFF)
			return make(word, Op.ADDSUB_IMM, { sf, sub: ((word >>> 30) & 1) === 1, setFlags: ((word >>> 29) & 1) === 1, imm: shift12 ? imm12 << 12n : imm12, amount: shift12 * 12 })
		}
		case 4: {
			const n = (word >>> 22) & 1
			const immr = (word >>> 16) & 63
			const imms = (word >>> 10) & 63
			const value = logicalImmediate(n, imms, immr, width)
			if (value === null) return undefinedOf(word)
			return make(word, Op.LOGIC_IMM, { sf, opc: (word >>> 29) & 3, imm: value, immr, imms, setFlags: ((word >>> 29) & 3) === 3 })
		}
		case 5: {
			const opc = (word >>> 29) & 3
			const hw = (word >>> 21) & 3
			if (opc === 1 || (!sf && hw > 1)) return undefinedOf(word)
			return make(word, Op.MOVE_WIDE, { sf, opc, imm: BigInt((word >>> 5) & 0xFFFF), amount: hw * 16 })
		}
		case 6: {
			const opc = (word >>> 29) & 3
			const n = (word >>> 22) & 1
			const immr = (word >>> 16) & 63
			const imms = (word >>> 10) & 63
			if (opc === 3 || n !== (sf ? 1 : 0) || (!sf && (immr > 31 || imms > 31))) return undefinedOf(word)
			const masks = decodeBitMasks(n, imms, immr, false, width)
			if (!masks) return undefinedOf(word)
			return make(word, Op.BITFIELD, { sf, opc, immr, imms, wmask: masks.wmask, tmask: masks.tmask })
		}
		case 7: {
			const n = (word >>> 22) & 1
			const imms = (word >>> 10) & 63
			if (((word >>> 29) & 3) !== 0 || ((word >>> 21) & 1) || n !== (sf ? 1 : 0) || (!sf && imms > 31)) return undefinedOf(word)
			return make(word, Op.EXTR, { sf, imms, amount: imms })
		}
	}
	return undefinedOf(word)
}

function decodeBranchSystem(word: number): A64Instruction {
	if ((word & 0x7C000000) === 0x14000000) {
		const offset = BigInt(signExtend(word & 0x3FFFFFF, 26) * 4)
		return make(word, word >>> 31 ? Op.BL : Op.B, { imm: offset })
	}
	if ((word & 0xFF000010) === 0x54000000) {
		return make(word, Op.B_COND, { cond: word & 15, imm: BigInt(signExtend((word >>> 5) & 0x7FFFF, 19) * 4) })
	}
	if ((word & 0x7E000000) === 0x34000000) {
		return make(word, Op.CB, { sf: (word >>> 31) === 1, opc: (word >>> 24) & 1, imm: BigInt(signExtend((word >>> 5) & 0x7FFFF, 19) * 4) })
	}
	if ((word & 0x7E000000) === 0x36000000) {
		const bit = ((word >>> 31) << 5) | ((word >>> 19) & 31)
		return make(word, Op.TB, { sf: bit > 31, opc: (word >>> 24) & 1, amount: bit, imm: BigInt(signExtend((word >>> 5) & 0x3FFF, 14) * 4) })
	}
	if (((word & 0xFFE0001F) >>> 0) === 0xD4000001) return make(word, Op.SVC, { imm: BigInt((word >>> 5) & 0xFFFF) })
	if (((word & 0xFFE0001F) >>> 0) === 0xD4400000) return make(word, Op.HLT, { imm: BigInt((word >>> 5) & 0xFFFF) })
	if (((word & 0xFFE0001F) >>> 0) === 0xD4200000) return make(word, Op.BRK, { imm: BigInt((word >>> 5) & 0xFFFF) })
	// Hints: NOP and the rest, which do nothing here.
	if (((word & 0xFFFFF01F) >>> 0) === 0xD503201F) return make(word, Op.NOP, { imm: BigInt((word >>> 5) & 0x7F) })
	// MRS and MSR (register) of the system registers above.
	if (((word & 0xFFD00000) >>> 0) === 0xD5100000) {
		const sysreg = (word >>> 5) & 0x7FFF
		if (!SYSREG_NAMES[sysreg]) return undefinedOf(word)
		return make(word, (word >>> 21) & 1 ? Op.MRS : Op.MSR, { imm: BigInt(sysreg) })
	}
	if (((word & 0xFFFFFC1F) >>> 0) === 0xD61F0000) return make(word, Op.BR, {})
	if (((word & 0xFFFFFC1F) >>> 0) === 0xD63F0000) return make(word, Op.BLR, {})
	if (((word & 0xFFFFFC1F) >>> 0) === 0xD65F0000) return make(word, Op.RET, {})
	return undefinedOf(word)
}

function decodeDataRegister(word: number): A64Instruction {
	const sf = (word >>> 31) === 1
	const op28 = (word >>> 21) & 0xFF
	const rest = { sf, setFlags: ((word >>> 29) & 1) === 1, sub: ((word >>> 30) & 1) === 1 }
	if ((word & 0x1F000000) === 0x0A000000) {
		const amount = (word >>> 10) & 63
		if (!sf && amount > 31) return undefinedOf(word)
		const opc = (word >>> 29) & 3
		return make(word, Op.LOGIC_REG, { sf, opc, invert: ((word >>> 21) & 1) === 1, shift: (word >>> 22) & 3, amount, setFlags: opc === 3 })
	}
	if ((word & 0x1F200000) === 0x0B000000) {
		const shift = (word >>> 22) & 3
		const amount = (word >>> 10) & 63
		if (shift === 3 || (!sf && amount > 31)) return undefinedOf(word)
		return make(word, Op.ADDSUB_SHIFT, { ...rest, shift, amount })
	}
	if ((word & 0x1F200000) === 0x0B200000) {
		const amount = (word >>> 10) & 7
		if ((word >>> 22) & 3 || amount > 4) return undefinedOf(word)
		return make(word, Op.ADDSUB_EXT, { ...rest, shift: (word >>> 13) & 7, amount })
	}
	if (op28 === 0xD0) {
		if ((word >>> 10) & 63) return undefinedOf(word)
		return make(word, Op.ADC, rest)
	}
	if (op28 === 0xD2) {
		if ((word & 0x20000410) !== 0x20000000) return undefinedOf(word)
		const immediate = ((word >>> 11) & 1) === 1
		return make(word, Op.CCMP, { sf, sub: rest.sub, immediate, cond: (word >>> 12) & 15, imm: BigInt(word & 15), amount: (word >>> 16) & 31 })
	}
	if (op28 === 0xD4) {
		if ((word >>> 29) & 1 || (word >>> 11) & 1) return undefinedOf(word)
		return make(word, Op.CSEL, { sf, opc: (((word >>> 30) & 1) << 1) | ((word >>> 10) & 1), cond: (word >>> 12) & 15 })
	}
	if (op28 === 0xD6) {
		const opcode = (word >>> 10) & 63
		if ((word >>> 29) & 1) return undefinedOf(word)
		if ((word >>> 30) & 1) {
			if ((word >>> 16) & 31 || opcode > DP1_CLS || (!sf && opcode === DP1_REV)) return undefinedOf(word)
			// REV of a W register is the REV32 opcode.
			return make(word, Op.DP1, { sf, opc: !sf && opcode === DP1_REV32 ? DP1_REV : opcode })
		}
		if (![DP2_UDIV, DP2_SDIV, DP2_LSLV, DP2_LSRV, DP2_ASRV, DP2_RORV].includes(opcode)) return undefinedOf(word)
		return make(word, Op.DP2, { sf, opc: opcode })
	}
	if ((op28 & 0xF8) === 0xD8) {
		if ((word >>> 29) & 3) return undefinedOf(word)
		const op31 = (word >>> 21) & 7
		const o0 = (word >>> 15) & 1
		const ra = (word >>> 10) & 31
		let opc: number
		switch (op31) {
			case 0: opc = o0 ? DP3_MSUB : DP3_MADD; break
			case 1: opc = o0 ? DP3_SMSUBL : DP3_SMADDL; break
			case 5: opc = o0 ? DP3_UMSUBL : DP3_UMADDL; break
			case 2: opc = DP3_SMULH; break
			case 6: opc = DP3_UMULH; break
			default: return undefinedOf(word)
		}
		if (opc >= DP3_SMADDL && !sf) return undefinedOf(word)
		if ((opc === DP3_SMULH || opc === DP3_UMULH) && (o0 || ra !== 31)) return undefinedOf(word)
		return make(word, Op.DP3, { sf, opc, ra })
	}
	return undefinedOf(word)
}

function decodeLoadStore(word: number): A64Instruction {
	if ((word >>> 26) & 1) return decodeLoadStoreFp(word)
	// LDR (literal): W, X and LDRSW.
	if ((word & 0x3B000000) === 0x18000000) {
		if ((word >>> 26) & 1) return undefinedOf(word)
		const opc = word >>> 30
		if (opc === 3) return undefinedOf(word)
		const imm = BigInt(signExtend((word >>> 5) & 0x7FFFF, 19) * 4)
		return make(word, Op.LOAD_LITERAL, { sf: opc !== 0, size: opc === 1 ? 8 : 4, access: opc === 2 ? ACCESS_SIGNED64 : ACCESS_LOAD, imm })
	}
	// LDP/STP/LDPSW, signed offset and pre- and post-index.
	if ((word & 0x3A000000) === 0x28000000) {
		if ((word >>> 26) & 1) return undefinedOf(word)
		const opc = word >>> 30
		const load = ((word >>> 22) & 1) === 1
		const index = (word >>> 23) & 3
		if (opc === 3 || index === 0 || (opc === 1 && !load)) return undefinedOf(word)
		const size = opc === 2 ? 8 : 4
		const mode = index === 1 ? MODE_POST : index === 3 ? MODE_PRE : MODE_OFFSET
		return make(word, Op.LOAD_STORE_PAIR, {
			sf: opc !== 0, size, mode, ra: (word >>> 10) & 31,
			access: !load ? ACCESS_STORE : opc === 1 ? ACCESS_SIGNED64 : ACCESS_LOAD,
			imm: BigInt(signExtend((word >>> 15) & 0x7F, 7) * size),
		})
	}
	if ((word & 0x3B000000) !== 0x38000000 && (word & 0x3B000000) !== 0x39000000) return undefinedOf(word)
	if ((word >>> 26) & 1) return undefinedOf(word)
	const sizeBits = word >>> 30
	const opc = (word >>> 22) & 3
	const size = 1 << sizeBits
	let access: number
	let sf: boolean
	switch (opc) {
		case 0: access = ACCESS_STORE; sf = sizeBits === 3; break
		case 1: access = ACCESS_LOAD; sf = sizeBits === 3; break
		case 2:
			// PRFM, for a doubleword; not supported.
			if (sizeBits === 3) return undefinedOf(word)
			access = ACCESS_SIGNED64; sf = true
			break
		default:
			if (sizeBits >= 2) return undefinedOf(word)
			access = ACCESS_SIGNED32; sf = false
	}
	return loadStoreForm(word, { sf, size, access })
}

/** SIMD&FP loads and stores: the integer forms with V set. */
function decodeLoadStoreFp(word: number): A64Instruction {
	if ((word & 0x3B000000) === 0x18000000) {
		const opc = word >>> 30
		if (opc === 3) return undefinedOf(word)
		return make(word, Op.LOAD_LITERAL, { fp: true, size: 4 << opc, access: ACCESS_LOAD, imm: BigInt(signExtend((word >>> 5) & 0x7FFFF, 19) * 4) })
	}
	if ((word & 0x3A000000) === 0x28000000) {
		const opc = word >>> 30
		const index = (word >>> 23) & 3
		if (opc === 3 || index === 0) return undefinedOf(word)
		const size = 4 << opc
		return make(word, Op.LOAD_STORE_PAIR, {
			fp: true, size, mode: index === 1 ? MODE_POST : index === 3 ? MODE_PRE : MODE_OFFSET, ra: (word >>> 10) & 31,
			access: (word >>> 22) & 1 ? ACCESS_LOAD : ACCESS_STORE, imm: BigInt(signExtend((word >>> 15) & 0x7F, 7) * size),
		})
	}
	if ((word & 0x3B000000) !== 0x38000000 && (word & 0x3B000000) !== 0x39000000) return undefinedOf(word)
	const sizeBits = word >>> 30
	const opc = (word >>> 22) & 3
	// opc 1x is Q, with size 00 only.
	if (opc & 2 && sizeBits !== 0) return undefinedOf(word)
	return loadStoreForm(word, { fp: true, size: opc & 2 ? 16 : 1 << sizeBits, access: opc & 1 ? ACCESS_LOAD : ACCESS_STORE })
}

/** The addressing forms of a one-register load or store. */
function loadStoreForm(word: number, fields: Partial<A64Instruction> & { size: number }): A64Instruction {
	const { size } = fields
	if ((word >>> 24) & 1) {
		return make(word, Op.LOAD_STORE, { ...fields, mode: MODE_OFFSET, imm: BigInt(((word >>> 10) & 0xFFF) * size) })
	}
	if ((word >>> 21) & 1) {
		if (((word >>> 10) & 3) !== 2) return undefinedOf(word)
		const option = (word >>> 13) & 7
		if (!(option & 2)) return undefinedOf(word)
		return make(word, Op.LOAD_STORE, { ...fields, mode: MODE_REGISTER, shift: option, amount: (word >>> 12) & 1 })
	}
	const imm = BigInt(signExtend((word >>> 12) & 0x1FF, 9))
	switch ((word >>> 10) & 3) {
		case 0: return make(word, Op.LOAD_STORE, { ...fields, mode: MODE_UNSCALED, imm })
		case 1: return make(word, Op.LOAD_STORE, { ...fields, mode: MODE_POST, imm })
		case 3: return make(word, Op.LOAD_STORE, { ...fields, mode: MODE_PRE, imm })
	}
	return undefinedOf(word)
}

/** Scalar floating-point data processing; Advanced SIMD vector words are undefined. */
function decodeFloat(word: number): A64Instruction {
	if (((word & 0xFF000000) >>> 0) === 0x1F000000) {
		const ftype = (word >>> 22) & 3
		if (ftype > 1) return undefinedOf(word)
		return make(word, Op.FP_DP3, { size: 4 << ftype, opc: (((word >>> 21) & 1) << 1) | ((word >>> 15) & 1), ra: (word >>> 10) & 31 })
	}
	if ((word & 0x7F000000) !== 0x1E000000) return undefinedOf(word)
	const sf = (word >>> 31) === 1
	const ftype = (word >>> 22) & 3
	if (ftype > 1) return undefinedOf(word)
	const size = 4 << ftype
	const rmode = (word >>> 19) & 3
	const opcode = (word >>> 16) & 7
	if (!((word >>> 21) & 1)) {
		const scale = (word >>> 10) & 63
		const valid = (rmode === 3 && opcode < 2) || (rmode === 0 && (opcode === FPI_SCVTF || opcode === FPI_UCVTF))
		if (!valid || (!sf && scale < 32)) return undefinedOf(word)
		return make(word, Op.FP_FIXED, { sf, size, shift: rmode, opc: opcode, amount: 64 - scale })
	}
	const low = (word >>> 10) & 63
	if (low === 0) {
		let valid: boolean
		if (opcode < 2) valid = true
		else if (opcode < 6) valid = rmode === 0
		else valid = rmode === 0 && sf === (ftype === 1)
		if (!valid) return undefinedOf(word)
		return make(word, Op.FP_INT, { sf, size, shift: rmode, opc: opcode })
	}
	if (sf) return undefinedOf(word)
	if ((low & 0x1F) === 0x10) {
		const op = (word >>> 15) & 63
		const conversion = op === FP1_FCVT_S || op === FP1_FCVT_D
		if (op > FP1_FRINTI || op === 6 || op === 7 || op === 13 || (conversion && op - FP1_FCVT_S === ftype)) return undefinedOf(word)
		return make(word, Op.FP_DP1, { size, opc: op })
	}
	if ((low & 0xF) === 0x8) {
		const opcode2 = word & 31
		if (low !== 0x8 || opcode2 & 7) return undefinedOf(word)
		if (opcode2 & 8 && (word >>> 16) & 31) return undefinedOf(word)
		return make(word, Op.FP_CMP, { size, opc: opcode2 >>> 3 })
	}
	if ((low & 7) === 4) {
		if ((word >>> 5) & 31) return undefinedOf(word)
		const imm8 = (word >>> 13) & 0xFF
		return make(word, Op.FP_IMM, { size, amount: imm8, imm: expandImm8(imm8, size === 8 ? DOUBLE : SINGLE) })
	}
	switch (low & 3) {
		case 1: return make(word, Op.FP_CCMP, { size, cond: (word >>> 12) & 15, imm: BigInt(word & 15), opc: (word >>> 4) & 1 })
		case 2: {
			const op = (word >>> 12) & 15
			if (op > FP2_FNMUL) return undefinedOf(word)
			return make(word, Op.FP_DP2, { size, opc: op })
		}
		default: return make(word, Op.FP_CSEL, { size, cond: (word >>> 12) & 15 })
	}
}

function decodeWord(word: number): A64Instruction {
	word >>>= 0
	const op0 = (word >>> 25) & 15
	if ((op0 & 0b1110) === 0b1000) return decodeDataImmediate(word)
	if ((op0 & 0b1110) === 0b1010) return decodeBranchSystem(word)
	if ((op0 & 0b0111) === 0b0101) return decodeDataRegister(word)
	if ((op0 & 0b0101) === 0b0100) return decodeLoadStore(word)
	if ((op0 & 0b0111) === 0b0111) return decodeFloat(word)
	return undefinedOf(word)
}

/** Programs run the same few words over and over; this keeps one decoding of each. */
const CACHE_LIMIT = 8192
const cache = new Map<number, A64Instruction>()

export function decode(word: number): A64Instruction {
	word >>>= 0
	let decoded = cache.get(word)
	if (decoded) return decoded
	if (cache.size >= CACHE_LIMIT) cache.clear()
	decoded = decodeWord(word)
	cache.set(word, decoded)
	return decoded
}
