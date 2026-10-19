/**
 * A64 instruction metadata for the shared tools. The opaque instruction an
 * observer is handed is the instruction word; what the tools read of it is
 * worked out once per word and kept.
 */

import { InstructionCategory, PipelineResult, type HistoryRecord, type InstructionInfo, type InstructionSet, type PipelineModel } from '../../contracts'
import { INSN_ALU, INSN_BRANCH, INSN_JUMP, INSN_LOAD, INSN_STORE, INSN_TRAP, registerTraffic, staticFlags } from './classify'
import { decode, Op } from './decode'
import { disassemble } from './disassemble'

const { ALU, BRANCH, JUMP, MEMORY, OTHER, TRAP } = InstructionCategory

/** Encoding classes by `Op`, which `InstructionInfo.encoding` indexes. */
const ENCODINGS: string[] = []
ENCODINGS[Op.UNDEFINED] = 'Undefined'
ENCODINGS[Op.ADDSUB_IMM] = 'Add/subtract (immediate)'
ENCODINGS[Op.LOGIC_IMM] = 'Logical (immediate)'
ENCODINGS[Op.MOVE_WIDE] = 'Move wide'
ENCODINGS[Op.BITFIELD] = 'Bitfield'
ENCODINGS[Op.EXTR] = 'Extract'
ENCODINGS[Op.ADR] = 'PC-relative (ADR)'
ENCODINGS[Op.ADRP] = 'PC-relative (ADRP)'
ENCODINGS[Op.B] = 'Branch'
ENCODINGS[Op.BL] = 'Branch with link'
ENCODINGS[Op.B_COND] = 'Conditional branch'
ENCODINGS[Op.CB] = 'Compare and branch'
ENCODINGS[Op.TB] = 'Test and branch'
ENCODINGS[Op.BR] = 'Branch to register'
ENCODINGS[Op.BLR] = 'Branch with link to register'
ENCODINGS[Op.RET] = 'Return'
ENCODINGS[Op.SVC] = 'Supervisor call'
ENCODINGS[Op.HLT] = 'Halt'
ENCODINGS[Op.BRK] = 'Breakpoint'
ENCODINGS[Op.NOP] = 'Hint'
ENCODINGS[Op.LOGIC_REG] = 'Logical (shifted register)'
ENCODINGS[Op.ADDSUB_SHIFT] = 'Add/subtract (shifted register)'
ENCODINGS[Op.ADDSUB_EXT] = 'Add/subtract (extended register)'
ENCODINGS[Op.ADC] = 'Add/subtract with carry'
ENCODINGS[Op.CCMP] = 'Conditional compare'
ENCODINGS[Op.CSEL] = 'Conditional select'
ENCODINGS[Op.DP3] = 'Data processing (3 source)'
ENCODINGS[Op.DP2] = 'Data processing (2 source)'
ENCODINGS[Op.DP1] = 'Data processing (1 source)'
ENCODINGS[Op.LOAD_STORE] = 'Load/store register'
ENCODINGS[Op.LOAD_LITERAL] = 'Load register (literal)'
ENCODINGS[Op.LOAD_STORE_PAIR] = 'Load/store pair'

/** X0-X30, then SP as register 31. */
const REGISTER_NAMES: readonly string[] = [...Array.from({ length: 31 }, (_, index) => `X${index}`), 'SP']

function categoryOf(flags: number): number {
	if (flags & INSN_JUMP) return JUMP
	if (flags & INSN_BRANCH) return BRANCH
	if (flags & (INSN_LOAD | INSN_STORE)) return MEMORY
	if (flags & INSN_ALU) return ALU
	if (flags & INSN_TRAP) return TRAP
	return OTHER
}

function infoOf(word: number): InstructionInfo {
	const d = decode(word)
	const flags = staticFlags(d)
	const { reads, writes } = registerTraffic(d)
	return {
		// The preferred alias, as the disassembly writes it.
		mnemonic: d.op === Op.UNDEFINED ? 'undefined' : disassemble(word, 0).split(' ')[0],
		category: categoryOf(flags),
		encoding: d.op,
		reads,
		writes,
		isLoad: (flags & INSN_LOAD) !== 0,
		isBranch: (flags & INSN_BRANCH) !== 0,
		isJump: (flags & INSN_JUMP) !== 0,
	}
}

const CACHE_LIMIT = 4096
const cache = new Map<number, InstructionInfo>()

export function describeWord(word: number): InstructionInfo {
	let info = cache.get(word)
	if (info) return info
	if (cache.size >= CACHE_LIMIT) cache.clear()
	info = infoOf(word)
	cache.set(word, info)
	return info
}

/** A history record that carries the word it ran. */
export interface A64Executed extends HistoryRecord {
	readonly word: number
}

const STAGE_ID = 1
const STAGE_EX = 2
const STAGE_MEM = 3
const STAGE_WB = 4

/**
 * A classic in-order five-stage pipeline for teaching, not a model of any Arm
 * core: forwarding from EX, MEM and WB, a load used next stalls one cycle, and
 * a branch decides in EX or, with the option, in ID.
 */
export const A64_PIPELINE: PipelineModel = Object.freeze({
	stages: Object.freeze([
		{ label: 'IF', name: 'Instruction fetch', kind: 'if' },
		{ label: 'ID', name: 'Decode and register read', kind: 'id' },
		{ label: 'EX', name: 'Execute, or memory address', kind: 'ex' },
		{ label: 'MEM', name: 'Memory access', kind: 'mem' },
		{ label: 'WB', name: 'Write back', kind: 'wb' },
	]),
	readStage: STAGE_ID,
	writeStage: STAGE_WB,
	hazards: Object.freeze([
		{
			value: 'forwarding', label: 'Forwarding (0 stalls)', useStage: STAGE_EX, writeThenRead: true,
			bypasses: Object.freeze([
				{ from: STAGE_MEM, results: PipelineResult.ALU },
				{ from: STAGE_WB, results: PipelineResult.ALU | PipelineResult.LOAD },
			]),
		},
		{ value: 'none', label: 'Decode with write-back (2)', useStage: STAGE_ID, writeThenRead: true, bypasses: [] },
	]),
	branches: Object.freeze([
		{ value: 'ex', label: 'EX (2 annulled)', stage: STAGE_EX },
		{ value: 'id', label: 'ID (1 annulled)', stage: STAGE_ID },
	]),
	jumps: Object.freeze([
		{ value: 'ex', label: 'EX (2 annulled)', stage: STAGE_EX },
		{ value: 'id', label: 'ID (1 annulled)', stage: STAGE_ID },
	]),
	delaySlots: 0,
})

export const a64InstructionSet: InstructionSet = {
	encodings: ENCODINGS,
	registerNames: REGISTER_NAMES,
	pipeline: A64_PIPELINE,
	describe: (instruction) => describeWord(instruction as number),
	decodeExecuted(entry) {
		const { kind, word } = entry as A64Executed
		return kind === 'instruction' ? word : null
	},
}

