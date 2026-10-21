/**
 * Hexadecimal register and address formatting.
 *
 * Register words wrap at 32 bits; addresses retain every safe integer bit.
 * Views and tools use separate formatters so address navigation cannot wrap.  The HexText
 * export is deliberately not built on this: that is a file format with its own
 * lowercase rule, not something on screen.
 */

/** `0x0040000C`: the way this workspace writes a 32-bit word. */
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
export function formatRegister(value: number | bigint, bits: number): string {
	// A register wider than a word holds a bigint, padded to its own width.
	if (typeof value === 'bigint') return `0x${BigInt.asUintN(bits, value).toString(16).toUpperCase().padStart(Math.ceil(bits / 4), '0')}`
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

/** Workbench addresses are exact, nonnegative JS integers. Registers wider than
 * 32 bits remain bigint; an address beyond this range cannot navigate the UI. */
export function isAddress(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function formatAddress(value: number): string {
	return isAddress(value) ? `0x${value.toString(16).toUpperCase().padStart(8, '0')}` : '—'
}

export function parseAddress(text: string): number | null {
	const value = parseWord(text)
	return isAddress(value) ? value : null
}

/** Signed number registers represent 32-bit bit patterns, as in RegisterValue. */
export function registerAddress(value: number | bigint): number | null {
	if (typeof value === 'bigint') return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null
	return isAddress(value) ? value : Number.isInteger(value) && value >= -0x80000000 && value < 0 ? value >>> 0 : null
}
