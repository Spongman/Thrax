/**
 * Beta instruction metadata for the shared tools.  The opaque instruction an
 * observer is handed is the instruction word itself; what the tools read of it
 * is worked out once per word and kept.
 */

import { InstructionCategory, type HistoryRecord, type InstructionInfo, type InstructionSet } from '../contracts'
import { BetaInstructionInfo, classifyBeta, INSN_ALU, INSN_BRANCH, INSN_JUMP, INSN_LOAD, INSN_PRIVILEGED, INSN_STORE } from './classify'
import { FORMAT_BRANCH, FORMAT_ILLEGAL, FORMAT_JMP, FORMAT_LD, FORMAT_LDR, FORMAT_OP, FORMAT_OPC, FORMAT_ST, OPCODE_MNEMONIC } from './isa'
import { BETA_PIPELINE } from './pipeline'
import { BETA_REGISTERS } from './registers'

const { ALU, BRANCH, JUMP, MEMORY, OTHER, TRAP } = InstructionCategory

/** Encoding classes, indexed by `InstructionInfo.encoding`: the isa FORMAT_* constants. */
const ENCODINGS: string[] = []
ENCODINGS[FORMAT_ILLEGAL] = 'Illegal'
ENCODINGS[FORMAT_OP] = 'OP'
ENCODINGS[FORMAT_OPC] = 'OPC'
ENCODINGS[FORMAT_LD] = 'LD'
ENCODINGS[FORMAT_ST] = 'ST'
ENCODINGS[FORMAT_JMP] = 'JMP'
ENCODINGS[FORMAT_BRANCH] = 'Branch'
ENCODINGS[FORMAT_LDR] = 'LDR'

/** Register names by index, the hardwired R31 included. */
const REGISTER_NAMES = BETA_REGISTERS.slice(0, 32).map((register) => register.name)

function categoryOf(flags: number): number {
	if (flags & INSN_JUMP) return JUMP
	if (flags & INSN_BRANCH) return BRANCH
	if (flags & (INSN_LOAD | INSN_STORE)) return MEMORY
	if (flags & INSN_ALU) return ALU
	if (flags & INSN_PRIVILEGED) return TRAP
	return OTHER
}

const scratch = new BetaInstructionInfo()
const NO_REGISTERS = new Int32Array(32)

/** What a word is regardless of state: its class and register traffic. */
function infoOf(word: number): InstructionInfo {
	// Register values only decide outcomes and addresses, which this leaves out.
	const info = classifyBeta(word, 0, NO_REGISTERS, scratch)
	const reads: number[] = []
	if (info.source1 >= 0) reads.push(info.source1)
	if (info.source2 >= 0 && info.source2 !== info.source1) reads.push(info.source2)
	return {
		mnemonic: OPCODE_MNEMONIC[info.opcode] || (info.flags & INSN_PRIVILEGED ? 'PRIV' : 'ILLEGAL'),
		category: categoryOf(info.flags),
		encoding: info.format,
		reads,
		writes: info.destination < 0 ? [] : [info.destination],
		isLoad: (info.flags & INSN_LOAD) !== 0,
		isBranch: (info.flags & INSN_BRANCH) !== 0,
		isJump: (info.flags & INSN_JUMP) !== 0,
	}
}

/** Programs run the same few words over and over; this keeps one of each. */
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
export interface BetaExecuted extends HistoryRecord {
	/** The interrupt vector, for an interrupt. */
	readonly word: number
	readonly interrupt?: boolean
}

export const betaInstructionSet: InstructionSet = {
	encodings: ENCODINGS,
	registerNames: REGISTER_NAMES,
	pipeline: BETA_PIPELINE,
	describe: (instruction) => describeWord(instruction as number),
	decodeExecuted(entry) {
		const { kind, word, interrupt } = entry as BetaExecuted
		return kind === 'instruction' && !interrupt ? word : null
	},
}
