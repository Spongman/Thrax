/**
 * A64 instruction encoding: each mnemonic checks its operands when parsed and
 * returns how to make its word once symbols are known. Aliases encode as the
 * instruction the reference manual (C6.2) defines them by.
 */

import { AssemblyError } from '../../../../core/diagnostics'
import type { Position } from '../../../../core/assembly/tokens'
import {
	conditionCode, encodeLogicalImmediate, encodeMoveWide, EXTEND_SXTW, EXTEND_SXTX, EXTEND_UXTW, EXTEND_UXTX, MASK32, MASK64, R_LR, R_ZR,
	SHIFT_LSL, SHIFT_ROR,
} from '../isa'
import { DOUBLE, encodeImm8, numberToBits, SINGLE } from '../../shared/fp'
import { SYSREG_FPCR, SYSREG_FPSR, SYSREG_NZCV } from '../decode'
import { OperandKind, type ExtendOperand, type FpRegisterOperand, type MemoryOperand, type Operand, type RegisterOperand, type ShiftOperand, type Value } from './operands'

const { REGISTER, IMMEDIATE, MEMORY, SHIFT, EXTEND, LITERAL, EXPRESSION, FP_REGISTER } = OperandKind

/** What an encoder reads once layout is settled. */
export interface EncodeContext {
	/** Address of the instruction. */
	readonly dot: number
	/** A value as a signed integer; `:lo12:` values are already cut to 12 bits. */
	value(value: Value): bigint
	/** Address of a literal pool slot. */
	slot(slot: PoolSlot): number
}

/** A literal pool entry an `ldr =` loads from. */
export interface PoolSlot {
	size: number
	value: Value
	address: number
}

export interface EncodeEnvironment {
	/** A literal pool entry of `size` bytes holding `value`. */
	pool(size: number, value: Value): PoolSlot
	/** SIMD&FP instructions assemble; on unless false. */
	floatingPoint?: boolean
}

export type Encoder = (context: EncodeContext) => number

type Form = (operands: Operand[], at: Position, environment: EncodeEnvironment) => Encoder

const fail = (message: string, at: Position): never => { throw new AssemblyError(message, at) }

/* ----------------------------------------------------------------- operands */

function count(operands: Operand[], at: Position, minimum: number, maximum = minimum) {
	if (operands.length < minimum || operands.length > maximum) {
		const wanted = minimum === maximum ? `${minimum}` : `${minimum} to ${maximum}`
		fail(`Expected ${wanted} operand${maximum === 1 ? '' : 's'}, found ${operands.length}`, at)
	}
}

interface RegisterRule {
	/** Register 31 is SP here, rather than the zero register. */
	sp?: boolean
	/** Width required: true for X, false for W. */
	wide?: boolean
}

/** A general-purpose register operand, checked against what the field accepts. */
function reg(operand: Operand | undefined, at: Position, rule: RegisterRule = {}): RegisterOperand {
	if (operand?.kind !== REGISTER) return fail('Expected a register', operand?.at ?? at)
	if (operand.sp && !rule.sp) fail(`${operand.name} is not allowed here`, operand.at)
	if (operand.zr && rule.sp) fail(`${operand.name} is not allowed here, where register 31 is the stack pointer`, operand.at)
	if (rule.wide !== undefined && operand.wide !== rule.wide) fail(`Expected ${rule.wide ? 'an X' : 'a W'} register, not ${operand.name}`, operand.at)
	return operand
}

/** An immediate, with or without its `#`. */
function imm(operand: Operand | undefined, at: Position): Value {
	if (operand?.kind === IMMEDIATE || operand?.kind === EXPRESSION) return operand.value
	return fail('Expected an immediate', operand?.at ?? at)
}

function isImmediate(operand: Operand | undefined): boolean {
	return operand?.kind === IMMEDIATE || operand?.kind === EXPRESSION
}

function condition(operand: Operand | undefined, at: Position): number {
	const code = operand?.kind === EXPRESSION && operand.name ? conditionCode(operand.name) : -1
	if (code < 0) fail('Expected a condition such as eq, ne, lt or hs', operand?.at ?? at)
	return code
}

/** A value in [low, high], as a number. */
function ranged(context: EncodeContext, value: Value, low: number, high: number, what: string): number {
	const result = context.value(value)
	if (result < BigInt(low) || result > BigInt(high)) fail(`${what} ${result} is out of range ${low} to ${high}`, value.at)
	return Number(result)
}

/** An amount given with a shift or extend, or zero where there is none. */
const amountOf = (context: EncodeContext, value: Value | null, high: number, what: string) => value ? ranged(context, value, 0, high, what) : 0

/** A PC-relative offset to `value`, as a multiple of `scale` in a signed field of `bits`. */
function relative(context: EncodeContext, value: Value, bits: number, scale: number, what: string): number {
	const offset = context.value(value) - BigInt(context.dot)
	if (offset % BigInt(scale) !== 0n) fail(`${what} target is not ${scale}-byte aligned`, value.at)
	const units = offset / BigInt(scale)
	const limit = 1n << BigInt(bits - 1)
	if (units < -limit || units >= limit) fail(`${what} target is out of range`, value.at)
	return Number(BigInt.asUintN(bits, units))
}

const sf = (wide: boolean) => wide ? 0x80000000 : 0
const word = (value: number) => value >>> 0

/** A value as `width` bits, accepting the signed and unsigned spellings of it. */
function bitsOf(context: EncodeContext, value: Value, width: number): bigint {
	const result = context.value(value)
	const limit = 1n << BigInt(width)
	if (result < -(limit >> 1n) || result >= limit) fail(`Immediate ${result} does not fit in ${width} bits`, value.at)
	return BigInt.asUintN(width, result)
}

function sameWidth(registers: RegisterOperand[]) {
	const wide = registers[0].wide
	for (const register of registers) if (register.wide !== wide) fail('Operands must all be X or all be W registers', register.at)
}

/* ------------------------------------------------------- data processing */

const shiftOperand = (operand: Operand | undefined): ShiftOperand | null => operand?.kind === SHIFT ? operand : null

/** ADD/SUB/ADDS/SUBS in every form. `rd` null makes it CMP/CMN. */
function addSub(sub: boolean, setFlags: boolean, rdOperand: Operand | null, rnOperand: Operand, op2: Operand, modifier: Operand | undefined, at: Position): Encoder {
	const rn = reg(rnOperand, at, { sp: true })
	const rd = rdOperand ? reg(rdOperand, at, { sp: !setFlags }) : { ...rn, n: R_ZR, sp: false, zr: true }
	if (rd.wide !== rn.wide) fail('Operands must all be X or all be W registers', rn.at)
	const wide = rd.wide
	const width = wide ? 64 : 32
	const flags = (setFlags ? 0x20000000 : 0) | sf(wide)
	if (isImmediate(op2)) {
		const value = imm(op2, at)
		const shift = shiftOperand(modifier)
		if (modifier && (!shift || shift.shift !== SHIFT_LSL)) fail('An immediate may only be shifted by lsl #0 or lsl #12', modifier.at)
		return (context) => {
			let amount = amountOf(context, shift?.amount ?? null, 12, 'Shift')
			if (amount !== 0 && amount !== 12) fail('An immediate may only be shifted by lsl #0 or lsl #12', shift!.at)
			let encoded = context.value(value)
			let subtract = sub
			if (!shift && !value.lo12) {
				// GNU takes a negative immediate as the opposite operation, and shifts by 12 where that fits.
				if (encoded < 0n && encoded > -(1n << 24n)) {
					encoded = -encoded
					subtract = !sub
				}
				if (encoded > 0xFFFn && (encoded & 0xFFFn) === 0n && encoded >> 12n <= 0xFFFn) {
					encoded >>= 12n
					amount = 12
				}
			}
			if (encoded < 0n || encoded > 0xFFFn) fail(`Immediate ${context.value(value)} is out of range for ${sub ? 'sub' : 'add'}: 0 to 4095, optionally shifted by 12`, value.at)
			return word(flags | (subtract ? 0x40000000 : 0) | 0x11000000 | (amount ? 1 << 22 : 0) | (Number(encoded) << 10) | (rn.n << 5) | rd.n)
		}
	}
	const rm = reg(op2, at)
	const extended = modifier?.kind === EXTEND || rd.sp || rn.sp || (wide && !rm.wide)
	if (extended) {
		let option: number
		let amountValue: Value | null = null
		if (modifier?.kind === EXTEND) {
			option = modifier.extend
			amountValue = modifier.amount
		} else if (modifier?.kind === SHIFT) {
			if (modifier.shift !== SHIFT_LSL) fail('Only lsl may be used beside sp; use an extend', modifier.at)
			option = wide ? EXTEND_UXTX : EXTEND_UXTW
			amountValue = modifier.amount
		} else {
			if (modifier) fail('Expected an extend or shift', modifier.at)
			option = wide ? EXTEND_UXTX : EXTEND_UXTW
		}
		const wantsX = wide && (option & 3) === 3
		if (rm.wide !== wantsX) fail(`The extended register must be ${wantsX ? 'an X' : 'a W'} register`, rm.at)
		if (rm.sp) fail(`${rm.name} is not allowed here`, rm.at)
		return (context) => {
			const amount = amountOf(context, amountValue, 4, 'Extend amount')
			return word(flags | (sub ? 0x40000000 : 0) | 0x0B200000 | (rm.n << 16) | (option << 13) | (amount << 10) | (rn.n << 5) | rd.n)
		}
	}
	if (rm.wide !== wide) fail('Operands must all be X or all be W registers', rm.at)
	if (rm.sp) fail(`${rm.name} is not allowed here`, rm.at)
	const shift = shiftOperand(modifier)
	if (modifier && (!shift || shift.shift === SHIFT_ROR)) fail('Expected lsl, lsr or asr', modifier.at)
	return (context) => {
		const amount = amountOf(context, shift?.amount ?? null, width - 1, 'Shift amount')
		return word(flags | (sub ? 0x40000000 : 0) | 0x0B000000 | ((shift?.shift ?? 0) << 22) | (rm.n << 16) | (amount << 10) | (rn.n << 5) | rd.n)
	}
}

const addSubForm = (sub: boolean, setFlags: boolean): Form => (operands, at) => {
	count(operands, at, 3, 4)
	return addSub(sub, setFlags, operands[0], operands[1], operands[2], operands[3], at)
}

const compareForm = (sub: boolean): Form => (operands, at) => {
	count(operands, at, 2, 3)
	return addSub(sub, true, null, operands[0], operands[1], operands[2], at)
}

/** NEG/NEGS: SUB(S) Rd, ZR, Rm{, shift}. */
const negateForm = (setFlags: boolean): Form => (operands, at) => {
	count(operands, at, 2, 3)
	const rd = reg(operands[0], at)
	const zero: RegisterOperand = { ...rd, n: R_ZR, sp: false, zr: true }
	const rm = reg(operands[1], at)
	if (rm.wide !== rd.wide) fail('Operands must all be X or all be W registers', rm.at)
	if (operands[2] && operands[2].kind !== SHIFT) fail('Expected a shift', operands[2].at)
	return shiftedRegister(0x4B000000 | (setFlags ? 0x20000000 : 0), rd, zero, rm, shiftOperand(operands[2]), at, false)
}

/** A shifted-register operation; `rotate` allows ROR, as only the logical ones do. */
function shiftedRegister(base: number, rd: RegisterOperand, rn: RegisterOperand, rm: RegisterOperand, shift: ShiftOperand | null, at: Position, rotate: boolean): Encoder {
	sameWidth([rd, rn, rm])
	if (shift && shift.shift === SHIFT_ROR && !rotate) fail('Expected lsl, lsr or asr', shift.at)
	const width = rd.wide ? 64 : 32
	return (context) => {
		const amount = amountOf(context, shift?.amount ?? null, width - 1, 'Shift amount')
		return word(base | sf(rd.wide) | ((shift?.shift ?? 0) << 22) | (rm.n << 16) | (amount << 10) | (rn.n << 5) | rd.n)
	}
}

/** ADC/ADCS/SBC/SBCS, and NGC/NGCS with Rn the zero register. */
const carryForm = (base: number, negate: boolean): Form => (operands, at) => {
	count(operands, at, negate ? 2 : 3)
	const rd = reg(operands[0], at)
	const rn = negate ? { ...rd, n: R_ZR } : reg(operands[1], at)
	const rm = reg(operands[negate ? 1 : 2], at)
	sameWidth([rd, rn, rm])
	return () => word(base | sf(rd.wide) | (rm.n << 16) | (rn.n << 5) | rd.n)
}

/** Logical opc: AND 0, ORR 1, EOR 2, ANDS 3. */
function logicalImmediate(opc: number, rd: RegisterOperand, rn: RegisterOperand, value: Value, invert: boolean): Encoder {
	const width = rd.wide ? 64 : 32
	return (context) => {
		let bits = bitsOf(context, value, width)
		if (invert) bits = ~bits & (rd.wide ? MASK64 : MASK32)
		const fields = encodeLogicalImmediate(bits, width)
		if (!fields) fail(`Immediate 0x${bits.toString(16)} cannot be encoded as a logical (bitmask) immediate`, value.at)
		const { n, immr, imms } = fields!
		return word(sf(rd.wide) | (opc << 29) | 0x12000000 | (n << 22) | (immr << 16) | (imms << 10) | (rn.n << 5) | rd.n)
	}
}

/** AND/ORR/EOR/ANDS and their inverted-operand forms BIC/ORN/EON/BICS. */
const logicalForm = (opc: number, invert: boolean): Form => (operands, at) => {
	count(operands, at, 3, 4)
	if (isImmediate(operands[2])) {
		if (operands[3]) fail('An immediate cannot be shifted here', operands[3].at)
		const rd = reg(operands[0], at, { sp: opc !== 3 })
		const rn = reg(operands[1], at)
		if (rd.wide !== rn.wide) fail('Operands must all be X or all be W registers', rn.at)
		return logicalImmediate(opc, rd, rn, imm(operands[2], at), invert)
	}
	if (operands[3] && operands[3].kind !== SHIFT) fail('Expected a shift', operands[3].at)
	return shiftedRegister(0x0A000000 | (opc << 29) | (invert ? 0x00200000 : 0), reg(operands[0], at), reg(operands[1], at), reg(operands[2], at), shiftOperand(operands[3]), at, true)
}

/** TST: ANDS ZR, Rn, op2. */
const testForm: Form = (operands, at) => {
	count(operands, at, 2, 3)
	const rn = reg(operands[0], at)
	const zero: RegisterOperand = { ...rn, n: R_ZR, zr: true }
	if (isImmediate(operands[1])) {
		if (operands[2]) fail('An immediate cannot be shifted here', operands[2].at)
		return logicalImmediate(3, zero, rn, imm(operands[1], at), false)
	}
	if (operands[2] && operands[2].kind !== SHIFT) fail('Expected a shift', operands[2].at)
	return shiftedRegister(0x6A000000, zero, rn, reg(operands[1], at), shiftOperand(operands[2]), at, true)
}

/** MVN: ORN Rd, ZR, Rm{, shift}. */
const mvnForm: Form = (operands, at) => {
	count(operands, at, 2, 3)
	const rd = reg(operands[0], at)
	if (operands[2] && operands[2].kind !== SHIFT) fail('Expected a shift', operands[2].at)
	return shiftedRegister(0x2A200000, rd, { ...rd, n: R_ZR, zr: true }, reg(operands[1], at), shiftOperand(operands[2]), at, true)
}

/** MOVZ/MOVN/MOVK fields for `value`, shifted by `shift` when given. */
function moveWide(opc: number, rd: RegisterOperand, value: Value, shift: ShiftOperand | null): Encoder {
	const width = rd.wide ? 64 : 32
	return (context) => {
		let immediate = context.value(value)
		let hw: number
		if (shift) {
			const amount = amountOf(context, shift.amount, width - 16, 'Shift')
			if (amount % 16) fail('The shift must be a multiple of 16', shift.at)
			hw = amount / 16
		} else {
			// GNU finds the shift for a value that is one halfword in place.
			hw = 0
			while (immediate > 0xFFFFn && (immediate & 0xFFFFn) === 0n && hw < width / 16 - 1) {
				immediate >>= 16n
				hw++
			}
		}
		if (immediate < 0n || immediate > 0xFFFFn) fail(`Immediate ${context.value(value)} does not fit in 16 bits`, value.at)
		return word(sf(rd.wide) | (opc << 29) | 0x12800000 | (hw << 21) | (Number(immediate) << 5) | rd.n)
	}
}

const moveWideForm = (opc: number): Form => (operands, at) => {
	count(operands, at, 2, 3)
	const shift = shiftOperand(operands[2])
	if (operands[2] && (!shift || shift.shift !== SHIFT_LSL)) fail('Expected lsl #16, #32 or #48', operands[2].at)
	return moveWide(opc, reg(operands[0], at), imm(operands[1], at), shift)
}

/** MOV of an immediate: MOVZ, MOVN or ORR, whichever encodes it. */
function moveImmediate(rd: RegisterOperand, value: Value): Encoder {
	const width = rd.wide ? 64 : 32
	return (context) => {
		const bits = bitsOf(context, value, width)
		const wide = rd.sp ? null : encodeMoveWide(bits, width)
		if (wide) return word(sf(rd.wide) | (wide.inverted ? 0 : 0x40000000) | 0x12800000 | (wide.hw << 21) | (wide.imm16 << 5) | rd.n)
		const fields = encodeLogicalImmediate(bits, width)
		if (!fields) fail(`Immediate 0x${bits.toString(16)} cannot be moved in one instruction; use ldr ${rd.name}, =value`, value.at)
		return word(sf(rd.wide) | 0x32000000 | (fields!.n << 22) | (fields!.immr << 16) | (fields!.imms << 10) | (R_ZR << 5) | rd.n)
	}
}

const movForm: Form = (operands, at) => {
	count(operands, at, 2)
	const target = operands[0]
	if (isImmediate(operands[1])) return moveImmediate(reg(target, at, { sp: target?.kind === REGISTER && target.sp }), imm(operands[1], at))
	const source = operands[1]
	if ((target?.kind === REGISTER && target.sp) || (source?.kind === REGISTER && source.sp)) {
		// To or from SP: ADD Rd, Rn, #0.
		const rd = reg(target, at, { sp: true })
		const rn = reg(source, at, { sp: true })
		if (rd.wide !== rn.wide) fail('Operands must all be X or all be W registers', rn.at)
		return () => word(sf(rd.wide) | 0x11000000 | (rn.n << 5) | rd.n)
	}
	const rd = reg(target, at)
	return shiftedRegister(0x2A000000, rd, { ...rd, n: R_ZR, zr: true }, reg(source, at), null, at, false)
}

/** A bitfield instruction from its immr and imms; opc SBFM 0, BFM 1, UBFM 2. */
function bitfield(opc: number, rd: RegisterOperand, rn: RegisterOperand, fields: (context: EncodeContext, width: number) => { immr: number, imms: number }): Encoder {
	const width = rd.wide ? 64 : 32
	return (context) => {
		const { immr, imms } = fields(context, width)
		return word(sf(rd.wide) | (opc << 29) | 0x13000000 | (rd.wide ? 1 << 22 : 0) | (immr << 16) | (imms << 10) | (rn.n << 5) | rd.n)
	}
}

/** Two registers of one width; the source may be W where `narrowSource` allows. */
function pair(operands: Operand[], at: Position, narrowSource = false): [RegisterOperand, RegisterOperand] {
	const rd = reg(operands[0], at)
	const rn = reg(operands[1], at)
	if (!narrowSource && rd.wide !== rn.wide) fail('Operands must all be X or all be W registers', rn.at)
	return [rd, rn]
}

/** LSL/LSR/ASR/ROR by an immediate or a register. */
const shiftForm = (kind: 'lsl' | 'lsr' | 'asr' | 'ror'): Form => (operands, at) => {
	count(operands, at, 3)
	const [rd, rn] = pair(operands, at)
	if (!isImmediate(operands[2])) {
		const rm = reg(operands[2], at)
		sameWidth([rd, rn, rm])
		const opcode = { lsl: 8, lsr: 9, asr: 10, ror: 11 }[kind]
		return () => word(sf(rd.wide) | 0x1AC00000 | (rm.n << 16) | (opcode << 10) | (rn.n << 5) | rd.n)
	}
	const value = imm(operands[2], at)
	if (kind === 'ror') {
		return (context) => {
			const amount = ranged(context, value, 0, rd.wide ? 63 : 31, 'Rotate')
			return word(sf(rd.wide) | 0x13800000 | (rd.wide ? 1 << 22 : 0) | (rn.n << 16) | (amount << 10) | (rn.n << 5) | rd.n)
		}
	}
	return bitfield(kind === 'asr' ? 0 : 2, rd, rn, (context, width) => {
		const shift = ranged(context, value, 0, width - 1, 'Shift')
		if (kind === 'lsl') return { immr: (width - shift) % width, imms: width - 1 - shift }
		return { immr: shift, imms: width - 1 }
	})
}

/** UBFX/SBFX/BFXIL (extract) and UBFIZ/SBFIZ/BFI (insert): lsb and width. */
const fieldForm = (opc: number, insert: boolean, clear = false): Form => (operands, at) => {
	count(operands, at, clear ? 3 : 4)
	const rd = reg(operands[0], at)
	const rn = clear ? { ...rd, n: R_ZR, zr: true } : reg(operands[1], at)
	if (rd.wide !== rn.wide) fail('Operands must all be X or all be W registers', rn.at)
	const lsbValue = imm(operands[clear ? 1 : 2], at)
	const widthValue = imm(operands[clear ? 2 : 3], at)
	return bitfield(opc, rd, rn, (context, size) => {
		const lsb = ranged(context, lsbValue, 0, size - 1, 'Bit position')
		const width = ranged(context, widthValue, 1, size - lsb, 'Field width')
		return insert ? { immr: (size - lsb) % size, imms: width - 1 } : { immr: lsb, imms: lsb + width - 1 }
	})
}

/** UBFM/SBFM/BFM with explicit immr and imms. */
const bitfieldForm = (opc: number): Form => (operands, at) => {
	count(operands, at, 4)
	const [rd, rn] = pair(operands, at)
	const immr = imm(operands[2], at)
	const imms = imm(operands[3], at)
	return bitfield(opc, rd, rn, (context, width) => ({ immr: ranged(context, immr, 0, width - 1, 'immr'), imms: ranged(context, imms, 0, width - 1, 'imms') }))
}

/** SXTB/SXTH/SXTW/UXTB/UXTH: a bitfield from bit 0 of a W source. */
const extendForm = (opc: number, top: number, wideOnly: boolean, narrowOnly: boolean): Form => (operands, at) => {
	count(operands, at, 2)
	const rd = reg(operands[0], at)
	const rn = reg(operands[1], at, { wide: false })
	if (wideOnly && !rd.wide) fail('Expected an X destination', rd.at)
	if (narrowOnly && rd.wide) fail('Expected a W destination', rd.at)
	return bitfield(opc, rd, rn, () => ({ immr: 0, imms: top }))
}

const extrForm: Form = (operands, at) => {
	count(operands, at, 4)
	const rd = reg(operands[0], at)
	const rn = reg(operands[1], at)
	const rm = reg(operands[2], at)
	sameWidth([rd, rn, rm])
	const value = imm(operands[3], at)
	return (context) => {
		const lsb = ranged(context, value, 0, rd.wide ? 63 : 31, 'Bit position')
		return word(sf(rd.wide) | 0x13800000 | (rd.wide ? 1 << 22 : 0) | (rm.n << 16) | (lsb << 10) | (rn.n << 5) | rd.n)
	}
}

/** MADD-class: o0 at bit 15, op31 at 21; `long` takes W sources into an X result; `accumulate` false fixes Ra to ZR. */
const multiplyForm = (base: number, long: boolean, accumulate: boolean, wideOnly = false): Form => (operands, at) => {
	count(operands, at, accumulate ? 4 : 3)
	const rd = reg(operands[0], at, long || wideOnly ? { wide: true } : {})
	const rn = reg(operands[1], at, long ? { wide: false } : {})
	const rm = reg(operands[2], at, long ? { wide: false } : {})
	if (!long) sameWidth([rd, rn, rm])
	const ra = accumulate ? reg(operands[3], at, { wide: rd.wide }) : { n: R_ZR }
	return () => word((long || wideOnly ? 0x80000000 : sf(rd.wide)) | base | (rm.n << 16) | (ra.n << 10) | (rn.n << 5) | rd.n)
}

/** Two-source: UDIV/SDIV/LSLV/LSRV/ASRV/RORV by opcode. */
const twoSourceForm = (opcode: number): Form => (operands, at) => {
	count(operands, at, 3)
	const rd = reg(operands[0], at)
	const rn = reg(operands[1], at)
	const rm = reg(operands[2], at)
	sameWidth([rd, rn, rm])
	return () => word(sf(rd.wide) | 0x1AC00000 | (rm.n << 16) | (opcode << 10) | (rn.n << 5) | rd.n)
}

/** One-source by opcode, which for REV depends on the width. */
const oneSourceForm = (opcode: (wide: boolean) => number, wideOnly = false): Form => (operands, at) => {
	count(operands, at, 2)
	const [rd, rn] = pair(operands, at)
	if (wideOnly && !rd.wide) fail('Expected X registers', rd.at)
	return () => word(sf(rd.wide) | 0x5AC00000 | (opcode(rd.wide) << 10) | (rn.n << 5) | rd.n)
}

/** CSEL family: op at bit 30, o2 at bit 10. */
const conditionalSelectForm = (base: number): Form => (operands, at) => {
	count(operands, at, 4)
	const rd = reg(operands[0], at)
	const rn = reg(operands[1], at)
	const rm = reg(operands[2], at)
	sameWidth([rd, rn, rm])
	const cond = condition(operands[3], at)
	return () => word(sf(rd.wide) | base | (rm.n << 16) | (cond << 12) | (rn.n << 5) | rd.n)
}

/** CSET/CSETM (no source) and CINC/CINV/CNEG (one): the select with the condition inverted. */
const conditionalAliasForm = (base: number, withSource: boolean): Form => (operands, at) => {
	count(operands, at, withSource ? 3 : 2)
	const rd = reg(operands[0], at)
	const rn = withSource ? reg(operands[1], at) : { ...rd, n: R_ZR }
	if (rd.wide !== rn.wide) fail('Operands must all be X or all be W registers', rn.at)
	const cond = condition(operands[withSource ? 2 : 1], at)
	if (cond >= 14) fail('The condition may not be al or nv here', operands[withSource ? 2 : 1].at)
	return () => word(sf(rd.wide) | base | (rn.n << 16) | ((cond ^ 1) << 12) | (rn.n << 5) | rd.n)
}

/** CCMP/CCMN Rn, Rm or #imm5, #nzcv, cond. */
const conditionalCompareForm = (sub: boolean): Form => (operands, at) => {
	count(operands, at, 4)
	const rn = reg(operands[0], at)
	const nzcv = imm(operands[2], at)
	const cond = condition(operands[3], at)
	const base = sf(rn.wide) | (sub ? 0x40000000 : 0) | 0x3A400000 | (cond << 12) | (rn.n << 5)
	if (isImmediate(operands[1])) {
		const value = imm(operands[1], at)
		return (context) => word(base | (ranged(context, value, 0, 31, 'Immediate') << 16) | 0x800 | ranged(context, nzcv, 0, 15, 'NZCV'))
	}
	const rm = reg(operands[1], at)
	sameWidth([rn, rm])
	return (context) => word(base | (rm.n << 16) | ranged(context, nzcv, 0, 15, 'NZCV'))
}

/* ---------------------------------------------------------------- branches */

/** A branch target: a label or an address. */
function target(operand: Operand | undefined, at: Position): Value {
	if (operand?.kind === EXPRESSION || operand?.kind === IMMEDIATE) return operand.value
	return fail('Expected a label', operand?.at ?? at)
}

const branchForm = (base: number): Form => (operands, at) => {
	count(operands, at, 1)
	const value = target(operands[0], at)
	return (context) => word(base | relative(context, value, 26, 4, 'Branch'))
}

const conditionalBranchForm = (cond: number): Form => (operands, at) => {
	count(operands, at, 1)
	const value = target(operands[0], at)
	return (context) => word(0x54000000 | (relative(context, value, 19, 4, 'Branch') << 5) | cond)
}

const compareBranchForm = (nonzero: boolean): Form => (operands, at) => {
	count(operands, at, 2)
	const rt = reg(operands[0], at)
	const value = target(operands[1], at)
	return (context) => word(sf(rt.wide) | 0x34000000 | (nonzero ? 1 << 24 : 0) | (relative(context, value, 19, 4, 'Branch') << 5) | rt.n)
}

const testBranchForm = (nonzero: boolean): Form => (operands, at) => {
	count(operands, at, 3)
	const rt = reg(operands[0], at)
	const bitValue = imm(operands[1], at)
	const value = target(operands[2], at)
	return (context) => {
		const bit = ranged(context, bitValue, 0, rt.wide ? 63 : 31, 'Bit')
		return word(((bit >> 5) << 31) | 0x36000000 | (nonzero ? 1 << 24 : 0) | ((bit & 31) << 19) | (relative(context, value, 14, 4, 'Branch') << 5) | rt.n)
	}
}

const registerBranchForm = (base: number, optional: boolean): Form => (operands, at) => {
	count(operands, at, optional ? 0 : 1, 1)
	const rn = operands[0] ? reg(operands[0], at, { wide: true }).n : R_LR
	return () => word(base | (rn << 5))
}

const exceptionForm = (base: number, optional = false): Form => (operands, at) => {
	count(operands, at, optional ? 0 : 1, 1)
	const value = operands[0] ? imm(operands[0], at) : null
	return (context) => word(base | ((value ? ranged(context, value, 0, 0xFFFF, 'Immediate') : 0) << 5))
}

const adrForm = (page: boolean): Form => (operands, at) => {
	count(operands, at, 2)
	const rd = reg(operands[0], at, { wide: true })
	const value = target(operands[1], at)
	return (context) => {
		let offset: bigint
		if (page) {
			const here = BigInt(context.dot) & ~0xFFFn
			const there = context.value(value) & ~0xFFFn
			offset = (there - here) >> 12n
		} else {
			offset = context.value(value) - BigInt(context.dot)
		}
		if (offset < -(1n << 20n) || offset >= 1n << 20n) fail(`${page ? 'adrp' : 'adr'} target is out of range`, value.at)
		const bits = Number(BigInt.asUintN(21, offset))
		return word((page ? 0x90000000 : 0x10000000) | ((bits & 3) << 29) | ((bits >> 2) << 5) | rd.n)
	}
}

/* ------------------------------------------------------------- loads and stores */

/** A load or store of one register: opc STORE 0, LOAD 1, SIGNED64 2, SIGNED32 3. */
interface Access {
	/** Bytes moved, or 0 to take it from the register: 8 for X, 4 for W. */
	size: number
	/** Store, load, or a signed load whose width the register picks. */
	kind: 'store' | 'load' | 'signed'
	/** Only the 9-bit unscaled offset form: LDUR and friends. */
	unscaled?: boolean
	/** The register must be X (LDRSW) or W (byte and halfword zero-extends). */
	wide?: boolean
}

function accessOpc(access: Access, rt: RegisterOperand): number {
	if (access.kind === 'store') return 0
	if (access.kind === 'load') return 1
	return rt.wide ? 2 : 3
}

function indexOption(memory: MemoryOperand, size: number): (context: EncodeContext) => { option: number, scaled: boolean } {
	const index = memory.index!
	if (index.sp) fail(`${index.name} is not allowed as an index`, index.at)
	const modifier = memory.modifier
	let option: number
	if (!modifier) option = EXTEND_UXTX
	else if (modifier.kind === SHIFT) {
		if (modifier.shift !== SHIFT_LSL) fail('An index may only be shifted by lsl', modifier.at)
		option = EXTEND_UXTX
	} else {
		option = (modifier as ExtendOperand).extend
		if (option !== EXTEND_UXTW && option !== EXTEND_SXTW && option !== EXTEND_SXTX && option !== EXTEND_UXTX) fail('An index is extended by uxtw, sxtw or sxtx', modifier.at)
	}
	const wantsX = option === EXTEND_UXTX || option === EXTEND_SXTX
	if (index.wide !== wantsX) fail(`The index must be ${wantsX ? 'an X' : 'a W'} register here`, index.at)
	const scale = Math.log2(size)
	return (context) => {
		const amountValue = modifier?.amount ?? null
		if (!amountValue) return { option, scaled: false }
		const amount = ranged(context, amountValue, 0, scale, 'Index shift')
		if (amount !== 0 && amount !== scale) fail(`The index shift must be 0 or ${scale}`, amountValue.at)
		// A byte access names its #0 explicitly in S.
		return { option, scaled: size === 1 || amount === scale }
	}
}

const loadStoreForm = (access: Access): Form => (operands, at, environment) => {
	count(operands, at, 2)
	if (operands[0]?.kind === FP_REGISTER) return fpLoadStore(access, operands[0], operands[1], at)
	const rt = reg(operands[0], at, access.wide === undefined ? {} : { wide: access.wide })
	const size = access.size || (rt.wide ? 8 : 4)
	const opc = accessOpc(access, rt)
	const sizeBits = Math.log2(size) << 30
	const address = operands[1]
	return addressing(address, size, sizeBits, opc, rt.n, access, at, () => {
		if (access.kind === 'store' || access.unscaled || (size < 4)) fail('Only ldr and ldrsw load from a label or a literal', address!.at)
		const literalOpc = access.kind === 'signed' ? 2 : rt.wide ? 1 : 0
		if (address!.kind === LITERAL) {
			const exact = address!.value.exact
			if (exact !== null && access.kind !== 'signed') {
				// GNU uses a MOV where one encodes the constant.
				const width = rt.wide ? 64 : 32
				const bits = BigInt.asUintN(width, exact)
				if (encodeMoveWide(bits, width) || encodeLogicalImmediate(bits, width)) return moveImmediate(rt, address!.value)
			}
			const slot = environment.pool(access.kind === 'signed' ? 4 : size, address!.value)
			return (context) => {
				const offset = BigInt(context.slot(slot) - context.dot)
				if (offset >= 1n << 20n || offset < -(1n << 20n)) fail('The literal pool is out of range; add .ltorg nearer', address!.at)
				return word((literalOpc << 30) | 0x18000000 | (Number(BigInt.asUintN(19, offset / 4n)) << 5) | rt.n)
			}
		}
		const value = (address as { value: Value }).value
		return (context) => word((literalOpc << 30) | 0x18000000 | (relative(context, value, 19, 4, 'Literal') << 5) | rt.n)
	})
}

/** LDR/STR/LDUR/STUR of B, H, S, D or Q: the integer forms with V (bit 26) set. */
function fpLoadStore(access: Access, rt: FpRegisterOperand, address: Operand, at: Position): Encoder {
	if (access.kind === 'signed' || access.size) fail(`${rt.name} is not loaded or stored by this instruction; use ldr, str, ldur or stur`, rt.at)
	const size = rt.size
	const opc = (access.kind === 'store' ? 0 : 1) | (size === 16 ? 2 : 0)
	const sizeBits = (size === 16 ? 0 : Math.log2(size)) << 30
	return addressing(address, size, sizeBits | 0x04000000, opc, rt.n, access, at, () => {
		if (access.kind === 'store' || access.unscaled || size < 4 || address.kind === LITERAL) fail('Only ldr of S, D or Q loads from a label', address.at)
		const value = (address as { value: Value }).value
		const literalOpc = size === 4 ? 0 : size === 8 ? 1 : 2
		return (context) => word((literalOpc << 30) | 0x1C000000 | (relative(context, value, 19, 4, 'Literal') << 5) | rt.n)
	})
}

/** A one-register load or store's address forms; `literal` makes a label or `=` form. `base` holds the size and V bits. */
function addressing(address: Operand | undefined, size: number, base: number, opc: number, rt: number, access: Access, at: Position, literal: () => Encoder): Encoder {
	if (address?.kind === LITERAL || address?.kind === EXPRESSION || address?.kind === IMMEDIATE) return literal()
	if (address?.kind !== MEMORY) return fail('Expected an address in brackets', address?.at ?? at)
	const rn = address.base.n
	if (address.index) {
		if (access.unscaled) fail(`${access.kind === 'store' ? 'stur' : 'ldur'} takes an immediate offset`, address.at)
		const options = indexOption(address, size)
		const rm = address.index.n
		return (context) => {
			const { option, scaled } = options(context)
			return word(base | 0x38200800 | (opc << 22) | (rm << 16) | (option << 13) | (scaled ? 1 << 12 : 0) | (rn << 5) | rt)
		}
	}
	const unscaled = (offset: number, mode: number) => word(base | 0x38000000 | (opc << 22) | ((offset & 0x1FF) << 12) | (mode << 10) | (rn << 5) | rt)
	if (address.post || address.writeback) {
		if (access.unscaled) fail('ldur and stur do not write back', address.at)
		const value = address.post ?? address.offset
		const post = address.post !== null
		return (context) => unscaled(value ? ranged(context, value, -256, 255, 'Offset') : 0, post ? 1 : 3)
	}
	const value = address.offset
	return (context) => {
		const offset = value ? Number(context.value(value)) : 0
		if (!access.unscaled && offset >= 0 && offset % size === 0 && offset / size <= 0xFFF) {
			return word(base | 0x39000000 | (opc << 22) | ((offset / size) << 10) | (rn << 5) | rt)
		}
		if (offset < -256 || offset > 255) {
			fail(access.unscaled ? `Offset ${offset} is out of range -256 to 255` : `Offset ${offset} is neither a multiple of ${size} from 0 to ${size * 4095} nor in -256 to 255`, value!.at)
		}
		return unscaled(offset, 0)
	}
}

/** LDP/STP/LDPSW: opc 32-bit 0, LDPSW 1, 64-bit 2. */
const pairForm = (load: boolean, signed = false): Form => (operands, at) => {
	count(operands, at, 3)
	let size: number, opc: number, vector = 0, first: number, second: number
	if (operands[0]?.kind === FP_REGISTER && !signed) {
		// S, D or Q pairs: opc 0, 1, 2 with V set.
		const rt = fpReg(operands[0], at, [4, 8, 16])
		const rt2 = fpReg(operands[1], at, [rt.size])
		size = rt.size
		opc = Math.log2(size) - 2
		vector = 0x04000000
		first = rt.n
		second = rt2.n
	} else {
		const rt = reg(operands[0], at, signed ? { wide: true } : {})
		const rt2 = reg(operands[1], at, { wide: rt.wide })
		size = signed ? 4 : rt.wide ? 8 : 4
		opc = signed ? 1 : rt.wide ? 2 : 0
		first = rt.n
		second = rt2.n
	}
	const address = operands[2]
	if (address?.kind !== MEMORY || address.index) return fail('Expected [base], [base, #offset], [base, #offset]! or [base], #offset', address?.at ?? at)
	const index = address.post ? 1 : address.writeback ? 3 : 2
	const value = address.post ?? address.offset
	const rn = address.base.n
	return (context) => {
		const offset = value ? Number(context.value(value)) : 0
		if (offset % size !== 0 || offset / size < -64 || offset / size > 63) fail(`Offset ${offset} must be a multiple of ${size} from ${-64 * size} to ${63 * size}`, value?.at ?? at)
		return word((opc << 30) | vector | 0x28000000 | (index << 23) | (load ? 1 << 22 : 0) | (((offset / size) & 0x7F) << 15) | (second << 10) | (rn << 5) | first)
	}
}

/* ----------------------------------------------------------- floating point */

const SIZE_NAMES: Readonly<Record<number, string>> = { 1: 'B', 2: 'H', 4: 'S', 8: 'D', 16: 'Q' }

/** A SIMD&FP register of one of `sizes` bytes; scalar arithmetic takes S and D. */
function fpReg(operand: Operand | undefined, at: Position, sizes: readonly number[] = [4, 8]): FpRegisterOperand {
	if (operand?.kind !== FP_REGISTER) return fail(`Expected ${sizes.map((size) => `an ${SIZE_NAMES[size]}`).join(' or ')} register`, operand?.at ?? at)
	if (!sizes.includes(operand.size)) fail(`Expected ${sizes.map((size) => `an ${SIZE_NAMES[size]}`).join(' or ')} register, not ${operand.name}`, operand.at)
	return operand
}

/** Operands all the size of the first. */
function fpRegs(operands: Operand[], at: Position, wanted: number): FpRegisterOperand[] {
	count(operands, at, wanted)
	const first = fpReg(operands[0], at)
	return [first, ...operands.slice(1).map((operand) => fpReg(operand, at, [first.size]))]
}

/** The ftype field: 0 for single, 1 for double. */
const ftype = (register: FpRegisterOperand) => (register.size === 8 ? 1 : 0) << 22

/** A real immediate as `size` bytes of IEEE bits; an integer reads as its value. */
function realBits(context: EncodeContext, value: Value, size: number): bigint {
	const real = value.real ?? Number(context.value(value))
	return numberToBits(real, size === 8 ? DOUBLE : SINGLE)
}

const fpOneSourceForm = (opcode: number): Form => (operands, at) => {
	const [rd, rn] = fpRegs(operands, at, 2)
	return () => word(0x1E204000 | ftype(rd) | (opcode << 15) | (rn.n << 5) | rd.n)
}

const fpTwoSourceForm = (opcode: number): Form => (operands, at) => {
	const [rd, rn, rm] = fpRegs(operands, at, 3)
	return () => word(0x1E200800 | ftype(rd) | (rm.n << 16) | (opcode << 12) | (rn.n << 5) | rd.n)
}

/** FMADD and friends: `o1o0` picks which. */
const fpThreeSourceForm = (o1o0: number): Form => (operands, at) => {
	const [rd, rn, rm, ra] = fpRegs(operands, at, 4)
	return () => word(0x1F000000 | ftype(rd) | ((o1o0 >> 1) << 21) | (rm.n << 16) | ((o1o0 & 1) << 15) | (ra.n << 10) | (rn.n << 5) | rd.n)
}

/** FCVT between S and D. */
const fcvtForm: Form = (operands, at) => {
	count(operands, at, 2)
	const rd = fpReg(operands[0], at)
	const rn = fpReg(operands[1], at, [rd.size === 8 ? 4 : 8])
	return () => word(0x1E204000 | ftype(rn) | ((rd.size === 8 ? 5 : 4) << 15) | (rn.n << 5) | rd.n)
}

/** FCMP/FCMPE with a register or #0.0. */
const fpCompareForm = (signal: boolean): Form => (operands, at) => {
	count(operands, at, 2)
	const rn = fpReg(operands[0], at)
	const kind = signal ? 0x10 : 0
	if (operands[1]?.kind === FP_REGISTER) {
		const rm = fpReg(operands[1], at, [rn.size])
		return () => word(0x1E202000 | ftype(rn) | (rm.n << 16) | (rn.n << 5) | kind)
	}
	const zero = imm(operands[1], at)
	return (context) => {
		if (BigInt.asUintN(63, realBits(context, zero, 8)) !== 0n) fail('Only #0.0 compares without a register', zero.at)
		return word(0x1E202008 | ftype(rn) | (rn.n << 5) | kind)
	}
}

const fpConditionalCompareForm = (signal: boolean): Form => (operands, at) => {
	count(operands, at, 4)
	const rn = fpReg(operands[0], at)
	const rm = fpReg(operands[1], at, [rn.size])
	const nzcv = imm(operands[2], at)
	const cond = condition(operands[3], at)
	return (context) => word(0x1E200400 | ftype(rn) | (rm.n << 16) | (cond << 12) | (rn.n << 5) | (signal ? 0x10 : 0) | ranged(context, nzcv, 0, 15, 'Flags'))
}

const fcselForm: Form = (operands, at) => {
	count(operands, at, 4)
	const [rd, rn, rm] = fpRegs(operands.slice(0, 3), at, 3)
	const cond = condition(operands[3], at)
	return () => word(0x1E200C00 | ftype(rd) | (rm.n << 16) | (cond << 12) | (rn.n << 5) | rd.n)
}

/** FMOV between FP registers, to and from general ones, and of an immediate. */
const fmovForm: Form = (operands, at) => {
	count(operands, at, 2)
	const [first, second] = operands
	if (first?.kind === REGISTER) {
		const rd = reg(first, at)
		const rn = fpReg(second, at, [rd.wide ? 8 : 4])
		return () => word(sf(rd.wide) | (rd.wide ? 0x1E660000 : 0x1E260000) | (rn.n << 5) | rd.n)
	}
	const rd = fpReg(first, at)
	if (second?.kind === REGISTER) {
		const rn = reg(second, at, { wide: rd.size === 8 })
		return () => word(sf(rn.wide) | (rn.wide ? 0x1E670000 : 0x1E270000) | (rn.n << 5) | rd.n)
	}
	if (second?.kind === FP_REGISTER) {
		const rn = fpReg(second, at, [rd.size])
		return () => word(0x1E204000 | ftype(rd) | (rn.n << 5) | rd.n)
	}
	const value = imm(second, at)
	return (context) => {
		const bits = realBits(context, value, rd.size)
		// +0.0 has no 8-bit form; GNU moves the zero register instead.
		if (bits === 0n) return word(sf(rd.size === 8) | (rd.size === 8 ? 0x1E670000 : 0x1E270000) | (31 << 5) | rd.n)
		const imm8 = encodeImm8(bits, rd.size === 8 ? DOUBLE : SINGLE)
		if (imm8 < 0) fail(`${value.real ?? context.value(value)} is not ±(16 to 31)/16 × 2^(-3 to 4); load it from memory`, value.at)
		return word(0x1E201000 | ftype(rd) | (imm8 << 13) | rd.n)
	}
}

/** SCVTF and UCVTF, with optional fraction bits. */
const intToFpForm = (unsigned: boolean): Form => (operands, at) => {
	count(operands, at, 2, 3)
	const rd = fpReg(operands[0], at)
	const rn = reg(operands[1], at)
	const opcode = unsigned ? 3 : 2
	if (operands.length === 2) return () => word(sf(rn.wide) | 0x1E200000 | ftype(rd) | (opcode << 16) | (rn.n << 5) | rd.n)
	const fbits = imm(operands[2], at)
	return (context) => {
		const bits = ranged(context, fbits, 1, rn.wide ? 64 : 32, 'Fraction bits')
		return word(sf(rn.wide) | 0x1E000000 | ftype(rd) | (opcode << 16) | ((64 - bits) << 10) | (rn.n << 5) | rd.n)
	}
}

/** FCVT[NPMZA][SU]: `rmode` 0-3, or -1 for A; FCVTZ takes fraction bits. */
const fpToIntForm = (rmode: number, unsigned: boolean): Form => (operands, at) => {
	count(operands, at, 2, rmode === 3 ? 3 : 2)
	const rd = reg(operands[0], at)
	const rn = fpReg(operands[1], at)
	const field = rmode < 0 ? (4 | (unsigned ? 1 : 0)) << 16 : (rmode << 19) | ((unsigned ? 1 : 0) << 16)
	if (operands.length === 2) return () => word(sf(rd.wide) | 0x1E200000 | ftype(rn) | field | (rn.n << 5) | rd.n)
	const fbits = imm(operands[2], at)
	return (context) => {
		const bits = ranged(context, fbits, 1, rd.wide ? 64 : 32, 'Fraction bits')
		return word(sf(rd.wide) | 0x1E000000 | ftype(rn) | field | ((64 - bits) << 10) | (rn.n << 5) | rd.n)
	}
}

const SYSTEM_REGISTERS: Readonly<Record<string, number>> = { nzcv: SYSREG_NZCV, fpcr: SYSREG_FPCR, fpsr: SYSREG_FPSR }

function systemRegister(operand: Operand | undefined, at: Position): number {
	const name = operand?.kind === EXPRESSION ? operand.name?.toLowerCase() ?? '' : ''
	const sysreg = SYSTEM_REGISTERS[name]
	if (sysreg === undefined) fail('Expected a system register: nzcv, fpcr or fpsr', operand?.at ?? at)
	return sysreg
}

const mrsForm: Form = (operands, at) => {
	count(operands, at, 2)
	const rt = reg(operands[0], at, { wide: true })
	const sysreg = systemRegister(operands[1], at)
	return () => word(0xD5300000 | (sysreg << 5) | rt.n)
}

const msrForm: Form = (operands, at) => {
	count(operands, at, 2)
	const sysreg = systemRegister(operands[0], at)
	const rt = reg(operands[1], at, { wide: true })
	return () => word(0xD5100000 | (sysreg << 5) | rt.n)
}

/** The scalar floating-point mnemonics, which the setting can switch off. */
const FP_FORMS: Readonly<Record<string, Form>> = {
	fmov: fmovForm,
	fabs: fpOneSourceForm(1), fneg: fpOneSourceForm(2), fsqrt: fpOneSourceForm(3),
	frintn: fpOneSourceForm(8), frintp: fpOneSourceForm(9), frintm: fpOneSourceForm(10), frintz: fpOneSourceForm(11),
	frinta: fpOneSourceForm(12), frintx: fpOneSourceForm(14), frinti: fpOneSourceForm(15),
	fcvt: fcvtForm,
	fmul: fpTwoSourceForm(0), fdiv: fpTwoSourceForm(1), fadd: fpTwoSourceForm(2), fsub: fpTwoSourceForm(3),
	fmax: fpTwoSourceForm(4), fmin: fpTwoSourceForm(5), fmaxnm: fpTwoSourceForm(6), fminnm: fpTwoSourceForm(7), fnmul: fpTwoSourceForm(8),
	fmadd: fpThreeSourceForm(0), fmsub: fpThreeSourceForm(1), fnmadd: fpThreeSourceForm(2), fnmsub: fpThreeSourceForm(3),
	fcmp: fpCompareForm(false), fcmpe: fpCompareForm(true), fccmp: fpConditionalCompareForm(false), fccmpe: fpConditionalCompareForm(true),
	fcsel: fcselForm,
	scvtf: intToFpForm(false), ucvtf: intToFpForm(true),
	fcvtns: fpToIntForm(0, false), fcvtnu: fpToIntForm(0, true), fcvtps: fpToIntForm(1, false), fcvtpu: fpToIntForm(1, true),
	fcvtms: fpToIntForm(2, false), fcvtmu: fpToIntForm(2, true), fcvtzs: fpToIntForm(3, false), fcvtzu: fpToIntForm(3, true),
	fcvtas: fpToIntForm(-1, false), fcvtau: fpToIntForm(-1, true),
}

/** Whether a statement needs the FPU: an FP mnemonic, an FP register, or FPCR/FPSR. */
function usesFloatingPoint(mnemonic: string, operands: Operand[]): boolean {
	if (Object.prototype.hasOwnProperty.call(FP_FORMS, mnemonic)) return true
	return operands.some((operand) => operand.kind === FP_REGISTER || (operand.kind === EXPRESSION && /^fp[cs]r$/i.test(operand.name ?? '')))
}

/* ------------------------------------------------------------------ table */

const CONDITIONAL_BRANCHES: [string, number][] = [
	'eq', 'ne', 'cs', 'cc', 'mi', 'pl', 'vs', 'vc', 'hi', 'ls', 'ge', 'lt', 'gt', 'le', 'al', 'nv', 'hs', 'lo',
].map((name) => [name, conditionCode(name)])

const FORMS: Readonly<Record<string, Form>> = {
	add: addSubForm(false, false), adds: addSubForm(false, true), sub: addSubForm(true, false), subs: addSubForm(true, true),
	cmp: compareForm(true), cmn: compareForm(false), neg: negateForm(false), negs: negateForm(true),
	adc: carryForm(0x1A000000, false), adcs: carryForm(0x3A000000, false), sbc: carryForm(0x5A000000, false), sbcs: carryForm(0x7A000000, false),
	ngc: carryForm(0x5A000000, true), ngcs: carryForm(0x7A000000, true),
	and: logicalForm(0, false), orr: logicalForm(1, false), eor: logicalForm(2, false), ands: logicalForm(3, false),
	bic: logicalForm(0, true), orn: logicalForm(1, true), eon: logicalForm(2, true), bics: logicalForm(3, true),
	tst: testForm, mvn: mvnForm, mov: movForm,
	movz: moveWideForm(2), movn: moveWideForm(0), movk: moveWideForm(3),
	lsl: shiftForm('lsl'), lsr: shiftForm('lsr'), asr: shiftForm('asr'), ror: shiftForm('ror'),
	lslv: twoSourceForm(8), lsrv: twoSourceForm(9), asrv: twoSourceForm(10), rorv: twoSourceForm(11),
	udiv: twoSourceForm(2), sdiv: twoSourceForm(3),
	sbfm: bitfieldForm(0), bfm: bitfieldForm(1), ubfm: bitfieldForm(2),
	sbfx: fieldForm(0, false), bfxil: fieldForm(1, false), ubfx: fieldForm(2, false),
	sbfiz: fieldForm(0, true), bfi: fieldForm(1, true), ubfiz: fieldForm(2, true), bfc: fieldForm(1, true, true),
	sxtb: extendForm(0, 7, false, false), sxth: extendForm(0, 15, false, false), sxtw: extendForm(0, 31, true, false),
	uxtb: extendForm(2, 7, false, true), uxth: extendForm(2, 15, false, true),
	extr: extrForm,
	madd: multiplyForm(0x1B000000, false, true), msub: multiplyForm(0x1B008000, false, true),
	mul: multiplyForm(0x1B000000, false, false), mneg: multiplyForm(0x1B008000, false, false),
	smaddl: multiplyForm(0x1B200000, true, true), smsubl: multiplyForm(0x1B208000, true, true),
	umaddl: multiplyForm(0x1BA00000, true, true), umsubl: multiplyForm(0x1BA08000, true, true),
	smull: multiplyForm(0x1B200000, true, false), smnegl: multiplyForm(0x1B208000, true, false),
	umull: multiplyForm(0x1BA00000, true, false), umnegl: multiplyForm(0x1BA08000, true, false),
	smulh: multiplyForm(0x1B400000, false, false, true), umulh: multiplyForm(0x1BC00000, false, false, true),
	rbit: oneSourceForm(() => 0), rev16: oneSourceForm(() => 1), rev32: oneSourceForm(() => 2, true), rev: oneSourceForm((wide) => wide ? 3 : 2),
	clz: oneSourceForm(() => 4), cls: oneSourceForm(() => 5),
	csel: conditionalSelectForm(0x1A800000), csinc: conditionalSelectForm(0x1A800400),
	csinv: conditionalSelectForm(0x5A800000), csneg: conditionalSelectForm(0x5A800400),
	cset: conditionalAliasForm(0x1A800400, false), csetm: conditionalAliasForm(0x5A800000, false),
	cinc: conditionalAliasForm(0x1A800400, true), cinv: conditionalAliasForm(0x5A800000, true), cneg: conditionalAliasForm(0x5A800400, true),
	ccmp: conditionalCompareForm(true), ccmn: conditionalCompareForm(false),
	b: branchForm(0x14000000), bl: branchForm(0x94000000),
	cbz: compareBranchForm(false), cbnz: compareBranchForm(true), tbz: testBranchForm(false), tbnz: testBranchForm(true),
	br: registerBranchForm(0xD61F0000, false), blr: registerBranchForm(0xD63F0000, false), ret: registerBranchForm(0xD65F0000, true),
	adr: adrForm(false), adrp: adrForm(true),
	svc: exceptionForm(0xD4000001), hlt: exceptionForm(0xD4400000), brk: exceptionForm(0xD4200000),
	nop: (operands, at) => {
		count(operands, at, 0)
		return () => 0xD503201F
	},
	ldr: loadStoreForm({ size: 0, kind: 'load' }), str: loadStoreForm({ size: 0, kind: 'store' }),
	ldrb: loadStoreForm({ size: 1, kind: 'load', wide: false }), strb: loadStoreForm({ size: 1, kind: 'store', wide: false }),
	ldrh: loadStoreForm({ size: 2, kind: 'load', wide: false }), strh: loadStoreForm({ size: 2, kind: 'store', wide: false }),
	ldrsb: loadStoreForm({ size: 1, kind: 'signed' }), ldrsh: loadStoreForm({ size: 2, kind: 'signed' }),
	ldrsw: loadStoreForm({ size: 4, kind: 'signed', wide: true }),
	ldur: loadStoreForm({ size: 0, kind: 'load', unscaled: true }), stur: loadStoreForm({ size: 0, kind: 'store', unscaled: true }),
	ldurb: loadStoreForm({ size: 1, kind: 'load', wide: false, unscaled: true }), sturb: loadStoreForm({ size: 1, kind: 'store', wide: false, unscaled: true }),
	ldurh: loadStoreForm({ size: 2, kind: 'load', wide: false, unscaled: true }), sturh: loadStoreForm({ size: 2, kind: 'store', wide: false, unscaled: true }),
	ldursb: loadStoreForm({ size: 1, kind: 'signed', unscaled: true }), ldursh: loadStoreForm({ size: 2, kind: 'signed', unscaled: true }),
	ldursw: loadStoreForm({ size: 4, kind: 'signed', wide: true, unscaled: true }),
	ldp: pairForm(true), stp: pairForm(false), ldpsw: pairForm(true, true),
	mrs: mrsForm, msr: msrForm,
	...FP_FORMS,
	...Object.fromEntries(CONDITIONAL_BRANCHES.flatMap(([name, code]) => [[`b.${name}`, conditionalBranchForm(code)], [`b${name}`, conditionalBranchForm(code)]])),
}

/** Every mnemonic the assembler accepts, for the editor. */
export const A64_MNEMONICS: readonly string[] = Object.freeze(Object.keys(FORMS).filter((name) => !/^b(?:eq|ne|cs|cc|mi|pl|vs|vc|hi|ls|ge|lt|gt|le|al|nv|hs|lo)$/.test(name)).sort())

export const isMnemonic = (name: string) => Object.prototype.hasOwnProperty.call(FORMS, name.toLowerCase())

/** How to encode `mnemonic` with `operands`; throws a positioned error for what is wrong now. */
export function encoderFor(mnemonic: string, operands: Operand[], at: Position, environment: EncodeEnvironment): Encoder {
	const lower = mnemonic.toLowerCase()
	const form = FORMS[lower]
	if (!form) return fail(`Unknown instruction ${mnemonic}`, at)
	if (environment.floatingPoint === false && usesFloatingPoint(lower, operands)) fail(`${mnemonic} needs floating point, which is off in the settings`, at)
	return form(operands, at, environment)
}
