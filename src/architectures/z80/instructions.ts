import { DEPENDENCY_NAMES, registerTraffic } from './dependencies'
/**
 * Z80 instruction facts for the call stack, stepping and the shared tools. The
 * opaque instruction an observer is handed is the instruction's bytes packed
 * into a number, first byte lowest; what the tools read of it is worked out
 * once per packed value and kept.
 */

import { InstructionCategory, type HistoryRecord, type InstructionInfo, type InstructionSet } from '../contracts'
import { decode, type ByteReader } from './disassemble'

const { ALU, BRANCH, JUMP, MEMORY, OTHER, TRAP } = InstructionCategory

/** Flags of `classify`. */
export const Z80_CALL = 1
export const Z80_RETURN = 2
/** Taken or not depending on the flags or B. */
export const Z80_CONDITIONAL = 4
/** Changes the PC: jumps, calls and returns. */
export const Z80_TRANSFER = 8
export const Z80_RESTART = 16

/** Encoding classes, indexed by `InstructionInfo.encoding`. */
export const Z80_ENCODINGS = ['Main', 'CB', 'ED', 'DD/FD', 'DD/FD CB'] as const

/** The first byte past any index prefixes, and which page the opcode is on. */
function opcodeOf(read: ByteReader): { opcode: number, page: number, at: number, index: 'IX' | 'IY' | '' } {
	let at = 0
	let opcode = read(at++) & 0xFF
	let index: 'IX' | 'IY' | '' = ''
	while (opcode === 0xDD || opcode === 0xFD) {
		index = opcode === 0xDD ? 'IX' : 'IY'
		opcode = read(at++) & 0xFF
	}
	if (opcode === 0xCB) return { opcode: read(index ? at + 1 : at) & 0xFF, page: index ? 4 : 1, at, index }
	if (opcode === 0xED) return { opcode: read(at) & 0xFF, page: 2, at, index }
	return { opcode, page: index ? 3 : 0, at, index }
}

/** Z80_* flags of the instruction `read` gives. */
export function classify(read: ByteReader): number {
	const { opcode, page } = opcodeOf(read)
	if (page === 2) return (opcode & 0xC7) === 0x45 ? Z80_RETURN | Z80_TRANSFER : 0
	if (page === 1 || page === 4) return 0
	if (opcode === 0xCD) return Z80_CALL | Z80_TRANSFER
	if ((opcode & 0xC7) === 0xC4) return Z80_CALL | Z80_TRANSFER | Z80_CONDITIONAL
	if ((opcode & 0xC7) === 0xC7) return Z80_CALL | Z80_TRANSFER | Z80_RESTART
	if (opcode === 0xC9) return Z80_RETURN | Z80_TRANSFER
	if ((opcode & 0xC7) === 0xC0) return Z80_RETURN | Z80_TRANSFER | Z80_CONDITIONAL
	if (opcode === 0xC3 || opcode === 0x18 || opcode === 0xE9) return Z80_TRANSFER
	if ((opcode & 0xC7) === 0xC2 || opcode === 0x10 || (opcode & 0xE7) === 0x20) return Z80_TRANSFER | Z80_CONDITIONAL
	return 0
}

/** Packs up to four bytes, first lowest. */
export function packInstruction(read: ByteReader, length: number): number {
	let packed = 0
	for (let offset = Math.min(length, 4) - 1; offset >= 0; offset--) packed = packed * 256 + (read(offset) & 0xFF)
	return packed
}

const unpack = (packed: number): ByteReader => (offset) => Math.floor(packed / 256 ** offset) & 0xFF

const MEMORY_OPS = new Set(['LD', 'PUSH', 'POP', 'EX', 'EXX', 'LDI', 'LDD', 'LDIR', 'LDDR'])
const IO_OPS = new Set(['IN', 'OUT', 'INI', 'IND', 'INIR', 'INDR', 'OUTI', 'OUTD', 'OTIR', 'OTDR'])
const CONTROL_OPS = new Set(['NOP', 'HALT', 'DI', 'EI', 'IM'])

function categoryOf(mnemonic: string, flags: number): number {
	if (flags & Z80_RESTART) return TRAP
	if (flags & Z80_TRANSFER) return flags & Z80_CONDITIONAL ? BRANCH : JUMP
	if (MEMORY_OPS.has(mnemonic)) return MEMORY
	if (IO_OPS.has(mnemonic) || CONTROL_OPS.has(mnemonic)) return OTHER
	return ALU
}

function infoOf(packed: number): InstructionInfo {
	const read = unpack(packed)
	const { text } = decode(read, 0)
	const mnemonic = text.split(' ')[0]
	const flags = classify(read)
	const { page, opcode, index } = opcodeOf(read)
	return {
		mnemonic,
		category: categoryOf(mnemonic, flags),
		encoding: page,
		...registerTraffic(opcode, page, index),
		isBranch: (flags & Z80_CONDITIONAL) !== 0,
		isJump: (flags & Z80_TRANSFER) !== 0 && (flags & Z80_CONDITIONAL) === 0,
	}
}

/** Programs run the same few instructions over and over; this keeps one of each. */
const CACHE_LIMIT = 4096
const cache = new Map<number, InstructionInfo>()

export function describeInstruction(packed: number): InstructionInfo {
	let info = cache.get(packed)
	if (info) return info
	if (cache.size >= CACHE_LIMIT) cache.clear()
	info = infoOf(packed)
	cache.set(packed, info)
	return info
}

/** A history record that carries the instruction it ran. */
export interface Z80Executed extends HistoryRecord {
	/** The packed instruction, or the interrupt's vector for an interrupt. */
	readonly packed: number
	readonly interrupt: boolean
}

/** 8-bit registers by index, as the tools name them. */
const REGISTER_NAMES = DEPENDENCY_NAMES

export const z80InstructionSet: InstructionSet = {
	encodings: Z80_ENCODINGS,
	registerNames: REGISTER_NAMES,
	describe: (instruction) => describeInstruction(instruction as number),
	decodeExecuted(entry) {
		const { kind, packed, interrupt } = entry as Z80Executed
		return kind === 'instruction' && !interrupt ? packed : null
	},
}
