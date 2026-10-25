import { a32Dependencies, a32LoadWrites } from '../shared/a32/dependencies'
/**
 * A32 instruction metadata for the shared tools, under the ARMv8 profile.
 * The opaque instruction an observer is handed is the instruction word; what
 * the tools read of it is worked out once per word and kept. The pipeline is
 * the AArch64 state's five-stage model.
 */

import { A32_ALU, A32_BRANCH, A32_JUMP, A32_LOAD, A32_STORE, A32_SWI, classifyA32 } from '../shared/a32/classify'
import { disassembleA32 } from '../shared/a32/disassemble'
import { ARCH_V8, FORMAT_NAMES, FORMAT_UNDEFINED, REGISTER_NAMES } from '../shared/a32/isa'
import { InstructionCategory, type HistoryRecord, type InstructionInfo, type InstructionSet } from '../../contracts'
import { A64_PIPELINE } from '../a64/instructions'
import { predicatedInstructions } from '../../../core/instructionEffects'

const { ALU, BRANCH, JUMP, MEMORY, OTHER, TRAP } = InstructionCategory

function categoryOf(flags: number): number {
	if (flags & A32_JUMP) return JUMP
	if (flags & A32_BRANCH) return BRANCH
	if (flags & (A32_LOAD | A32_STORE)) return MEMORY
	if (flags & A32_ALU) return ALU
	if (flags & A32_SWI) return TRAP
	return OTHER
}

function infoOf(word: number): InstructionInfo {
	const { format, flags, reads, writes } = classifyA32(word, ARCH_V8)
	const dependencies = a32Dependencies(word, reads, writes, format)
	return {
		// The base mnemonic, as the disassembly writes it.
		mnemonic: format === FORMAT_UNDEFINED ? 'undefined' : disassembleA32(word, 0, ARCH_V8).split(' ')[0],
		category: categoryOf(flags),
		encoding: format,
		...dependencies,
		loadWrites: flags & A32_LOAD ? a32LoadWrites(word, format) : undefined,
		isLoad: (flags & A32_LOAD) !== 0,
		isBranch: (flags & A32_BRANCH) !== 0,
		isJump: (flags & A32_JUMP) !== 0,
		controlResult: writes & (1 << 15) ? flags & A32_LOAD ? 'load' : 'alu' : undefined,
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
export interface A32Executed extends HistoryRecord {
	readonly word: number
	readonly passed?: boolean
}

export const executedInstructions = predicatedInstructions(describeWord, [16])

export const a32InstructionSet: InstructionSet = {
	encodings: FORMAT_NAMES,
	registerNames: [...REGISTER_NAMES, 'NZCV'],
	pipeline: A64_PIPELINE,
	describe: executedInstructions.describe,
	decodeExecuted(entry) {
		const { kind, word, passed = true } = entry as A32Executed
		return kind === 'instruction' ? executedInstructions.executed(word, passed) : null
	},
}
