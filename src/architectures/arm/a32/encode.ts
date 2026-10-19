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
