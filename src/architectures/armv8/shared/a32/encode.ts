/**
 * A32 instruction words from their fields.  Each function takes values already
 * checked for range and returns the word as an unsigned 32-bit number.
 */

import { SHIFT_ROR, SHIFT_RRX } from './isa'

const word = (value: number) => value >>> 0

/** Operand 2 as a register shifted by an immediate (0-31; LSR and ASR take 32 as 0). */
export function shiftedRegisterField(rm: number, type: number, amount: number): number {
	if (type === SHIFT_RRX) return (SHIFT_ROR << 5) | rm
	return ((amount & 31) << 7) | (type << 5) | rm
}

/** Operand 2 as a register shifted by the bottom byte of `rs`. */
export function registerShiftField(rm: number, type: number, rs: number): number {
	return (rs << 8) | (type << 5) | 0x10 | rm
}

/** `operand` is a 12-bit field: an immediate from encodeImmediate when `immediate`, else a register form. */
export function encodeDataProcessing(cond: number, op: number, setFlags: boolean, rd: number, rn: number, operand: number, immediate: boolean): number {
	return word((cond << 28) | (immediate ? 0x02000000 : 0) | (op << 21) | (setFlags ? 0x00100000 : 0) | (rn << 16) | (rd << 12) | operand)
}

/** MUL rd, rm, rs, or MLA rd, rm, rs, rn when `accumulate`. */
export function encodeMultiply(cond: number, accumulate: boolean, setFlags: boolean, rd: number, rm: number, rs: number, rn: number): number {
	return word((cond << 28) | (accumulate ? 0x00200000 : 0) | (setFlags ? 0x00100000 : 0) | (rd << 16) | (rn << 12) | (rs << 8) | 0x90 | rm)
}

/** SWP{B} rd, rm, [rn]. */
export function encodeSwap(cond: number, byte: boolean, rd: number, rm: number, rn: number): number {
	return word((cond << 28) | 0x01000090 | (byte ? 0x00400000 : 0) | (rn << 16) | (rd << 12) | rm)
}

export interface TransferFields {
	load: boolean
	byte: boolean
	/** Pre-indexed: the offset applies before the access. */
	pre: boolean
	/** The offset is added rather than subtracted. */
	up: boolean
	/** Pre-indexed: write the address back. Post-indexed: the T (user access) form. */
	writeback: boolean
	rn: number
	rd: number
	/** A 12-bit unsigned offset, or a shifted-register field when `register`. */
	offset: number
	register: boolean
}

export function encodeTransfer(cond: number, fields: TransferFields): number {
	const { load, byte, pre, up, writeback, rn, rd, offset, register } = fields
	return word((cond << 28) | 0x04000000 | (register ? 0x02000000 : 0) | (pre ? 0x01000000 : 0) | (up ? 0x00800000 : 0) |
		(byte ? 0x00400000 : 0) | (writeback ? 0x00200000 : 0) | (load ? 0x00100000 : 0) | (rn << 16) | (rd << 12) | offset)
}

/** Block addressing modes as their P and U bits: bit 1 is P (before), bit 0 is U (increment). */
export const BLOCK_DA = 0
export const BLOCK_IA = 1
export const BLOCK_DB = 2
export const BLOCK_IB = 3

/** LDM or STM; `psr` is the ^ suffix. */
export function encodeBlock(cond: number, load: boolean, mode: number, writeback: boolean, psr: boolean, rn: number, mask: number): number {
	return word((cond << 28) | 0x08000000 | (mode << 23) | (psr ? 0x00400000 : 0) | (writeback ? 0x00200000 : 0) | (load ? 0x00100000 : 0) | (rn << 16) | (mask & 0xFFFF))
}

/** B or BL by `offset` bytes from the branch's address + 8, a multiple of 4. */
export function encodeBranch(cond: number, link: boolean, offset: number): number {
	return word((cond << 28) | 0x0A000000 | (link ? 0x01000000 : 0) | ((offset >> 2) & 0xFFFFFF))
}

export function encodeSwi(cond: number, comment: number): number {
	return word((cond << 28) | 0x0F000000 | (comment & 0xFFFFFF))
}

/* ARMv8 only from here. */

/** MLS rd, rn, rm, ra: rd = ra - rn * rm. */
export function encodeMultiplySubtract(cond: number, rd: number, rn: number, rm: number, ra: number): number {
	return word((cond << 28) | 0x00600090 | (rd << 16) | (ra << 12) | (rm << 8) | rn)
}

/** Long multiplies by bits 22-21: UMULL, UMLAL, SMULL, SMLAL. */
export const LONG_UMULL = 0
export const LONG_UMLAL = 1
export const LONG_SMULL = 2
export const LONG_SMLAL = 3

export function encodeMultiplyLong(cond: number, kind: number, setFlags: boolean, rdLo: number, rdHi: number, rn: number, rm: number): number {
	return word((cond << 28) | 0x00800090 | (kind << 21) | (setFlags ? 0x00100000 : 0) | (rdHi << 16) | (rdLo << 12) | (rm << 8) | rn)
}

/** SDIV or UDIV rd, rn, rm. */
export function encodeDivide(cond: number, signed: boolean, rd: number, rn: number, rm: number): number {
	return word((cond << 28) | (signed ? 0x0710F010 : 0x0730F010) | (rd << 16) | (rm << 8) | rn)
}

/** Halfword, signed and doubleword transfers by bits 6-5 with L. */
export const EXTRA_STRH = 0x0B0
export const EXTRA_LDRH = 0x1000B0
export const EXTRA_LDRSB = 0x1000D0
export const EXTRA_LDRSH = 0x1000F0
export const EXTRA_LDRD = 0x0D0
export const EXTRA_STRD = 0x0F0

export interface ExtraTransferFields {
	/** An EXTRA_*. */
	kind: number
	pre: boolean
	up: boolean
	writeback: boolean
	rn: number
	rt: number
	/** An 8-bit offset, or Rm when `register`. */
	offset: number
	register: boolean
}

export function encodeExtraTransfer(cond: number, fields: ExtraTransferFields): number {
	const { kind, pre, up, writeback, rn, rt, offset, register } = fields
	const field = register ? offset : (((offset >>> 4) & 15) << 8) | (offset & 15)
	return word((cond << 28) | kind | (pre ? 0x01000000 : 0) | (up ? 0x00800000 : 0) | (register ? 0 : 0x00400000) |
		(writeback ? 0x00200000 : 0) | (rn << 16) | (rt << 12) | field)
}

/** LDREX rt, [rn]. */
export function encodeLoadExclusive(cond: number, rt: number, rn: number): number {
	return word((cond << 28) | 0x01900F9F | (rn << 16) | (rt << 12))
}

/** STREX rd, rt, [rn]. */
export function encodeStoreExclusive(cond: number, rd: number, rt: number, rn: number): number {
	return word((cond << 28) | 0x01800F90 | (rn << 16) | (rd << 12) | rt)
}

/** MRS rd, CPSR, or SPSR when `spsr`. */
export function encodeMrs(cond: number, spsr: boolean, rd: number): number {
	return word((cond << 28) | 0x010F0000 | (spsr ? 0x00400000 : 0) | (rd << 12))
}

/** Status field mask bits, 19-16 of MSR. */
export const PSR_FIELD_C = 1
export const PSR_FIELD_X = 2
export const PSR_FIELD_S = 4
export const PSR_FIELD_F = 8

/** MSR from a register, or from a 12-bit immediate field when `immediate`. */
export function encodeMsr(cond: number, spsr: boolean, mask: number, operand: number, immediate: boolean): number {
	return word((cond << 28) | (immediate ? 0x0320F000 : 0x0120F000) | (spsr ? 0x00400000 : 0) | (mask << 16) | operand)
}

/** BX rm, or BLX rm when `link`. */
export function encodeBranchExchange(cond: number, link: boolean, rm: number): number {
	return word((cond << 28) | (link ? 0x012FFF30 : 0x012FFF10) | rm)
}

/** BLX to a label `offset` bytes from its address + 8, a multiple of 2. */
export function encodeBlxImmediate(offset: number): number {
	return word(0xFA000000 | (((offset >> 1) & 1) << 24) | ((offset >> 2) & 0xFFFFFF))
}

export function encodeClz(cond: number, rd: number, rm: number): number {
	return word((cond << 28) | 0x016F0F10 | (rd << 12) | rm)
}

/** MOVW, or MOVT when `top`, of a 16-bit value. */
export function encodeWideMove(cond: number, top: boolean, rd: number, value: number): number {
	return word((cond << 28) | (top ? 0x03400000 : 0x03000000) | (((value >>> 12) & 15) << 16) | (rd << 12) | (value & 0xFFF))
}

/** Reversals by the bits that tell them apart. */
export const REVERSE_REV = 0x06BF0F30
export const REVERSE_REV16 = 0x06BF0FB0
export const REVERSE_RBIT = 0x06FF0F30
export const REVERSE_REVSH = 0x06FF0FB0

export function encodeReverse(cond: number, kind: number, rd: number, rm: number): number {
	return word((cond << 28) | kind | (rd << 12) | rm)
}

/** Extends by the bits that tell them apart; the A forms add Rn. */
export const EXTEND_SXTB = 0x06A00070
export const EXTEND_SXTH = 0x06B00070
export const EXTEND_UXTB = 0x06E00070
export const EXTEND_UXTH = 0x06F00070

/** `rn` 15 is the plain form; `rotation` is 0, 8, 16 or 24. */
export function encodeExtend(cond: number, kind: number, rd: number, rn: number, rm: number, rotation: number): number {
	return word((cond << 28) | kind | (rn << 16) | (rd << 12) | ((rotation >>> 3) << 10) | rm)
}

/** SBFX or UBFX rd, rn, #lsb, #width. */
export function encodeBitfieldExtract(cond: number, signed: boolean, rd: number, rn: number, lsb: number, width: number): number {
	return word((cond << 28) | (signed ? 0x07A00050 : 0x07E00050) | ((width - 1) << 16) | (rd << 12) | (lsb << 7) | rn)
}

/** BFI rd, rn, #lsb, #width, or BFC with `rn` 15. */
export function encodeBitfieldInsert(cond: number, rd: number, rn: number, lsb: number, width: number): number {
	return word((cond << 28) | 0x07C00010 | ((lsb + width - 1) << 16) | (rd << 12) | (lsb << 7) | rn)
}

/** BKPT #imm16, always unconditional. */
export function encodeBreakpoint(imm: number): number {
	return word(0xE1200070 | ((imm >>> 4) << 8) | (imm & 15))
}

/** UDF #imm16, permanently undefined. */
export function encodeUdf(imm: number): number {
	return word(0xE7F000F0 | ((imm >>> 4) << 8) | (imm & 15))
}

/** A hint: 0 NOP, 1 YIELD, 2 WFE, 3 WFI, 4 SEV. */
export function encodeHint(cond: number, hint: number): number {
	return word((cond << 28) | 0x0320F000 | hint)
}

/** PLD with a 12-bit offset, or a shifted-register field when `register`. */
export function encodePreload(up: boolean, rn: number, offset: number, register: boolean): number {
	return word((register ? 0xF750F000 : 0xF550F000) | (up ? 0x00800000 : 0) | (rn << 16) | offset)
}
