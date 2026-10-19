/**
 * A64 facts the assembler, decoder and CPU share: condition codes, shift and
 * extend names, and logical (bitmask) immediates, after the Arm Architecture
 * Reference Manual for A-profile (DDI 0487), sections C1 to C6.
 */

export const MASK32 = 0xFFFF_FFFFn
export const MASK64 = 0xFFFF_FFFF_FFFF_FFFFn

/** Register 31 reads as zero or as the stack pointer, depending on the operand. */
export const R_ZR = 31
export const R_SP = 31
export const R_LR = 30
export const R_FP = 29

/** Condition codes by encoding; `hs` and `lo` are spellings of `cs` and `cc`. */
export const CONDITIONS: readonly string[] = ['eq', 'ne', 'cs', 'cc', 'mi', 'pl', 'vs', 'vc', 'hi', 'ls', 'ge', 'lt', 'gt', 'le', 'al', 'nv']
const CONDITION_ALIASES: Readonly<Record<string, number>> = { hs: 2, lo: 3 }

/** The encoding of a condition name, or -1. */
export function conditionCode(name: string): number {
	const lower = name.toLowerCase()
	const index = CONDITIONS.indexOf(lower)
	return index >= 0 ? index : CONDITION_ALIASES[lower] ?? -1
}

export const SHIFT_LSL = 0
export const SHIFT_LSR = 1
export const SHIFT_ASR = 2
export const SHIFT_ROR = 3
export const SHIFTS: readonly string[] = ['lsl', 'lsr', 'asr', 'ror']

export const EXTEND_UXTB = 0
export const EXTEND_UXTH = 1
export const EXTEND_UXTW = 2
export const EXTEND_UXTX = 3
export const EXTEND_SXTB = 4
export const EXTEND_SXTH = 5
export const EXTEND_SXTW = 6
export const EXTEND_SXTX = 7
export const EXTENDS: readonly string[] = ['uxtb', 'uxth', 'uxtw', 'uxtx', 'sxtb', 'sxth', 'sxtw', 'sxtx']

/** NZCV as a 4-bit number, N the highest. */
export const FLAG_N = 8
export const FLAG_Z = 4
export const FLAG_C = 2
export const FLAG_V = 1

/** ConditionHolds() of the reference manual (J1.2). */
export function conditionHolds(cond: number, nzcv: number): boolean {
	let result: boolean
	switch (cond >> 1) {
		case 0: result = (nzcv & FLAG_Z) !== 0; break
		case 1: result = (nzcv & FLAG_C) !== 0; break
		case 2: result = (nzcv & FLAG_N) !== 0; break
		case 3: result = (nzcv & FLAG_V) !== 0; break
		case 4: result = (nzcv & FLAG_C) !== 0 && (nzcv & FLAG_Z) === 0; break
		case 5: result = ((nzcv & FLAG_N) !== 0) === ((nzcv & FLAG_V) !== 0); break
		case 6: result = ((nzcv & FLAG_N) !== 0) === ((nzcv & FLAG_V) !== 0) && (nzcv & FLAG_Z) === 0; break
		default: result = true
	}
	return (cond & 1) !== 0 && cond !== 15 ? !result : result
}

const ones = (count: number) => (1n << BigInt(count)) - 1n

/** `value` rotated right by `amount` within `width` bits. */
export function rotateRight(value: bigint, amount: number, width: number): bigint {
	const mask = ones(width)
	const shift = amount % width
	if (shift === 0) return value & mask
	return ((value >> BigInt(shift)) | (value << BigInt(width - shift))) & mask
}

/** `element` of `esize` bits repeated to fill `width` bits. */
function replicate(element: bigint, esize: number, width: number): bigint {
	let result = 0n
	for (let at = 0; at < width; at += esize) result |= element << BigInt(at)
	return result
}

export interface BitMasks {
	wmask: bigint
	tmask: bigint
}

/**
 * DecodeBitMasks() (J1.1): the masks of a logical immediate or a bitfield
 * instruction, or null where the fields are reserved.  `immediate` is set for
 * logical immediates, which may not be all ones.
 */
export function decodeBitMasks(n: number, imms: number, immr: number, immediate: boolean, width: number): BitMasks | null {
	const combined = (n << 6) | (~imms & 0x3F)
	if (combined === 0) return null
	const len = 31 - Math.clz32(combined)
	if (len < 1 || (1 << len) > width) return null
	const levels = (1 << len) - 1
	if (immediate && (imms & levels) === levels) return null
	const s = imms & levels
	const r = immr & levels
	const esize = 1 << len
	const d = (s - r) & levels
	const welem = ones(s + 1)
	const telem = ones(d + 1)
	return { wmask: replicate(rotateRight(welem, r, esize), esize, width), tmask: replicate(telem, esize, width) }
}

/** The value a logical immediate's fields encode, or null where they are reserved. */
export function logicalImmediate(n: number, imms: number, immr: number, width: number): bigint | null {
	if (width === 32 && n !== 0) return null
	return decodeBitMasks(n, imms, immr, true, width)?.wmask ?? null
}

export interface LogicalFields {
	n: number
	immr: number
	imms: number
}

/**
 * The N:immr:imms fields encoding `value` as a logical immediate of `width`
 * bits, or null when it has none: zero, all ones, and anything that is not a
 * rotated run of ones repeated in a power-of-two element.
 */
export function encodeLogicalImmediate(value: bigint, width: number): LogicalFields | null {
	const mask = ones(width)
	value &= mask
	if (value === 0n || value === mask) return null
	// The smallest element the value repeats.
	let esize = width
	while (esize > 2) {
		const half = esize / 2
		const low = value & ones(half)
		if (replicate(low, half, width) !== value) break
		esize = half
	}
	const element = value & ones(esize)
	let count = 0
	for (let bit = 0; bit < esize; bit++) if ((element >> BigInt(bit)) & 1n) count++
	const run = ones(count)
	for (let rotation = 0; rotation < esize; rotation++) {
		if (rotateRight(run, rotation, esize) !== element) continue
		const imms = ((0x3F << (Math.log2(esize) + 1)) & 0x3F) | (count - 1)
		return { n: esize === 64 ? 1 : 0, immr: rotation, imms }
	}
	return null
}

/** How MOVZ or MOVN would write `value` in one instruction, or null. */
export function encodeMoveWide(value: bigint, width: number): { inverted: boolean, imm16: number, hw: number } | null {
	const mask = ones(width)
	value &= mask
	for (const inverted of [false, true]) {
		const target = inverted ? ~value & mask : value
		for (let hw = 0; hw < width / 16; hw++) {
			const shift = BigInt(hw * 16)
			if ((target & ~(0xFFFFn << shift) & mask) === 0n) return { inverted, imm16: Number((target >> shift) & 0xFFFFn), hw }
		}
	}
	return null
}
