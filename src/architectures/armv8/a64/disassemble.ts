/**
 * A64 disassembly in GNU syntax, choosing the preferred alias wherever the
 * reference manual names one (C6.2: MOV, CMP, LSL, UBFX, CSET, MUL...).
 */

import { formatWord } from '../../../core/format'
import {
	ACCESS_SIGNED32, ACCESS_SIGNED64, ACCESS_STORE, decode, DP1_CLS, DP1_CLZ, DP1_RBIT, DP1_REV, DP1_REV16, DP1_REV32,
	DP2_ASRV, DP2_LSLV, DP2_LSRV, DP2_RORV, DP2_SDIV, DP2_UDIV, DP3_MADD, DP3_MSUB, DP3_SMADDL, DP3_SMSUBL, DP3_SMULH, DP3_UMADDL, DP3_UMSUBL,
	FPI_FCVTAS, FPI_FCVTAU, FPI_FMOV_FROM, FPI_FMOV_TO, FPI_SCVTF, FPI_UCVTF, MODE_POST, MODE_PRE, MODE_REGISTER, MODE_UNSCALED, Op, SYSREG_NAMES,
	type A64Instruction,
} from './decode'
import { DOUBLE, formatFloat, SINGLE } from '../shared/fp'
import { CONDITIONS, encodeMoveWide, EXTEND_UXTW, EXTEND_UXTX, EXTENDS, MASK32, MASK64, R_ZR, SHIFTS } from './isa'

/** X or W register `n`; 31 is the stack pointer where `sp` says so, else the zero register. */
export function registerName(n: number, wide: boolean, sp = false): string {
	if (n === 31) return sp ? (wide ? 'sp' : 'wsp') : (wide ? 'xzr' : 'wzr')
	return `${wide ? 'x' : 'w'}${n}`
}

/** An immediate as GNU writes it: small ones in decimal, the rest in hex. */
export function immediateText(value: bigint | number): string {
	const big = BigInt(value)
	const magnitude = big < 0n ? -big : big
	if (magnitude < 10n) return `#${big}`
	return `#${big < 0n ? '-' : ''}0x${magnitude.toString(16)}`
}

const target = (address: number, offset: bigint) => formatWord(Number((BigInt(address) + offset) & MASK64))

const invert = (cond: number) => cond ^ 1

function shifted(text: string, shift: number, amount: number): string {
	return amount === 0 && shift === 0 ? text : `${text}, ${SHIFTS[shift]} #${amount}`
}

function addSubImmediate(d: A64Instruction): string {
	const { sf, rd, rn, sub, setFlags, imm, amount } = d
	const value = amount ? imm >> 12n : imm
	const operand = `${immediateText(value)}${amount ? ', lsl #12' : ''}`
	if (!sub && !setFlags && amount === 0 && imm === 0n && (rd === 31 || rn === 31)) return `mov ${registerName(rd, sf, true)}, ${registerName(rn, sf, true)}`
	if (setFlags && rd === R_ZR) return `${sub ? 'cmp' : 'cmn'} ${registerName(rn, sf, true)}, ${operand}`
	return `${sub ? 'sub' : 'add'}${setFlags ? 's' : ''} ${registerName(rd, sf, !setFlags)}, ${registerName(rn, sf, true)}, ${operand}`
}

const LOGIC_NAMES = ['and', 'orr', 'eor', 'ands']

function logicalImmediate(d: A64Instruction): string {
	const { sf, rd, rn, opc, imm } = d
	if (opc === 1 && rn === R_ZR && !encodeMoveWide(imm, sf ? 64 : 32)) return `mov ${registerName(rd, sf, true)}, ${immediateText(imm)}`
	if (opc === 3 && rd === R_ZR) return `tst ${registerName(rn, sf)}, ${immediateText(imm)}`
	return `${LOGIC_NAMES[opc]} ${registerName(rd, sf, opc !== 3)}, ${registerName(rn, sf)}, ${immediateText(imm)}`
}

function moveWide(d: A64Instruction): string {
	const { sf, rd, opc, imm, amount } = d
	const width = sf ? 64 : 32
	const mask = sf ? MASK64 : MASK32
	const name = registerName(rd, sf)
	// MOV is preferred unless a zero immediate is shifted, and MOVN of a W register reads 0xFFFF.
	const alias = !(imm === 0n && amount !== 0) && !(opc === 0 && !sf && imm === 0xFFFFn)
	if (opc !== 3 && alias) {
		const value = imm << BigInt(amount)
		const written = opc === 0 ? ~value & mask : value
		return `mov ${name}, ${immediateText(width === 64 ? BigInt.asIntN(64, written) : BigInt.asIntN(32, written))}`
	}
	const mnemonic = opc === 0 ? 'movn' : opc === 2 ? 'movz' : 'movk'
	return `${mnemonic} ${name}, ${immediateText(imm)}${amount ? `, lsl #${amount}` : ''}`
}

function bitfield(d: A64Instruction): string {
	const { sf, rd, rn, opc, immr, imms } = d
	const width = sf ? 64 : 32
	const top = width - 1
	const dst = registerName(rd, sf)
	const src = registerName(rn, sf)
	if (opc === 0) {
		if (imms === top) return `asr ${dst}, ${src}, #${immr}`
		if (imms < immr) return `sbfiz ${dst}, ${src}, #${(width - immr) % width}, #${imms + 1}`
		if (immr === 0 && (imms === 7 || imms === 15 || imms === 31)) {
			return `sxt${imms === 7 ? 'b' : imms === 15 ? 'h' : 'w'} ${dst}, ${registerName(rn, false)}`
		}
		return `sbfx ${dst}, ${src}, #${immr}, #${imms - immr + 1}`
	}
	if (opc === 1) {
		if (imms < immr) {
			if (rn === R_ZR) return `bfc ${dst}, #${(width - immr) % width}, #${imms + 1}`
			return `bfi ${dst}, ${src}, #${(width - immr) % width}, #${imms + 1}`
		}
		return `bfxil ${dst}, ${src}, #${immr}, #${imms - immr + 1}`
	}
	if (imms !== top && imms + 1 === immr) return `lsl ${dst}, ${src}, #${top - imms}`
	if (imms === top) return `lsr ${dst}, ${src}, #${immr}`
	if (imms < immr) return `ubfiz ${dst}, ${src}, #${(width - immr) % width}, #${imms + 1}`
	if (!sf && immr === 0 && (imms === 7 || imms === 15)) return `uxt${imms === 7 ? 'b' : 'h'} ${dst}, ${src}`
	return `ubfx ${dst}, ${src}, #${immr}, #${imms - immr + 1}`
}

const LOGIC_REG_NAMES = [['and', 'bic'], ['orr', 'orn'], ['eor', 'eon'], ['ands', 'bics']]

function logicalRegister(d: A64Instruction): string {
	const { sf, rd, rn, rm, opc, invert: negated, shift, amount } = d
	const operand = shifted(registerName(rm, sf), shift, amount)
	if (opc === 1 && rn === R_ZR) {
		if (!negated && shift === 0 && amount === 0) return `mov ${registerName(rd, sf)}, ${registerName(rm, sf)}`
		if (negated) return `mvn ${registerName(rd, sf)}, ${operand}`
	}
	if (opc === 3 && !negated && rd === R_ZR) return `tst ${registerName(rn, sf)}, ${operand}`
	return `${LOGIC_REG_NAMES[opc][negated ? 1 : 0]} ${registerName(rd, sf)}, ${registerName(rn, sf)}, ${operand}`
}

function addSubShifted(d: A64Instruction): string {
	const { sf, rd, rn, rm, sub, setFlags, shift, amount } = d
	const operand = shifted(registerName(rm, sf), shift, amount)
	if (setFlags && rd === R_ZR) return `${sub ? 'cmp' : 'cmn'} ${registerName(rn, sf)}, ${operand}`
	if (sub && rn === R_ZR) return `neg${setFlags ? 's' : ''} ${registerName(rd, sf)}, ${operand}`
	return `${sub ? 'sub' : 'add'}${setFlags ? 's' : ''} ${registerName(rd, sf)}, ${registerName(rn, sf)}, ${operand}`
}

function addSubExtended(d: A64Instruction): string {
	const { sf, rd, rn, rm, sub, setFlags, shift: option, amount } = d
	// An X operand only for UXTX and SXTX; LSL is the preferred spelling of UXTX (UXTW in 32 bits) beside SP.
	const source = registerName(rm, sf && (option & 3) === 3)
	const lsl = (rd === 31 || rn === 31) && option === (sf ? EXTEND_UXTX : EXTEND_UXTW)
	const extend = lsl ? (amount ? `, lsl #${amount}` : '') : `, ${EXTENDS[option]}${amount ? ` #${amount}` : ''}`
	if (setFlags && rd === R_ZR) return `${sub ? 'cmp' : 'cmn'} ${registerName(rn, sf, true)}, ${source}${extend}`
	return `${sub ? 'sub' : 'add'}${setFlags ? 's' : ''} ${registerName(rd, sf, !setFlags)}, ${registerName(rn, sf, true)}, ${source}${extend}`
}

function addWithCarry(d: A64Instruction): string {
	const { sf, rd, rn, rm, sub, setFlags } = d
	if (sub && rn === R_ZR) return `ngc${setFlags ? 's' : ''} ${registerName(rd, sf)}, ${registerName(rm, sf)}`
	return `${sub ? 'sbc' : 'adc'}${setFlags ? 's' : ''} ${registerName(rd, sf)}, ${registerName(rn, sf)}, ${registerName(rm, sf)}`
}

function conditionalSelect(d: A64Instruction): string {
	const { sf, rd, rn, rm, opc, cond } = d
	const dst = registerName(rd, sf)
	const conditional = cond < 14
	if (opc === 1 || opc === 2) {
		if (rn === R_ZR && rm === R_ZR && conditional) return `${opc === 1 ? 'cset' : 'csetm'} ${dst}, ${CONDITIONS[invert(cond)]}`
		if (rn === rm && rn !== R_ZR && conditional) return `${opc === 1 ? 'cinc' : 'cinv'} ${dst}, ${registerName(rn, sf)}, ${CONDITIONS[invert(cond)]}`
	}
	if (opc === 3 && rn === rm && conditional) return `cneg ${dst}, ${registerName(rn, sf)}, ${CONDITIONS[invert(cond)]}`
	const mnemonic = ['csel', 'csinc', 'csinv', 'csneg'][opc]
	return `${mnemonic} ${dst}, ${registerName(rn, sf)}, ${registerName(rm, sf)}, ${CONDITIONS[cond]}`
}

function threeSource(d: A64Instruction): string {
	const { sf, rd, rn, rm, ra, opc } = d
	const x = (n: number) => registerName(n, true)
	const w = (n: number) => registerName(n, false)
	const r = (n: number) => registerName(n, sf)
	switch (opc) {
		case DP3_MADD: return ra === R_ZR ? `mul ${r(rd)}, ${r(rn)}, ${r(rm)}` : `madd ${r(rd)}, ${r(rn)}, ${r(rm)}, ${r(ra)}`
		case DP3_MSUB: return ra === R_ZR ? `mneg ${r(rd)}, ${r(rn)}, ${r(rm)}` : `msub ${r(rd)}, ${r(rn)}, ${r(rm)}, ${r(ra)}`
		case DP3_SMADDL: return ra === R_ZR ? `smull ${x(rd)}, ${w(rn)}, ${w(rm)}` : `smaddl ${x(rd)}, ${w(rn)}, ${w(rm)}, ${x(ra)}`
		case DP3_SMSUBL: return ra === R_ZR ? `smnegl ${x(rd)}, ${w(rn)}, ${w(rm)}` : `smsubl ${x(rd)}, ${w(rn)}, ${w(rm)}, ${x(ra)}`
		case DP3_UMADDL: return ra === R_ZR ? `umull ${x(rd)}, ${w(rn)}, ${w(rm)}` : `umaddl ${x(rd)}, ${w(rn)}, ${w(rm)}, ${x(ra)}`
		case DP3_UMSUBL: return ra === R_ZR ? `umnegl ${x(rd)}, ${w(rn)}, ${w(rm)}` : `umsubl ${x(rd)}, ${w(rn)}, ${w(rm)}, ${x(ra)}`
		case DP3_SMULH: return `smulh ${x(rd)}, ${x(rn)}, ${x(rm)}`
		default: return `umulh ${x(rd)}, ${x(rn)}, ${x(rm)}`
	}
}

const DP2_NAMES: Readonly<Record<number, string>> = { [DP2_UDIV]: 'udiv', [DP2_SDIV]: 'sdiv', [DP2_LSLV]: 'lsl', [DP2_LSRV]: 'lsr', [DP2_ASRV]: 'asr', [DP2_RORV]: 'ror' }
const DP1_NAMES: Readonly<Record<number, string>> = { [DP1_RBIT]: 'rbit', [DP1_REV16]: 'rev16', [DP1_REV32]: 'rev32', [DP1_REV]: 'rev', [DP1_CLZ]: 'clz', [DP1_CLS]: 'cls' }

/** The mnemonic of a single-register load or store, by size and access. */
export function loadStoreMnemonic(d: A64Instruction): string {
	const { size, access, mode } = d
	const unscaled = mode === MODE_UNSCALED ? 'u' : ''
	const suffix = size === 1 ? 'b' : size === 2 ? 'h' : size === 4 && (access === ACCESS_SIGNED64) ? 'w' : ''
	const base = access === ACCESS_STORE ? 'st' : 'ld'
	const signed = access === ACCESS_SIGNED64 || access === ACCESS_SIGNED32 ? 's' : ''
	return `${base}${unscaled}r${signed}${suffix}`
}

function address(d: A64Instruction): string {
	const base = registerName(d.rn, true, true)
	const offset = Number(d.imm)
	switch (d.mode) {
		case MODE_PRE: return `[${base}, #${offset}]!`
		case MODE_POST: return `[${base}], #${offset}`
		case MODE_REGISTER: {
			const option = d.shift
			const index = registerName(d.rm, (option & 1) === 1)
			const scale = d.size === 1 ? 0 : Math.log2(d.size)
			const amount = d.amount ? ` #${scale}` : ''
			if (option === EXTEND_UXTX) return `[${base}, ${index}${d.amount ? `, lsl #${scale}` : ''}]`
			return `[${base}, ${index}, ${EXTENDS[option]}${amount}]`
		}
		default: return offset === 0 ? `[${base}]` : `[${base}, #${offset}]`
	}
}

/** SIMD&FP register `n` of `size` bytes: b, h, s, d or q. */
export function fpRegisterName(n: number, size: number): string {
	return `${({ 1: 'b', 2: 'h', 4: 's', 8: 'd', 16: 'q' } as Record<number, string>)[size]}${n}`
}

/** Whether a load or store names an X register: a doubleword, or a sign extension to 64 bits. */
export const namesX = (d: A64Instruction) => d.size === 8 || d.access === ACCESS_SIGNED64

function loadStore(d: A64Instruction): string {
	if (d.fp) return `${d.access === ACCESS_STORE ? 'st' : 'ld'}${d.mode === MODE_UNSCALED ? 'u' : ''}r ${fpRegisterName(d.rd, d.size)}, ${address(d)}`
	return `${loadStoreMnemonic(d)} ${registerName(d.rd, namesX(d))}, ${address(d)}`
}

function loadStorePair(d: A64Instruction): string {
	const mnemonic = d.access === ACCESS_STORE ? 'stp' : d.access === ACCESS_SIGNED64 ? 'ldpsw' : 'ldp'
	if (d.fp) return `${mnemonic} ${fpRegisterName(d.rd, d.size)}, ${fpRegisterName(d.ra, d.size)}, ${address(d)}`
	const x = namesX(d)
	return `${mnemonic} ${registerName(d.rd, x)}, ${registerName(d.ra, x)}, ${address(d)}`
}

const FP1_NAMES: readonly string[] = ['fmov', 'fabs', 'fneg', 'fsqrt', 'fcvt', 'fcvt', '', '', 'frintn', 'frintp', 'frintm', 'frintz', 'frinta', '', 'frintx', 'frinti']
const FP2_NAMES: readonly string[] = ['fmul', 'fdiv', 'fadd', 'fsub', 'fmax', 'fmin', 'fmaxnm', 'fminnm', 'fnmul']
const FP3_NAMES: readonly string[] = ['fmadd', 'fmsub', 'fnmadd', 'fnmsub']
const ROUNDING_LETTERS = 'npmz'

/** The scalar floating-point instructions. */
function float(d: A64Instruction): string {
	const { rd, rn, rm, size } = d
	const f = (n: number, bytes = size) => fpRegisterName(n, bytes)
	switch (d.op) {
		case Op.FP_DP1: {
			if (d.opc === 4) return `fcvt ${f(rd, 4)}, ${f(rn, 8)}`
			if (d.opc === 5) return `fcvt ${f(rd, 8)}, ${f(rn, 4)}`
			return `${FP1_NAMES[d.opc]} ${f(rd)}, ${f(rn)}`
		}
		case Op.FP_DP2: return `${FP2_NAMES[d.opc]} ${f(rd)}, ${f(rn)}, ${f(rm)}`
		case Op.FP_DP3: return `${FP3_NAMES[d.opc]} ${f(rd)}, ${f(rn)}, ${f(rm)}, ${f(d.ra)}`
		case Op.FP_CMP: return `fcmp${d.opc & 2 ? 'e' : ''} ${f(rn)}, ${d.opc & 1 ? '#0.0' : f(rm)}`
		case Op.FP_CCMP: return `fccmp${d.opc ? 'e' : ''} ${f(rn)}, ${f(rm)}, #${d.imm}, ${CONDITIONS[d.cond]}`
		case Op.FP_CSEL: return `fcsel ${f(rd)}, ${f(rn)}, ${f(rm)}, ${CONDITIONS[d.cond]}`
		case Op.FP_IMM: return `fmov ${f(rd)}, #${formatFloat(d.imm, size === 8 ? DOUBLE : SINGLE)}`
	}
	// FP_INT and FP_FIXED.
	const general = (n: number) => registerName(n, d.sf)
	const fraction = d.op === Op.FP_FIXED ? `, #${d.amount}` : ''
	switch (d.opc) {
		case FPI_SCVTF: case FPI_UCVTF: return `${d.opc === FPI_SCVTF ? 's' : 'u'}cvtf ${f(rd)}, ${general(rn)}${fraction}`
		case FPI_FMOV_TO: return `fmov ${general(rd)}, ${f(rn)}`
		case FPI_FMOV_FROM: return `fmov ${f(rd)}, ${general(rn)}`
		case FPI_FCVTAS: case FPI_FCVTAU: return `fcvta${d.opc === FPI_FCVTAU ? 'u' : 's'} ${general(rd)}, ${f(rn)}`
	}
	return `fcvt${ROUNDING_LETTERS[d.shift]}${d.opc & 1 ? 'u' : 's'} ${general(rd)}, ${f(rn)}${fraction}`
}

/** One instruction word at `address`, as assembly. */
export function disassemble(word: number, address: number): string {
	const d = decode(word)
	switch (d.op) {
		case Op.ADDSUB_IMM: return addSubImmediate(d)
		case Op.LOGIC_IMM: return logicalImmediate(d)
		case Op.MOVE_WIDE: return moveWide(d)
		case Op.BITFIELD: return bitfield(d)
		case Op.EXTR: {
			const { sf, rd, rn, rm, amount } = d
			if (rn === rm) return `ror ${registerName(rd, sf)}, ${registerName(rn, sf)}, #${amount}`
			return `extr ${registerName(rd, sf)}, ${registerName(rn, sf)}, ${registerName(rm, sf)}, #${amount}`
		}
		case Op.ADR: return `adr ${registerName(d.rd, true)}, ${target(address, d.imm)}`
		case Op.ADRP: return `adrp ${registerName(d.rd, true)}, ${target(address & ~0xFFF, d.imm)}`
		case Op.B: return `b ${target(address, d.imm)}`
		case Op.BL: return `bl ${target(address, d.imm)}`
		case Op.B_COND: return `b.${CONDITIONS[d.cond]} ${target(address, d.imm)}`
		case Op.CB: return `${d.opc ? 'cbnz' : 'cbz'} ${registerName(d.rd, d.sf)}, ${target(address, d.imm)}`
		case Op.TB: return `${d.opc ? 'tbnz' : 'tbz'} ${registerName(d.rd, d.sf)}, #${d.amount}, ${target(address, d.imm)}`
		case Op.BR: return `br ${registerName(d.rn, true)}`
		case Op.BLR: return `blr ${registerName(d.rn, true)}`
		case Op.RET: return d.rn === 30 ? 'ret' : `ret ${registerName(d.rn, true)}`
		case Op.SVC: return `svc ${immediateText(d.imm)}`
		case Op.HLT: return `hlt ${immediateText(d.imm)}`
		case Op.BRK: return `brk ${immediateText(d.imm)}`
		case Op.NOP: return d.imm === 0n ? 'nop' : `hint #${d.imm}`
		case Op.LOGIC_REG: return logicalRegister(d)
		case Op.ADDSUB_SHIFT: return addSubShifted(d)
		case Op.ADDSUB_EXT: return addSubExtended(d)
		case Op.ADC: return addWithCarry(d)
		case Op.CCMP: {
			const operand = d.immediate ? `#${d.amount}` : registerName(d.amount, d.sf)
			return `${d.sub ? 'ccmp' : 'ccmn'} ${registerName(d.rn, d.sf)}, ${operand}, #${d.imm}, ${CONDITIONS[d.cond]}`
		}
		case Op.CSEL: return conditionalSelect(d)
		case Op.DP3: return threeSource(d)
		case Op.DP2: return `${DP2_NAMES[d.opc]} ${registerName(d.rd, d.sf)}, ${registerName(d.rn, d.sf)}, ${registerName(d.rm, d.sf)}`
		case Op.DP1: return `${DP1_NAMES[d.opc]} ${registerName(d.rd, d.sf)}, ${registerName(d.rn, d.sf)}`
		case Op.LOAD_STORE: return loadStore(d)
		case Op.LOAD_LITERAL: {
			if (d.fp) return `ldr ${fpRegisterName(d.rd, d.size)}, ${target(address, d.imm)}`
			const mnemonic = d.access === ACCESS_SIGNED64 ? 'ldrsw' : 'ldr'
			return `${mnemonic} ${registerName(d.rd, d.sf)}, ${target(address, d.imm)}`
		}
		case Op.LOAD_STORE_PAIR: return loadStorePair(d)
		case Op.MRS: return `mrs ${registerName(d.rd, true)}, ${SYSREG_NAMES[Number(d.imm)]}`
		case Op.MSR: return `msr ${SYSREG_NAMES[Number(d.imm)]}, ${registerName(d.rd, true)}`
		case Op.FP_DP1: case Op.FP_DP2: case Op.FP_DP3: case Op.FP_CMP: case Op.FP_CCMP: case Op.FP_CSEL: case Op.FP_IMM: case Op.FP_INT: case Op.FP_FIXED:
			return float(d)
	}
	return `.inst ${formatWord(word >>> 0)}`
}
