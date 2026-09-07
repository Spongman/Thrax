/**
 * Instruction statistics.
 *
 * Every executed instruction lands in exactly one category, so the counts sum
 * to the total.
 */

import type { Decoded } from '../core/decoder'
import type { ExecutionObserver, MachineConfig } from '../core/observer'
import { OP_NAMES } from '../core/ops'
import { Replay, type Replayable } from './replay'

export type InstructionCategory = 'alu' | 'jump' | 'branch' | 'memory' | 'coprocessor' | 'trap' | 'other'

export const CATEGORY_LABELS: Record<InstructionCategory, string> = {
	alu: 'ALU',
	jump: 'Jump',
	branch: 'Branch',
	memory: 'Memory',
	coprocessor: 'Coprocessor',
	trap: 'Trap',
	other: 'Other',
}

// bgezal/bltzal branch-and-link like bltz/bgez, just also setting $ra
//.
const JUMPS = new Set(['j', 'jal', 'jr', 'jalr'])
const BRANCHES = new Set(['beq', 'bne', 'bgez', 'bgtz', 'blez', 'bltz', 'bc1t', 'bc1f', 'bgezal', 'bltzal'])
// The unaligned halves and the load-linked/store-conditional pair are memory
// accesses like the rest; without them they fell through to 'other'.
const MEMORY = new Set([
	'lw', 'lh', 'lhu', 'lb', 'lbu', 'sw', 'sh', 'sb', 'lwc1', 'ldc1', 'swc1', 'sdc1',
	'lwl', 'lwr', 'swl', 'swr', 'll', 'sc',
])
// clo/clz (bit counting) and madd/maddu/msub/msubu (multiply-accumulate) are plain
// integer arithmetic, alongside the existing mult/div family they extend
//. movn/movz are a GPR-to-GPR
// conditional move with no FPU or CP0 involvement, so they must be listed here ahead
// of the 'MOV' prefix catch-all below, which would otherwise claim them as coprocessor
// work alongside movn.s/movz.s.
const ALU = new Set([
	'add', 'addu', 'addi', 'addiu', 'sub', 'subu', 'mul', 'mult', 'multu', 'div', 'divu',
	'and', 'andi', 'or', 'ori', 'xor', 'xori', 'nor',
	'sll', 'srl', 'sra', 'sllv', 'srlv', 'srav',
	'slt', 'sltu', 'slti', 'sltiu', 'lui',
	'mfhi', 'mflo', 'mthi', 'mtlo',
	'clo', 'clz', 'madd', 'maddu', 'msub', 'msubu',
	'movn', 'movz',
])
// A trap is neither ALU (it commits no result register), memory, nor coprocessor
// work: it compares two operands like slt and conditionally raises an exception
// instead.  So traps get a category of their own rather than a catch-all.
const TRAPS = new Set(['teq', 'teqi', 'tge', 'tgeu', 'tgei', 'tgeiu', 'tlt', 'tltu', 'tlti', 'tltiu', 'tne', 'tnei'])

function classify(op: string): InstructionCategory {
	if (JUMPS.has(op)) return 'jump'
	if (BRANCHES.has(op)) return 'branch'
	if (MEMORY.has(op)) return 'memory'
	if (ALU.has(op)) return 'alu'
	if (TRAPS.has(op)) return 'trap'
	// Everything the FPU and CP0 do, including the dotted mnemonics: movn.s/movz.s and
	// movf.s/movt.s/movf.d/movt.d (FP-register conditional moves) land here too.
	if (op.includes('.') || op.startsWith('mfc') || op.startsWith('mtc') || op.startsWith('mov') || op === 'eret') {
		return 'coprocessor'
	}
	return 'other'
}

/**
 * Which category each op falls in, worked out once from its mnemonic.  The
 * classification reads names; an instruction being counted has a number, and
 * an array index is the whole of the lookup.
 */
const CATEGORY_BY_OP: readonly InstructionCategory[] = OP_NAMES.map(classify)

export function categoryOf(op: number): InstructionCategory {
	return CATEGORY_BY_OP[op] ?? 'other'
}

/**
 * The three encodings an instruction word can have: R has three register
 * fields and a function code, I an immediate, and J a 26-bit target.
 */
export type InstructionFormat = 'R' | 'I' | 'J'

export const FORMAT_LABELS: Record<InstructionFormat, string> = {
	R: 'R-format',
	I: 'I-format',
	J: 'J-format',
}

export interface StatisticsSnapshot {
	total: number
	byCategory: Record<InstructionCategory, number>
	/** Counts by encoding, which is what the machine word looks like. */
	byFormat: Record<InstructionFormat, number>
	/** Executed counts per mnemonic, most frequent first. */
	byMnemonic: Array<{ op: string; count: number }>
}

/**
 * Which encoding a word uses, read off the word itself rather than the
 * mnemonic: the opcode alone decides it, with 0 and 0x1c naming the two
 * R-format groups and 2 and 3 the only jumps that carry a target.
 */
export function formatOf(word: number): InstructionFormat {
	const opcode = (word >>> 26) & 0x3f
	if (opcode === 0 || opcode === 0x1c) return 'R'
	if (opcode === 2 || opcode === 3) return 'J'
	// The coprocessor opcodes hold a format field where an immediate would be,
	// and their operands are registers, so they are R-format words.
	if (opcode === 0x10 || opcode === 0x11) return 'R'
	return 'I'
}

export class InstructionStatistics implements ExecutionObserver, Replayable {
	private total = 0
	private categories = new Map<InstructionCategory, number>()
	private mnemonics = new Map<string, number>()
	private formats = new Map<InstructionFormat, number>()
	/**
	 * Every count here is a tally of the instructions that ran, and the machine
	 * keeps those, so stepping back means counting them again rather than
	 * keeping a copy of the tallies for every step.
	 */
	private readonly replay = new Replay(this)

	onSeek(to: number) {
		this.replay.seek(to)
	}

	onConfigure(machine: MachineConfig) {
		this.replay.configure(machine)
	}

	replayStep(address: number, decoded: Decoded, instructionCount: number) {
		this.count(address, decoded, instructionCount)
	}

	onInstruction(address: number, decoded: Decoded, instructionCount = 0) {
		this.replay.watch(instructionCount)
		this.count(address, decoded, instructionCount)
	}

	/** One instruction counted, live or replayed. */
	private count(_address: number, decoded: Decoded, _instructionCount: number) {
		this.total += 1
		const category = categoryOf(decoded.op)
		this.categories.set(category, (this.categories.get(category) ?? 0) + 1)
		const mnemonic = OP_NAMES[decoded.op]
		this.mnemonics.set(mnemonic, (this.mnemonics.get(mnemonic) ?? 0) + 1)
		const encoding = formatOf(decoded.word)
		this.formats.set(encoding, (this.formats.get(encoding) ?? 0) + 1)
	}

	/** Everything worked out from the instructions, which a replay redoes. */
	clear() {
		this.total = 0
		this.categories.clear()
		this.mnemonics.clear()
		this.formats.clear()
	}

	reset() {
		this.clear()
		this.replay.reset()
	}

	onReset() {
		this.reset()
	}

	snapshot(): StatisticsSnapshot {
		this.replay.settle()
		const byCategory = {} as Record<InstructionCategory, number>
		for (const category of Object.keys(CATEGORY_LABELS) as InstructionCategory[]) {
			byCategory[category] = this.categories.get(category) ?? 0
		}
		const byFormat = { R: 0, I: 0, J: 0 } as Record<InstructionFormat, number>
		for (const encoding of Object.keys(FORMAT_LABELS) as InstructionFormat[]) {
			byFormat[encoding] = this.formats.get(encoding) ?? 0
		}
		return {
			total: this.total,
			byCategory,
			byFormat,
			byMnemonic: [...this.mnemonics.entries()]
				.map(([op, count]) => ({ op, count }))
				.sort((left, right) => right.count - left.count || left.op.localeCompare(right.op)),
		}
	}
}
