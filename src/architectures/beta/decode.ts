import { OPCODE_FORMAT } from './isa'

/** Field extractors; the CPU uses these inline so stepping allocates nothing. */
export const opcodeField = (word: number) => (word >>> 26) & 0x3F
export const rcField = (word: number) => (word >>> 21) & 0x1F
export const raField = (word: number) => (word >>> 16) & 0x1F
export const rbField = (word: number) => (word >>> 11) & 0x1F
/** The 16-bit literal, sign extended. */
export const literalField = (word: number) => (word << 16) >> 16

export interface DecodedInstruction {
	word: number
	opcode: number
	/** One of the FORMAT_* constants. */
	format: number
	rc: number
	ra: number
	rb: number
	/** Sign-extended literal; meaningful for every format but FORMAT_OP. */
	literal: number
}

/** Splits a word into its fields. Illegal opcodes decode with FORMAT_ILLEGAL. */
export function decode(word: number): DecodedInstruction {
	const opcode = opcodeField(word)
	return {
		word: word >>> 0,
		opcode,
		format: OPCODE_FORMAT[opcode],
		rc: rcField(word),
		ra: raField(word),
		rb: rbField(word),
		literal: literalField(word),
	}
}
