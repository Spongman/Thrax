import { describe, expect, it } from 'vitest'
import { alu, conditionPassed, dataProcessing, rotateLoaded, rotatedImmediate, shiftByImmediate, shiftByRegister, shifter } from '../a32/alu'
import {
	COND_GE, COND_GT, COND_HI, COND_LE, COND_LS, COND_LT, COND_NV, FLAG_C, FLAG_N, FLAG_V, FLAG_Z,
	OP_ADC, OP_ADD, OP_CMP, OP_MOV, OP_RSB, OP_SBC, OP_SUB, SHIFT_ASR, SHIFT_LSL, SHIFT_LSR, SHIFT_ROR,
} from '../a32/isa'

describe('barrel shifter', () => {
	it('LSL #0 passes the value and the carry through', () => {
		expect(shiftByImmediate(0x80000001, SHIFT_LSL, 0, 1)).toBe(0x80000001 | 0)
		expect(shifter.carry).toBe(1)
	})

	it('takes the carry from the last bit shifted out', () => {
		expect(shiftByImmediate(0x80000001, SHIFT_LSL, 1, 0)).toBe(2)
		expect(shifter.carry).toBe(1)
		expect(shiftByImmediate(0x00000003, SHIFT_LSR, 1, 0)).toBe(1)
		expect(shifter.carry).toBe(1)
		expect(shiftByImmediate(0x80000000, SHIFT_ASR, 4, 0)).toBe(0xF8000000 | 0)
		expect(shifter.carry).toBe(0)
		expect(shiftByImmediate(0x00000011, SHIFT_ROR, 4, 0)).toBe(0x10000001)
		expect(shifter.carry).toBe(0)
	})

	it('reads LSR #0 and ASR #0 as shifts of 32, and ROR #0 as RRX', () => {
		expect(shiftByImmediate(0x80000000, SHIFT_LSR, 0, 0)).toBe(0)
		expect(shifter.carry).toBe(1)
		expect(shiftByImmediate(0x80000000, SHIFT_ASR, 0, 0)).toBe(-1)
		expect(shifter.carry).toBe(1)
		expect(shiftByImmediate(0x00000003, SHIFT_ROR, 0, 1)).toBe(0x80000001 | 0)
		expect(shifter.carry).toBe(1)
	})

	it('shifts by a register past 32', () => {
		expect(shiftByRegister(0x00000001, SHIFT_LSL, 32, 0)).toBe(0)
		expect(shifter.carry).toBe(1)
		expect(shiftByRegister(0x00000001, SHIFT_LSL, 33, 1)).toBe(0)
		expect(shifter.carry).toBe(0)
		expect(shiftByRegister(0x80000000, SHIFT_LSR, 32, 0)).toBe(0)
		expect(shifter.carry).toBe(1)
		expect(shiftByRegister(0x80000000, SHIFT_ASR, 200, 0)).toBe(-1)
		expect(shifter.carry).toBe(1)
		expect(shiftByRegister(0x80000001, SHIFT_ROR, 32, 0)).toBe(0x80000001 | 0)
		expect(shifter.carry).toBe(1)
		// Only the bottom byte counts: 256 is no shift, carry unchanged.
		expect(shiftByRegister(5, SHIFT_LSL, 256, 1)).toBe(5)
		expect(shifter.carry).toBe(1)
	})

	it('rotated immediates carry out bit 31 only when rotated', () => {
		expect(rotatedImmediate(0x0FF, 1)).toBe(0xFF)
		expect(shifter.carry).toBe(1)
		expect(rotatedImmediate(0x4FF, 0)).toBe(0xFF000000 | 0)
		expect(shifter.carry).toBe(1)
	})
})

describe('ALU flags', () => {
	it('sets C as not-borrow on subtraction', () => {
		expect(dataProcessing(OP_SUB, 5, 3, 0)).toBe(2)
		expect(alu.flags).toBe(FLAG_C)
		expect(dataProcessing(OP_CMP, 3, 5, 0)).toBe(-2)
		expect(alu.flags >>> 0).toBe(FLAG_N)
		expect(dataProcessing(OP_CMP, 7, 7, 0)).toBe(0)
		expect(alu.flags).toBe(FLAG_Z | FLAG_C)
	})

	it('sets V on signed overflow', () => {
		expect(dataProcessing(OP_ADD, 0x7FFFFFFF, 1, 0)).toBe(-0x80000000)
		expect(alu.flags >>> 0).toBe((FLAG_N | FLAG_V) >>> 0)
		expect(dataProcessing(OP_SUB, -0x80000000, 1, 0)).toBe(0x7FFFFFFF)
		expect(alu.flags).toBe(FLAG_C | FLAG_V)
		expect(dataProcessing(OP_ADD, -1, 1, 0)).toBe(0)
		expect(alu.flags).toBe(FLAG_Z | FLAG_C)
	})

	it('chains carries through ADC and SBC, and reverses through RSB', () => {
		expect(dataProcessing(OP_ADC, 1, 1, FLAG_C)).toBe(3)
		expect(dataProcessing(OP_SBC, 5, 3, 0)).toBe(1)
		expect(dataProcessing(OP_SBC, 5, 3, FLAG_C)).toBe(2)
		expect(dataProcessing(OP_RSB, 3, 10, 0)).toBe(7)
	})

	it('takes C from the shifter for logical operations and keeps V', () => {
		shifter.carry = 1
		expect(dataProcessing(OP_MOV, 0, 0, FLAG_V)).toBe(0)
		expect(alu.flags).toBe(FLAG_Z | FLAG_C | FLAG_V)
	})
})

describe('conditions', () => {
	it('tests the signed and unsigned comparisons', () => {
		expect(conditionPassed(COND_HI, FLAG_C)).toBe(true)
		expect(conditionPassed(COND_HI, FLAG_C | FLAG_Z)).toBe(false)
		expect(conditionPassed(COND_LS, 0)).toBe(true)
		expect(conditionPassed(COND_GE, FLAG_N | FLAG_V)).toBe(true)
		expect(conditionPassed(COND_LT, FLAG_N)).toBe(true)
		expect(conditionPassed(COND_GT, FLAG_Z)).toBe(false)
		expect(conditionPassed(COND_LE, FLAG_Z)).toBe(true)
		expect(conditionPassed(COND_NV, 0)).toBe(false)
	})
})

describe('loads', () => {
	it('rotates an unaligned word', () => {
		expect(rotateLoaded(0x44332211, 0) >>> 0).toBe(0x44332211)
		expect(rotateLoaded(0x44332211, 1) >>> 0).toBe(0x11443322)
		expect(rotateLoaded(0x44332211, 3) >>> 0).toBe(0x33221144)
	})
})
