/**
 * Per-instruction facts for the shared tools (statistics, branch history,
 * cache, pipeline). classifyA64 reads the state *before* the instruction runs,
 * so branch outcomes and addresses are exact even when it overwrites a source.
 *
 * Registers are numbered X0-X30 as 0-30 and SP as 31, NZCV as 32, V0-V31 as
 * 33-64, then FPCR and FPSR; the zero register is never reported, since it
 * holds no value.
 */

import type { A64Cpu } from './cpu'
import { ACCESS_STORE, FPI_FMOV_FROM, FPI_SCVTF, FPI_UCVTF, MODE_POST, MODE_PRE, MODE_REGISTER, Op, SYSREG_FPCR, SYSREG_FPSR, type A64Instruction } from './decode'
import { conditionHolds, MASK64, R_LR } from './isa'

/** Flag bits of A64InstructionInfo.flags. */
export const INSN_BRANCH = 1
/** An unconditional transfer: B, BL, BR, BLR, RET. */
export const INSN_JUMP = 2
/** The transfer leaves PC + 4. */
export const INSN_TAKEN = 4
export const INSN_LOAD = 8
export const INSN_STORE = 16
/** BL or BLR. */
export const INSN_CALL = 32
export const INSN_RETURN = 64
/** SVC, HLT, BRK. */
export const INSN_TRAP = 128
export const INSN_ALU = 256

/** Filled in place by classifyA64; reuse one per tool. */
export class A64InstructionInfo {
	flags = 0
	/** Where a branch goes when taken. */
	target = 0
	/** Address of a load or store; a pair's first register. */
	memoryAddress = 0
	/** Bytes the access moves in all. */
	memorySize = 0
}

/** What `d` does to registers, whatever their values. */
export interface RegisterTraffic {
	reads: number[]
	/** All destinations, including pair loads, base writeback and NZCV. */
	writes: number[]
}

/** `n` as read where 31 is the zero register, or -1 for it. */
const zr = (n: number) => n === 31 ? -1 : n

/** Dependency numbers of NZCV, V0, FPCR and FPSR. */
export const DEPENDENCY_NZCV = 32
export const DEPENDENCY_V0 = 33
export const DEPENDENCY_FPCR = 65
export const DEPENDENCY_FPSR = 66
const vector = (n: number) => DEPENDENCY_V0 + n

/** Ops that read FPCR and may raise FPSR flags. */
const FP_ARITHMETIC = new Set([Op.FP_DP1, Op.FP_DP2, Op.FP_DP3, Op.FP_CMP, Op.FP_CCMP, Op.FP_INT, Op.FP_FIXED])

export function registerTraffic(d: A64Instruction): RegisterTraffic {
	const reads: number[] = []
	const read = (n: number) => {
		if (n >= 0 && !reads.includes(n)) reads.push(n)
	}
	const writes: number[] = []
	const write = (n: number) => { if (n >= 0 && !writes.includes(n)) writes.push(n) }
	switch (d.op) {
		case Op.ADDSUB_IMM: read(d.rn); write(d.setFlags ? zr(d.rd) : d.rd); break
		case Op.LOGIC_IMM: read(zr(d.rn)); write(d.setFlags ? zr(d.rd) : d.rd); break
		case Op.MOVE_WIDE: if (d.opc === 3) read(zr(d.rd)); write(zr(d.rd)); break
		case Op.BITFIELD: read(zr(d.rn)); if (d.opc === 1) read(zr(d.rd)); write(zr(d.rd)); break
		case Op.ADR: case Op.ADRP: write(zr(d.rd)); break
		case Op.BL: write(R_LR); break
		case Op.CB: case Op.TB: read(zr(d.rd)); break
		case Op.BR: case Op.RET: read(zr(d.rn)); break
		case Op.BLR: read(zr(d.rn)); write(R_LR); break
		case Op.SVC: for (const n of [8, 0, 1, 2]) read(n); write(0); break
		case Op.EXTR: case Op.LOGIC_REG: case Op.ADDSUB_SHIFT: case Op.ADC: case Op.DP2: case Op.CSEL:
			read(zr(d.rn)); read(zr(d.rm)); write(zr(d.rd)); break
		case Op.ADDSUB_EXT: read(d.rn); read(zr(d.rm)); write(d.setFlags ? zr(d.rd) : d.rd); break
		case Op.CCMP: read(zr(d.rn)); if (!d.immediate) read(zr(d.rm)); break
		case Op.DP3: read(zr(d.rn)); read(zr(d.rm)); read(zr(d.ra)); write(zr(d.rd)); break
		case Op.DP1: read(zr(d.rn)); write(zr(d.rd)); break
		case Op.FP_DP1: case Op.FP_IMM: if (d.op === Op.FP_DP1) read(vector(d.rn)); write(vector(d.rd)); break
		case Op.FP_DP2: case Op.FP_CSEL: read(vector(d.rn)); read(vector(d.rm)); write(vector(d.rd)); break
		case Op.FP_DP3: read(vector(d.rn)); read(vector(d.rm)); read(vector(d.ra)); write(vector(d.rd)); break
		case Op.FP_CMP: case Op.FP_CCMP: read(vector(d.rn)); if (!(d.op === Op.FP_CMP && d.opc & 1)) read(vector(d.rm)); break
		case Op.FP_INT: case Op.FP_FIXED: {
			const fromGeneral = d.opc === FPI_SCVTF || d.opc === FPI_UCVTF || d.opc === FPI_FMOV_FROM
			read(fromGeneral ? zr(d.rn) : vector(d.rn))
			write(fromGeneral ? vector(d.rd) : zr(d.rd))
			break
		}
		case Op.MRS: read(sysregDependency(Number(d.imm))); write(zr(d.rd)); break
		case Op.MSR: read(zr(d.rd)); write(sysregDependency(Number(d.imm))); break
		case Op.LOAD_LITERAL: if (d.fp) write(vector(d.rd)); else write(zr(d.rd)); break
		case Op.LOAD_STORE: case Op.LOAD_STORE_PAIR: {
			read(d.rn)
			if (d.op === Op.LOAD_STORE && d.mode === MODE_REGISTER) read(zr(d.rm))
			const data = (n: number) => d.fp ? vector(n) : zr(n)
			if (d.access === ACCESS_STORE) {
				read(data(d.rd))
				if (d.op === Op.LOAD_STORE_PAIR) read(data(d.ra))
				write(d.mode === MODE_POST || d.mode === MODE_PRE ? d.rn : -1)
			} else {
				write(data(d.rd))
				if (d.op === Op.LOAD_STORE_PAIR) write(data(d.ra))
				if (d.mode === MODE_POST || d.mode === MODE_PRE) write(d.rn)
			}
			break
		}
	}
	// Wn and Xn alias the same resource. NZCV is a separate dependency.
	if ([Op.B_COND, Op.ADC, Op.CCMP, Op.CSEL, Op.FP_CCMP, Op.FP_CSEL].includes(d.op)) read(DEPENDENCY_NZCV)
	if (d.setFlags || d.op === Op.CCMP || d.op === Op.FP_CMP || d.op === Op.FP_CCMP) write(DEPENDENCY_NZCV)
	if (FP_ARITHMETIC.has(d.op) && !(d.op === Op.FP_INT && d.opc >= 6)) {
		read(DEPENDENCY_FPCR)
		write(DEPENDENCY_FPSR)
	}
	return { reads, writes }
}

function sysregDependency(sysreg: number): number {
	return sysreg === SYSREG_FPCR ? DEPENDENCY_FPCR : sysreg === SYSREG_FPSR ? DEPENDENCY_FPSR : DEPENDENCY_NZCV
}

const LOADS_AND_STORES = new Set([Op.LOAD_STORE, Op.LOAD_LITERAL, Op.LOAD_STORE_PAIR])
const ALU = new Set([
	Op.ADDSUB_IMM, Op.LOGIC_IMM, Op.MOVE_WIDE, Op.BITFIELD, Op.EXTR, Op.ADR, Op.ADRP, Op.LOGIC_REG, Op.ADDSUB_SHIFT, Op.ADDSUB_EXT,
	Op.ADC, Op.CCMP, Op.CSEL, Op.DP3, Op.DP2, Op.DP1, Op.MRS, Op.MSR,
	Op.FP_DP1, Op.FP_DP2, Op.FP_DP3, Op.FP_CMP, Op.FP_CCMP, Op.FP_CSEL, Op.FP_IMM, Op.FP_INT, Op.FP_FIXED,
])

/** The flags `d` has regardless of state. */
export function staticFlags(d: A64Instruction): number {
	switch (d.op) {
		case Op.B: return INSN_JUMP
		case Op.BL: case Op.BLR: return INSN_JUMP | INSN_CALL
		case Op.BR: return INSN_JUMP
		case Op.RET: return INSN_JUMP | INSN_RETURN
		case Op.B_COND: case Op.CB: case Op.TB: return INSN_BRANCH
		case Op.SVC: case Op.HLT: case Op.BRK: return INSN_TRAP
	}
	if (LOADS_AND_STORES.has(d.op)) return d.access === ACCESS_STORE ? INSN_STORE : INSN_LOAD
	return ALU.has(d.op) ? INSN_ALU : 0
}

/** Classifies `d`, about to run at the CPU's PC with its registers as they are now. */
export function classifyA64(d: A64Instruction, cpu: A64Cpu, out: A64InstructionInfo): A64InstructionInfo {
	const pc = cpu.pc
	let flags = staticFlags(d)
	out.target = 0
	out.memoryAddress = 0
	out.memorySize = 0
	switch (d.op) {
		case Op.B: case Op.BL: out.target = pc + Number(d.imm); flags |= INSN_TAKEN; break
		case Op.BR: case Op.BLR: case Op.RET: out.target = Number(cpu.read(d.rn) & MASK64); flags |= INSN_TAKEN; break
		case Op.B_COND: case Op.CB: case Op.TB: {
			out.target = pc + Number(d.imm)
			let taken: boolean
			if (d.op === Op.B_COND) taken = conditionHolds(d.cond, cpu.nzcv)
			else if (d.op === Op.CB) taken = (cpu.read(d.rd, d.sf) === 0n) === (d.opc === 0)
			else taken = (((cpu.read(d.rd) >> BigInt(d.amount)) & 1n) === 0n) === (d.opc === 0)
			if (taken) flags |= INSN_TAKEN
			break
		}
		case Op.LOAD_LITERAL:
			out.memoryAddress = pc + Number(d.imm)
			out.memorySize = d.size
			break
		case Op.LOAD_STORE: case Op.LOAD_STORE_PAIR: {
			const base = cpu.readSp(d.rn)
			let address = base + d.imm
			if (d.mode === MODE_POST) address = base
			else if (d.op === Op.LOAD_STORE && d.mode === MODE_REGISTER) {
				// The index as the CPU extends it.
				const index = cpu.read(d.rm)
				const bits = 8 << (d.shift & 3)
				const extended = d.shift & 4 ? BigInt.asIntN(bits, index) : BigInt.asUintN(bits, index)
				address = base + (extended << BigInt(d.amount ? Math.log2(d.size) : 0))
			}
			out.memoryAddress = Number(BigInt.asUintN(64, address))
			out.memorySize = d.op === Op.LOAD_STORE_PAIR ? d.size * 2 : d.size
			break
		}
	}
	out.flags = flags
	return out
}
