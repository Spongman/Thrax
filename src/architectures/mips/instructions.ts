/**
 * MIPS instruction metadata for the shared tools: category, encoding class and
 * integer register traffic, worked out once per decoded word and kept on it.
 */

import { decode, type Decoded } from './core/decoder'
import { Op, OP_NAMES } from './core/ops'
import { REGISTER_NAMES } from './core/registers'
import { MIPS_PIPELINE } from './pipeline'
import type { HistoryEntry } from '../../core/types'
import { InstructionCategory, type InstructionInfo, type InstructionSet } from '../contracts'

const { ALU, BRANCH, COPROCESSOR, JUMP, MEMORY, OTHER, TRAP } = InstructionCategory

// bgezal/bltzal branch-and-link like bltz/bgez, just also setting $ra.
const JUMPS = new Set(['j', 'jal', 'jr', 'jalr'])
const BRANCHES = new Set(['beq', 'bne', 'bgez', 'bgtz', 'blez', 'bltz', 'bc1t', 'bc1f', 'bgezal', 'bltzal'])
// The unaligned halves and the load-linked/store-conditional pair are memory
// accesses like the rest; without them they fell through to 'other'.
const MEMORY_OPS = new Set([
	'lw', 'lh', 'lhu', 'lb', 'lbu', 'sw', 'sh', 'sb', 'lwc1', 'ldc1', 'swc1', 'sdc1',
	'lwl', 'lwr', 'swl', 'swr', 'll', 'sc',
])
// clo/clz and the multiply-accumulates are plain integer arithmetic.  movn/movz
// are a GPR-to-GPR conditional move, listed here ahead of the 'mov' prefix
// catch-all below, which would otherwise claim them as coprocessor work.
const ALU_OPS = new Set([
	'add', 'addu', 'addi', 'addiu', 'sub', 'subu', 'mul', 'mult', 'multu', 'div', 'divu',
	'and', 'andi', 'or', 'ori', 'xor', 'xori', 'nor',
	'sll', 'srl', 'sra', 'sllv', 'srlv', 'srav',
	'slt', 'sltu', 'slti', 'sltiu', 'lui',
	'mfhi', 'mflo', 'mthi', 'mtlo',
	'clo', 'clz', 'madd', 'maddu', 'msub', 'msubu',
	'movn', 'movz',
])
// A trap compares like slt and raises instead of committing a result.
const TRAPS = new Set(['teq', 'teqi', 'tge', 'tgeu', 'tgei', 'tgeiu', 'tlt', 'tltu', 'tlti', 'tltiu', 'tne', 'tnei'])

function classify(op: string): number {
	if (JUMPS.has(op)) return JUMP
	if (BRANCHES.has(op)) return BRANCH
	if (MEMORY_OPS.has(op)) return MEMORY
	if (ALU_OPS.has(op)) return ALU
	if (TRAPS.has(op)) return TRAP
	// Everything the FPU and CP0 do, including the dotted mnemonics.
	if (op.includes('.') || op.startsWith('mfc') || op.startsWith('mtc') || op.startsWith('mov') || op === 'eret') {
		return COPROCESSOR
	}
	return OTHER
}

const CATEGORY_BY_OP: readonly number[] = OP_NAMES.map(classify)

export function categoryOf(op: number): number {
	return CATEGORY_BY_OP[op] ?? OTHER
}

/** Encoding classes, indexed by `InstructionInfo.encoding`. */
export const ENCODING_R = 0
export const ENCODING_I = 1
export const ENCODING_J = 2
const ENCODINGS = ['R-format', 'I-format', 'J-format']

/**
 * Which encoding a word uses, read off the opcode: 0 and 0x1c are the two
 * R-format groups, 2 and 3 the only jumps that carry a target, and the
 * coprocessor opcodes hold register operands where an immediate would be.
 */
export function formatOf(word: number): number {
	const opcode = (word >>> 26) & 0x3f
	if (opcode === 0 || opcode === 0x1c || opcode === 0x10 || opcode === 0x11) return ENCODING_R
	if (opcode === 2 || opcode === 3) return ENCODING_J
	return ENCODING_I
}

const LOADS = new Set<number>([Op.LB, Op.LBU, Op.LH, Op.LHU, Op.LW])
const STORES = new Set<number>([Op.SB, Op.SH, Op.SW])
const JUMP_OPS = new Set<number>([Op.J, Op.JAL, Op.JR, Op.JALR])
const RA = 31

/**
 * What an instruction is to the tools: its class, and which general-purpose
 * registers it reads and writes.  Only the integer file counts; the
 * coprocessors have their own, with no bypass between them to model.
 */
export function registerEffects(decoded: Decoded): InstructionInfo {
	const { op, rs, rt, rd, shape } = decoded
	const isLoad = LOADS.has(op)
	// cc,branch is bc1t/bc1f with an explicit condition code.
	const isBranch = shape === 'rs,rt,branch' || shape === 'rs,branch' || shape === 'branch' || shape === 'cc,branch'
	const isJump = JUMP_OPS.has(op)
	const info = (reads: number[], writes = -1): InstructionInfo => ({
		mnemonic: OP_NAMES[op],
		category: categoryOf(op),
		encoding: formatOf(decoded.word),
		reads: reads.filter((register) => register !== 0),
		writes: writes === 0 ? -1 : writes,
		isLoad,
		isBranch,
		isJump,
	})

	switch (shape) {
		case 'rd,rs,rt': return info([rs, rt], rd)
		case 'rd,rt,shamt': return info([rt], rd)
		case 'rd,rt,rs': return info([rt, rs], rd)
		case 'rd,rs': return info([rs], rd)
		// movf/movt: the cc only picks whether it commits.
		case 'rd,rs,cc': return info([rs], rd)
		case 'rs,rt': return info([rs, rt])
		case 'rd': return info([], rd)
		case 'rs': return info([rs])
		case 'jr': return info([rs])
		case 'jalr': return info([rs], rd)
		case 'rt,rs,imm': return info([rs], rt)
		case 'rt,rs,uimm': return info([rs], rt)
		case 'rt,uimm': return info([], rt)
		// A store reads the value it writes out; a load writes the register.
		case 'rt,offset(rs)': return STORES.has(op) ? info([rs, rt]) : info([rs], rt)
		// The coprocessor loads and stores touch only the base register here.
		case 'ft,offset(rs)': return info([rs])
		// The traps' immediate is in the word, not a register.
		case 'rs,imm': return info([rs])
		case 'rs,rt,branch': return info([rs, rt])
		// bgezal/bltzal write $ra like jal, in addition to reading rs.
		case 'rs,branch': return (op === Op.BGEZAL || op === Op.BLTZAL) ? info([rs], RA) : info([rs])
		case 'branch': return info([])
		// bc1t/bc1f read only the FP flag, which is not tracked.
		case 'cc,branch': return info([])
		// movz.s and kin: the condition is a GPR; the moved values are FP.
		case 'fd,fs,rt': return info([rt])
		case 'jump': return op === Op.JAL ? info([], RA) : info([])
		case 'rt,cp0': return op === Op.MFC0 ? info([], rt) : info([rt])
		case 'rt,fs': return op === Op.MFC1 ? info([], rt) : info([rt])
		// syscall reads its arguments; the CP1 operations use the other file.
		case 'none': return op === Op.SYSCALL ? info([2, 4, 5, 6, 7]) : info([])
		default: return info([])
	}
}

/** Replay decodes the same few words over and over; this keeps one of each. */
const REPLAY_CACHE_LIMIT = 4096
const replayCache = new Map<number, Decoded | null>()

function decodeWord(word: number): Decoded | null {
	let decoded = replayCache.get(word)
	if (decoded !== undefined) return decoded
	if (replayCache.size >= REPLAY_CACHE_LIMIT) replayCache.clear()
	decoded = decode(word)
	replayCache.set(word, decoded)
	return decoded
}

export const mipsInstructionSet: InstructionSet = {
	encodings: ENCODINGS,
	registerNames: REGISTER_NAMES,
	pipeline: MIPS_PIPELINE,
	describe(instruction) {
		const decoded = instruction as Decoded
		return decoded.info ??= registerEffects(decoded)
	},
	decodeExecuted(entry) {
		const { kind, word } = entry as HistoryEntry
		if (kind !== 'instruction' || word === null) return null
		return decodeWord(word)
	},
}
