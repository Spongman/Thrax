/**
 * Hexadecimal formatting.
 *
 * One spelling of a 32-bit value everywhere it is shown, so the memory view,
 * the disassembly gutter, and the tools cannot drift apart.  The HexText
 * export is deliberately not built on this: that is a file format with its own
 * lowercase rule, not something on screen.
 */

/** `0x0040000C`: the way this workspace writes a word or an address. */
export function formatWord(value: number): string {
	return `0x${(value >>> 0).toString(16).toUpperCase().padStart(8, '0')}`
}

/** `0x0040000C` without the prefix, for columns that supply their own. */
export function formatWordDigits(value: number): string {
	return (value >>> 0).toString(16).toUpperCase().padStart(8, '0')
}

/** A half-word, byte, or other narrow field, padded to `digits`. */
export function formatHex(value: number, digits: number): string {
	return (value >>> 0).toString(16).toUpperCase().padStart(digits, '0')
}

/** A register of `bits` bits in hex, padded to its own width; 32 bits and wider as a word. */
export function formatRegister(value: number, bits: number): string {
	if (bits >= 32) return formatWord(value)
	return `0x${formatHex((value >>> 0) % 2 ** bits, Math.ceil(bits / 4))}`
}

/**
 * The inverse of `formatWord`: parses a hex or decimal integer literal, or
 * returns null when `text` is not one.
 *
 * Accepts optional leading/trailing whitespace, an optional leading `-`, then
 * either `0x`/`0X` followed by hex digits or plain decimal digits.  Anything
 * else - empty, a bare `0x`, a float, an exponent - returns null rather than
 * guessing.  The result is signed; callers mask with `>>> 0` where a 32-bit
 * unsigned value is wanted.
 */
export function parseWord(text: string): number | null {
	const match = /^(-?)(?:0x([0-9a-f]+)|(\d+))$/i.exec(text.trim())
	if (!match) return null
	const sign = match[1] ? -1 : 1
	const magnitude = match[2] !== undefined ? Number.parseInt(match[2], 16) : Number.parseInt(match[3], 10)
	return sign * magnitude
}
