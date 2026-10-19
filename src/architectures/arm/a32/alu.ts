/**
 * A32 execution helpers that do not depend on how a CPU holds its PC or its
 * status bits: condition tests, the barrel shifter with its carry-out, and the
 * data-processing ALU.  Flags travel as the NZCV nibble in bits 31-28, where
 * both the 26-bit R15 and the 32-bit CPSR keep them.
 *
 * Results that come in pairs (a value and a carry) leave the second in the
 * module's `shifter` or `alu` record, so the hot path allocates nothing.
 */

import {
	COND_AL, COND_CC, COND_CS, COND_EQ, COND_GE, COND_GT, COND_HI, COND_LE, COND_LS, COND_LT, COND_MI, COND_NE, COND_PL, COND_VC, COND_VS,
	FLAG_C, FLAG_N, FLAG_V, FLAG_Z, FLAGS_NZCV,
	OP_ADC, OP_ADD, OP_AND, OP_BIC, OP_CMN, OP_CMP, OP_EOR, OP_MOV, OP_MVN, OP_ORR, OP_RSB, OP_RSC, OP_SBC, OP_SUB, OP_TEQ, OP_TST,
	SHIFT_ASR, SHIFT_LSL, SHIFT_LSR, SHIFT_ROR,
} from './isa'

/** Whether `cond` passes with the NZCV bits of `flags`. */
export function conditionPassed(cond: number, flags: number): boolean {
	switch (cond) {
		case COND_EQ: return (flags & FLAG_Z) !== 0
		case COND_NE: return (flags & FLAG_Z) === 0
		case COND_CS: return (flags & FLAG_C) !== 0
		case COND_CC: return (flags & FLAG_C) === 0
		case COND_MI: return (flags & FLAG_N) !== 0
		case COND_PL: return (flags & FLAG_N) === 0
		case COND_VS: return (flags & FLAG_V) !== 0
		case COND_VC: return (flags & FLAG_V) === 0
		case COND_HI: return (flags & FLAG_C) !== 0 && (flags & FLAG_Z) === 0
		case COND_LS: return (flags & FLAG_C) === 0 || (flags & FLAG_Z) !== 0
		case COND_GE: return ((flags & FLAG_N) !== 0) === ((flags & FLAG_V) !== 0)
		case COND_LT: return ((flags & FLAG_N) !== 0) !== ((flags & FLAG_V) !== 0)
		case COND_GT: return (flags & FLAG_Z) === 0 && ((flags & FLAG_N) !== 0) === ((flags & FLAG_V) !== 0)
		case COND_LE: return (flags & FLAG_Z) !== 0 || ((flags & FLAG_N) !== 0) !== ((flags & FLAG_V) !== 0)
		case COND_AL: return true
		// NV: never, on the architectures that have it.
		default: return false
	}
}

/** The shifter's carry-out of the last shift: 0 or 1. */
export const shifter = { carry: 0 }

/**
 * `value` shifted by an immediate amount as encoded (0-31): LSR #0 and ASR #0
 * mean a shift of 32, and ROR #0 means RRX.  `carry` is the C flag, 0 or 1.
 */
export function shiftByImmediate(value: number, type: number, amount: number, carry: number): number {
	switch (type) {
		case SHIFT_LSL:
			if (amount === 0) {
				shifter.carry = carry
				return value | 0
			}
			shifter.carry = (value >>> (32 - amount)) & 1
			return value << amount
		case SHIFT_LSR:
			if (amount === 0) {
				shifter.carry = value >>> 31
				return 0
			}
			shifter.carry = (value >>> (amount - 1)) & 1
			return (value >>> amount) | 0
		case SHIFT_ASR:
			if (amount === 0) {
				shifter.carry = value >>> 31
				return value >> 31
			}
			shifter.carry = (value >> (amount - 1)) & 1
			return value >> amount
		default:
			if (amount === 0) {
				// RRX: one place right through the carry.
				shifter.carry = value & 1
				return ((carry << 31) | (value >>> 1)) | 0
			}
			shifter.carry = (value >>> (amount - 1)) & 1
			return (value >>> amount) | (value << (32 - amount))
	}
}

/** `value` shifted by the bottom byte of a register, 0-255. */
export function shiftByRegister(value: number, type: number, amount: number, carry: number): number {
	const count = amount & 0xFF
	if (count === 0) {
		shifter.carry = carry
		return value | 0
	}
	switch (type) {
		case SHIFT_LSL:
			if (count < 32) return shiftByImmediate(value, SHIFT_LSL, count, carry)
			shifter.carry = count === 32 ? value & 1 : 0
			return 0
		case SHIFT_LSR:
			if (count < 32) return shiftByImmediate(value, SHIFT_LSR, count, carry)
			shifter.carry = count === 32 ? value >>> 31 : 0
			return 0
		case SHIFT_ASR:
			if (count < 32) return shiftByImmediate(value, SHIFT_ASR, count, carry)
			shifter.carry = value >>> 31
			return value >> 31
		default: {
			const rotation = count & 31
			if (rotation === 0) {
				shifter.carry = value >>> 31
				return value | 0
			}
			return shiftByImmediate(value, SHIFT_ROR, rotation, carry)
		}
	}
}

/** A rotated 12-bit immediate field; its carry-out is bit 31 when rotated, else C. */
export function rotatedImmediate(field: number, carry: number): number {
	const constant = field & 0xFF
	const shift = ((field >>> 8) & 0xF) * 2
	if (shift === 0) {
		shifter.carry = carry
		return constant
	}
	const value = (constant >>> shift) | (constant << (32 - shift))
	shifter.carry = value >>> 31
	return value
}

/** The ALU's flags after the last dataProcessing(), as NZCV in bits 31-28. */
export const alu = { flags: 0 }

/** a + b + carry with its NZCV flags in `alu.flags`. */
export function addWithCarry(a: number, b: number, carry: number): number {
	const unsigned = (a >>> 0) + (b >>> 0) + carry
	const result = unsigned | 0
	const overflow = ((a ^ result) & (b ^ result)) < 0
	alu.flags = (result < 0 ? FLAG_N : 0) | (result === 0 ? FLAG_Z : 0) | (unsigned > 0xFFFFFFFF ? FLAG_C : 0) | (overflow ? FLAG_V : 0)
	return result
}

/**
 * One data-processing operation on operand 1 `a` and the shifted operand 2
 * `b`.  `flags` are the NZCV bits before it; `alu.flags` gets the NZCV bits an
 * S suffix would set: logical operations take C from `shifter.carry`, which
 * must still hold operand 2's carry-out, and keep V.
 */
export function dataProcessing(op: number, a: number, b: number, flags: number): number {
	let result: number
	switch (op) {
		case OP_SUB:
		case OP_CMP: return addWithCarry(a, ~b, 1)
		case OP_RSB: return addWithCarry(b, ~a, 1)
		case OP_ADD:
		case OP_CMN: return addWithCarry(a, b, 0)
		case OP_ADC: return addWithCarry(a, b, (flags & FLAG_C) !== 0 ? 1 : 0)
		case OP_SBC: return addWithCarry(a, ~b, (flags & FLAG_C) !== 0 ? 1 : 0)
		case OP_RSC: return addWithCarry(b, ~a, (flags & FLAG_C) !== 0 ? 1 : 0)
		case OP_AND:
		case OP_TST: result = a & b; break
		case OP_EOR:
		case OP_TEQ: result = a ^ b; break
		case OP_ORR: result = a | b; break
		case OP_MOV: result = b | 0; break
		case OP_BIC: result = a & ~b; break
		case OP_MVN: result = ~b; break
		default: throw new RangeError(`No data-processing opcode ${op}`)
	}
	alu.flags = (result < 0 ? FLAG_N : 0) | (result === 0 ? FLAG_Z : 0) | (shifter.carry ? FLAG_C : 0) | (flags & FLAG_V)
	return result
}

/** NZ from a multiply result; C and V as they were, as ARMv2 leaves C meaningless. */
export function multiplyFlags(result: number, flags: number): number {
	return (result < 0 ? FLAG_N : 0) | (result === 0 ? FLAG_Z : 0) | (flags & (FLAGS_NZCV & ~(FLAG_N | FLAG_Z)))
}

/** The word a load of an unaligned address returns: the aligned word rotated, as ARMv2 to v5 do. */
export function rotateLoaded(word: number, address: number): number {
	const shift = (address & 3) * 8
	return shift === 0 ? word | 0 : (word >>> shift) | (word << (32 - shift))
}
