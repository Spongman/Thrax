import { a32Dependencies, a32LoadWrites } from '../arm/a32/dependencies'
/**
 * ARM26 instruction metadata for the shared tools.  The opaque instruction an
 * observer is handed is the instruction word; what tools read of it is worked
 * out once per word and kept.
 */

import { A32_ALU, A32_BRANCH, A32_CALL, A32_JUMP, A32_LOAD, A32_STORE, A32_SWI, classifyA32 } from '../arm/a32/classify'
import { DP_NAMES, FORMAT_BLOCK, FORMAT_BRANCH, FORMAT_COPROCESSOR, FORMAT_DATA, FORMAT_MULTIPLY, FORMAT_NAMES, FORMAT_SWAP, FORMAT_SWI, FORMAT_TRANSFER, REGISTER_NAMES } from '../arm/a32/isa'
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
		case FORMAT_COPROCESSOR: return word & 0x00100000 ? 'MRC' : 'MCR'
		default: return 'UNDEFINED'
	}
}

function infoOf(word: number): InstructionInfo {
	const classification = classifyA32(word)
	const { format, flags } = classification
	let { reads, writes } = classification
	if (format === FORMAT_COPROCESSOR && (word & 0x0F000010) === 0x0E000010) {
		const rd = (word >>> 12) & 15
		reads = word & 0x00100000 ? 0 : 1 << rd
		writes = word & 0x00100000 && rd !== 15 ? 1 << rd : 0
	}
	const dependencies = a32Dependencies(word, reads, writes, format)
	return {
		mnemonic: mnemonicOf(word, format),
		category: categoryOf(flags),
		encoding: format,
		...dependencies,
		loadWrites: flags & A32_LOAD ? a32LoadWrites(word, format) : undefined,
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
	readonly executeCycles?: number
	readonly passed?: boolean
	readonly redirected?: boolean
	readonly timing?: readonly number[]
}

export interface Arm26Instruction {
	word: number
	executeCycles: number
	passed: boolean
	redirected: boolean
	timing?: readonly number[]
}

export const instructionWord = (instruction: unknown): number =>
	typeof instruction === 'number' ? instruction : (instruction as Arm26Instruction).word

const skipped = new Map<number, InstructionInfo>()

function describeExecution(instruction: unknown): InstructionInfo {
	const word = instructionWord(instruction)
	const info = describeWord(word)
	if (typeof instruction === 'number') return info
	const executed = instruction as Arm26Instruction
	if (!executed.passed) {
		let skip = skipped.get(word)
		if (!skip) {
			if (skipped.size >= CACHE_LIMIT) skipped.clear()
			skip = { ...info, reads: [], writes: [], isLoad: false, isBranch: false, isJump: false }
			skipped.set(word, skip)
		}
		return skip
	}
	return executed.redirected && !info.isJump && !info.isBranch ? { ...info, isJump: true } : info
}

export const arm26InstructionSet: InstructionSet = {
	encodings: FORMAT_NAMES,
	registerNames: [...REGISTER_NAMES, 'NZCV'],
	pipeline: ARM26_PIPELINE,
	describe: describeExecution,
	decodeExecuted(entry) {
		const { kind, word, interrupt, executeCycles = 1, passed = true, redirected = false, timing } = entry as Arm26Executed
		return kind === 'instruction' && !interrupt ? { word, executeCycles, passed, redirected, timing } : null
	},
}
