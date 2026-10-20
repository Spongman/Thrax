/**
 * 6502 instruction metadata for the shared tools. The opaque instruction an
 * observer is handed is the opcode byte; what a tool reads of it is worked
 * out once per opcode. `classifyAt` adds what depends on the registers: the
 * data address and a branch's outcome, read before the instruction runs.
 */

import { InstructionCategory, type HistoryRecord, type InstructionInfo, type InstructionSet } from '../contracts'
import type { Mos6502Cpu } from './cpu'
import {
	ABS, ABX, ABY, ACC, ADC, AND, ASL, BCC, BCS, BEQ, BIT, BMI, BNE, BPL, BRK, BVC, BVS, CMP, CPX, CPY, DEC, DEX, DEY, EOR, IMM, INC,
	IND, INX, INY, IZX, IZY, JMP, JSR, LDA, LDX, LDY, LSR, ALL_MNEMONICS, MODE_BYTES, MODE_NAMES, NOP, OPCODE_INSN, OPCODE_MODE, ORA, PHA, PHP,
	PLA, PLP, REL, ROL, ROR, RTI, RTS, SBC, STA, STX, STY, TAX, TAY, TSX, TXA, TXS, TYA, ZP, ZPX, ZPY,
} from './isa'
import { AIX, BBR0, BBS0, BRA, NMOS_MODEL, PHX, PHY, PLX, PLY, RMB0, SMB0, STZ, TRB, TSB, ZPI, ZPR, type CpuModel } from './isa'

/** Register indices of `registerNames`. */
export const REG_A = 0
export const REG_X = 1
export const REG_Y = 2
export const REG_SP = 3
export const REG_P = 4
const REGISTER_NAMES = Object.freeze(['A', 'X', 'Y', 'SP', 'P'])

const { ALU, BRANCH, JUMP, MEMORY, OTHER, TRAP } = InstructionCategory

const LOADS = new Set([LDA, LDX, LDY, ADC, SBC, AND, ORA, EOR, CMP, CPX, CPY, BIT])
const STORES = new Set([STA, STX, STY, STZ])
const MODIFIES = new Set([ASL, LSR, ROL, ROR, INC, DEC, TRB, TSB, ...Array.from({ length: 16 }, (_, i) => RMB0 + i)])
const BRANCHES = new Set([BCC, BCS, BEQ, BNE, BMI, BPL, BVC, BVS, BRA, ...Array.from({ length: 16 }, (_, i) => BBR0 + i)])

/** The register each instruction writes, where it writes one. */
const WRITES: ReadonlyMap<number, number> = new Map([
	[LDA, REG_A], [ADC, REG_A], [SBC, REG_A], [AND, REG_A], [ORA, REG_A], [EOR, REG_A], [PLA, REG_A], [TXA, REG_A], [TYA, REG_A],
	[LDX, REG_X], [TAX, REG_X], [TSX, REG_X], [INX, REG_X], [DEX, REG_X],
	[LDY, REG_Y], [TAY, REG_Y], [INY, REG_Y], [DEY, REG_Y],
	[TXS, REG_SP], [PLP, REG_P],
	[PLX, REG_X], [PLY, REG_Y],
])

/** Registers each instruction reads, index registers of its mode aside. */
const READS: ReadonlyMap<number, readonly number[]> = new Map([
	[STA, [REG_A]], [ADC, [REG_A, REG_P]], [SBC, [REG_A, REG_P]], [AND, [REG_A]], [ORA, [REG_A]], [EOR, [REG_A]], [CMP, [REG_A]], [BIT, [REG_A]],
	[PHA, [REG_A, REG_SP]], [TAX, [REG_A]], [TAY, [REG_A]],
	[STX, [REG_X]], [CPX, [REG_X]], [TXA, [REG_X]], [TXS, [REG_X]], [INX, [REG_X]], [DEX, [REG_X]],
	[STY, [REG_Y]], [CPY, [REG_Y]], [TYA, [REG_Y]], [INY, [REG_Y]], [DEY, [REG_Y]],
	[TSX, [REG_SP]], [PLA, [REG_SP]], [PLP, [REG_SP]], [PHP, [REG_P, REG_SP]], [JSR, [REG_SP]], [RTS, [REG_SP]], [RTI, [REG_SP]], [BRK, [REG_P, REG_SP]],
	[ROL, [REG_P]], [ROR, [REG_P]],
	[PHX, [REG_X, REG_SP]], [PHY, [REG_Y, REG_SP]], [PLX, [REG_SP]], [PLY, [REG_SP]], [TRB, [REG_A]], [TSB, [REG_A]],
	...[...BRANCHES].map((insn): [number, number[]] => [insn, [REG_P]]),
])

function categoryOf(insn: number): number {
	if (BRANCHES.has(insn)) return BRANCH
	if (insn === JMP || insn === JSR || insn === RTS || insn === RTI) return JUMP
	if (insn === BRK) return TRAP
	if (insn === LDA || insn === LDX || insn === LDY || STORES.has(insn) || insn === PHA || insn === PHP || insn === PLA || insn === PLP) return MEMORY
	if (insn === NOP) return OTHER
	return ALU
}

function infoOf(opcode: number, model: CpuModel = NMOS_MODEL): InstructionInfo {
	const insn = model.instructions[opcode]
	if (insn < 0) return { mnemonic: 'ILLEGAL', category: OTHER, encoding: 0, reads: [], writes: -1, isLoad: false, isBranch: false, isJump: false }
	const mode = model.modes[opcode]
	const reads = new Set(READS.get(insn) ?? [])
	if (mode === ZPX || mode === ABX || mode === IZX || mode === AIX) reads.add(REG_X)
	if (mode === ZPY || mode === ABY || mode === IZY) reads.add(REG_Y)
	if (mode === ACC) reads.add(REG_A)
	return {
		mnemonic: ALL_MNEMONICS[insn],
		category: categoryOf(insn),
		encoding: mode,
		reads: [...reads],
		writes: mode === ACC ? REG_A : WRITES.get(insn) ?? -1,
		isLoad: mode !== IMM && (LOADS.has(insn) || (MODIFIES.has(insn) && mode !== ACC) || mode === ZPR),
		isBranch: BRANCHES.has(insn),
		isJump: insn === JMP || insn === JSR || insn === RTS || insn === RTI,
	}
}

const INFO: readonly InstructionInfo[] = Array.from({ length: 256 }, (_, opcode) => Object.freeze(infoOf(opcode)))

export const describeOpcode = (opcode: number) => INFO[opcode & 0xFF]

/** A history record that carries the opcode it ran. */
export interface Mos6502Executed extends HistoryRecord {
	/** The vector, for an interrupt. */
	readonly opcode: number
	readonly interrupt?: boolean
}

export const mos6502InstructionSet: InstructionSet = {
	encodings: MODE_NAMES,
	registerNames: REGISTER_NAMES,
	describe: (instruction) => describeOpcode(instruction as number),
	decodeExecuted(entry) {
		const { kind, opcode, interrupt } = entry as Mos6502Executed
		return kind === 'instruction' && !interrupt ? opcode : null
	},
}
const sets = new Map<CpuModel, InstructionSet>([[NMOS_MODEL, mos6502InstructionSet]])
export function instructionSetFor(model: CpuModel): InstructionSet {
	let set = sets.get(model)
	if (!set) {
		const info = Array.from({ length: 256 }, (_, opcode) => Object.freeze(infoOf(opcode, model)))
		set = { ...mos6502InstructionSet, describe: instruction => info[(instruction as number) & 255] }
		sets.set(model, set)
	}
	return set
}

/** Flag bits of Mos6502Access.flags. */
export const ACCESS_READ = 1
export const ACCESS_WRITE = 2
export const ACCESS_BRANCH = 4
export const ACCESS_TAKEN = 8
export const ACCESS_CALL = 16

/** What the instruction about to run touches; filled in place by classifyAt. */
export class Mos6502Access {
	opcode = 0
	flags = 0
	/** Data address of a read or write. */
	address = 0
	/** A branch's target, taken or not. */
	target = 0
}

/** Classifies the instruction at the CPU's PC, before it runs. Allocates nothing. */
export function classifyAt(cpu: Mos6502Cpu, out: Mos6502Access): Mos6502Access {
	const { memory, pc, x, y } = cpu
	const opcode = memory[pc]
	const insn = cpu.model.instructions[opcode]
	const mode = cpu.model.modes[opcode]
	const low = memory[(pc + 1) & 0xFFFF]
	const word = low | (memory[(pc + 2) & 0xFFFF] << 8)
	out.opcode = opcode
	out.flags = 0
	out.address = 0
	out.target = 0
	if (insn < 0) return out
	switch (mode) {
		case ZPI: out.address = memory[low] | (memory[(low + 1) & 255] << 8); break
		case ZPR: out.address = low; out.target = (pc + 3 + ((memory[(pc + 2) & 65535] << 24) >> 24)) & 65535; break
		case ZP: out.address = low; break
		case ZPX: out.address = (low + x) & 0xFF; break
		case ZPY: out.address = (low + y) & 0xFF; break
		case ABS: out.address = word; break
		case ABX: out.address = (word + x) & 0xFFFF; break
		case ABY: out.address = (word + y) & 0xFFFF; break
		case IZX: {
			const pointer = (low + x) & 0xFF
			out.address = memory[pointer] | (memory[(pointer + 1) & 0xFF] << 8)
			break
		}
		case IZY: out.address = ((memory[low] | (memory[(low + 1) & 0xFF] << 8)) + y) & 0xFFFF; break
		case REL: out.target = (pc + MODE_BYTES[REL] + ((low << 24) >> 24)) & 0xFFFF; break
		case IND: case IMM: case ACC: break
	}
	const data = mode !== IMM && mode !== ACC && mode !== REL && mode !== IND && insn !== JMP && insn !== JSR
	if (data && (LOADS.has(insn) || MODIFIES.has(insn) || mode === ZPR)) out.flags |= ACCESS_READ
	if (data && (STORES.has(insn) || MODIFIES.has(insn))) out.flags |= ACCESS_WRITE
	if (BRANCHES.has(insn)) {
		const taken = mode === ZPR ? !!(memory[low] & (1 << ((insn - BBR0) & 7))) === (insn >= BBS0) : cpu.taken(insn)
		out.flags |= ACCESS_BRANCH | (taken ? ACCESS_TAKEN : 0)
	}
	if (insn === JSR) out.flags |= ACCESS_CALL
	return out
}
