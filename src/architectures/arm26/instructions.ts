/**
 * ARM26 instruction metadata for the shared tools.  The opaque instruction an
 * observer is handed is the instruction word; what tools read of it is worked
 * out once per word and kept.
 */

import { A32_ALU, A32_BRANCH, A32_CALL, A32_JUMP, A32_LOAD, A32_STORE, A32_SWI, classifyA32 } from '../arm/a32/classify'
import { DP_NAMES, FORMAT_BLOCK, FORMAT_BRANCH, FORMAT_DATA, FORMAT_MULTIPLY, FORMAT_NAMES, FORMAT_SWAP, FORMAT_SWI, FORMAT_TRANSFER, REGISTER_NAMES } from '../arm/a32/isa'
import { InstructionCategory, type HistoryRecord, type InstructionInfo, type InstructionSet } from '../contracts'
import { ARM26_PIPELINE } from './pipeline'

const { ALU, BRANCH, JUMP, MEMORY, OTHER, TRAP } = InstructionCategory

function categoryOf(flags: number): number {
	if (flags & A32_JUMP) return JUMP
	if (flags & A32_BRANCH) return BRANCH
	if (flags & (A32_LOAD | A32_STORE)) return MEMORY
	if (flags & A32_ALU) return ALU
	if (flags & A32_SWI) return TRAP
	return OTHER
}

function mnemonicOf(word: number, format: number): string {
	switch (format) {
		case FORMAT_DATA: return DP_NAMES[(word >>> 21) & 15].toUpperCase()
		case FORMAT_MULTIPLY: return word & 0x00200000 ? 'MLA' : 'MUL'
		case FORMAT_SWAP: return 'SWP'
		case FORMAT_TRANSFER: return word & 0x00100000 ? 'LDR' : 'STR'
		case FORMAT_BLOCK: return word & 0x00100000 ? 'LDM' : 'STM'
		case FORMAT_BRANCH: return word & 0x01000000 ? 'BL' : 'B'
		case FORMAT_SWI: return 'SWI'
		default: return 'UNDEFINED'
	}
}

const registersOf = (mask: number) => Array.from({ length: 16 }, (_unused, index) => index).filter((index) => mask & (1 << index))

function infoOf(word: number): InstructionInfo {
	const { format, flags, reads, writes } = classifyA32(word)
	// One destination for the tools: the last register a block load fills.
	const written = registersOf(writes)
	return {
		mnemonic: mnemonicOf(word, format),
		category: categoryOf(flags),
		encoding: format,
		reads: registersOf(reads),
		writes: written.length ? written[written.length - 1] : -1,
		isLoad: (flags & A32_LOAD) !== 0,
		isBranch: (flags & A32_BRANCH) !== 0,
		isJump: (flags & A32_JUMP) !== 0,
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

/** Whether `word` is a BL. */
export const isCall = (word: number) => (classifyA32(word).flags & A32_CALL) !== 0

/** A history record that carries the word it ran. */
export interface Arm26Executed extends HistoryRecord {
	/** The vector, for an interrupt. */
	readonly word: number
	readonly interrupt?: boolean
}

export const arm26InstructionSet: InstructionSet = {
	encodings: FORMAT_NAMES,
	registerNames: REGISTER_NAMES,
	pipeline: ARM26_PIPELINE,
	describe: (instruction) => describeWord(instruction as number),
	decodeExecuted(entry) {
		const { kind, word, interrupt } = entry as Arm26Executed
		return kind === 'instruction' && !interrupt ? word : null
	},
}
