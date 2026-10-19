/**
 * Per-instruction facts for shared tools (statistics, branch history, cache,
 * pipeline). classifyBeta reads the state *before* the instruction runs, so
 * branch outcomes and addresses are exact even when Rc overwrites Ra.
 */

import { OPCODE_FORMAT, FORMAT_BRANCH, FORMAT_ILLEGAL, FORMAT_JMP, FORMAT_LD, FORMAT_LDR, FORMAT_OP, FORMAT_OPC, FORMAT_ST, OP_BEQ, OP_PRIV } from './isa'
import { R_LP, R_ZERO } from './registers'

/** Flag bits of BetaInstructionInfo.flags. */
export const INSN_BRANCH = 1
/** JMP: an indirect transfer. */
export const INSN_JUMP = 2
/** The branch or jump changes the PC away from PC + 4. */
export const INSN_TAKEN = 4
export const INSN_LOAD = 8
export const INSN_STORE = 16
/** A control transfer that writes LP, per the CALL convention. */
export const INSN_CALL = 32
/** JMP(LP), per the RTN convention. */
export const INSN_RETURN = 64
/** Opcode 0: the machine profile decides what it reads and writes. */
export const INSN_PRIVILEGED = 128
export const INSN_ILLEGAL = 256
export const INSN_ALU = 512

const SUPERVISOR = 0x80000000
const ADDRESS_MASK = 0x7FFFFFFF

/** Filled in place by classifyBeta; reuse one per tool. */
export class BetaInstructionInfo {
	word = 0
	pc = 0
	opcode = 0
	/** One of the isa FORMAT_* constants. */
	format = FORMAT_ILLEGAL
	flags = 0
	/** Next PC when taken, for branches and jumps. */
	target = 0
	/** Byte address of a load or store, LDR included. */
	memoryAddress = 0
	/** Registers read, or -1; R31 is never reported, since it holds no value. */
	source1 = -1
	source2 = -1
	/** Register written, or -1. */
	destination = -1
}

const real = (register: number) => register === R_ZERO ? -1 : register

/** Classifies `word` about to run at `pc` with `registers` as they are now. Allocates nothing. */
export function classifyBeta(word: number, pc: number, registers: Int32Array, out: BetaInstructionInfo): BetaInstructionInfo {
	const opcode = word >>> 26
	const rc = (word >>> 21) & 31
	const ra = (word >>> 16) & 31
	const literal = (word << 16) >> 16
	const next = ((pc & SUPERVISOR) | ((pc + 4) & ADDRESS_MASK)) >>> 0
	const format = OPCODE_FORMAT[opcode]
	out.word = word | 0
	out.pc = pc >>> 0
	out.opcode = opcode
	out.format = format
	out.flags = 0
	out.target = 0
	out.memoryAddress = 0
	out.source1 = -1
	out.source2 = -1
	out.destination = -1
	switch (format) {
		case FORMAT_OP:
			out.flags = INSN_ALU
			out.source1 = real(ra)
			out.source2 = real((word >>> 11) & 31)
			out.destination = real(rc)
			break
		case FORMAT_OPC:
			out.flags = INSN_ALU
			out.source1 = real(ra)
			out.destination = real(rc)
			break
		case FORMAT_LD:
			out.flags = INSN_LOAD
			out.memoryAddress = (registers[ra] + literal) >>> 0
			out.source1 = real(ra)
			out.destination = real(rc)
			break
		case FORMAT_ST:
			out.flags = INSN_STORE
			out.memoryAddress = (registers[ra] + literal) >>> 0
			out.source1 = real(ra)
			out.source2 = real(rc)
			break
		case FORMAT_LDR:
			out.flags = INSN_LOAD
			out.memoryAddress = ((next & ADDRESS_MASK) + literal * 4) >>> 0
			out.destination = real(rc)
			break
		case FORMAT_JMP: {
			const target = (registers[ra] & 0xFFFFFFFC & (ADDRESS_MASK | pc)) >>> 0
			out.flags = INSN_JUMP | (target !== next ? INSN_TAKEN : 0) | (rc === R_LP ? INSN_CALL : 0) | (ra === R_LP && rc !== R_LP ? INSN_RETURN : 0)
			out.target = target
			out.source1 = real(ra)
			out.destination = real(rc)
			break
		}
		case FORMAT_BRANCH: {
			const taken = (registers[ra] === 0) === (opcode === OP_BEQ)
			out.flags = INSN_BRANCH | (taken ? INSN_TAKEN | (rc === R_LP ? INSN_CALL : 0) : 0)
			out.target = ((pc & SUPERVISOR) | ((next + literal * 4) & ADDRESS_MASK)) >>> 0
			out.source1 = real(ra)
			out.destination = real(rc)
			break
		}
		default:
			out.flags = opcode === OP_PRIV ? INSN_PRIVILEGED : INSN_ILLEGAL
			if (opcode === OP_PRIV) out.source1 = real(ra)
	}
	return out
}
