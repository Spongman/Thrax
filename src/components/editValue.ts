/**
 * Reading a value the user typed into a register or memory cell.
 *
 * The cell shows one radix, so the text is read as that radix first; a `0x`
 * prefix still names hexadecimal wherever it appears, since that is how the
 * rest of the workspace writes an address. A float cell reads a float and
 * hands back the bit pattern, which is what the machine stores.
 */

import { doubleToBits, singleToBits } from '../core/coprocessor'

/** How a cell is being shown, which is how what is typed into it is read. */
export type EditFormat = '0n' | '0x' | 'f' | 'd'

/** The 32-bit word a cell now holds, or null when the text is not a value. */
export function parseEditedValue(text: string, format: EditFormat): number | null {
	const trimmed = text.trim()
	if (trimmed === '') return null

	if (format === 'f' || format === 'd') {
		const value = Number(trimmed)
		if (!Number.isFinite(value) && !/^-?(inf(inity)?|nan)$/i.test(trimmed)) return null
		// A double is written across a register pair; this is its low word, and
		// `parseEditedDouble` gives the caller both halves.
		return format === 'f' ? singleToBits(value) : doubleToBits(value).low
	}

	const negative = trimmed.startsWith('-')
	const body = negative ? trimmed.slice(1) : trimmed
	const hexadecimal = /^0[xX][0-9a-fA-F]+$/.test(body)
	if (!hexadecimal && format === '0x' && !/^[0-9a-fA-F]+$/.test(body)) return null
	if (!hexadecimal && format === '0n' && !/^[0-9]+$/.test(body)) return null

	const magnitude = hexadecimal ? Number.parseInt(body.slice(2), 16)
		: format === '0x' ? Number.parseInt(body, 16)
			: Number.parseInt(body, 10)
	if (!Number.isFinite(magnitude)) return null
	return ((negative ? -magnitude : magnitude) >>> 0)
}

/**
 * What an edit starts from, which is not quite what the cell shows: a hex value
 * comes without its leading zero run.  They are the digits nobody means to
 * keep, and eight of them stand between the caret and anything worth typing.
 * One zero survives, so a zero value is still a value.
 */
export const withoutLeadingZeros = (text: string) => text.replace(/^(0[xX])0+(?=.)/, '$1')

/** Both words of a double, since it occupies an even register and its odd partner. */
export function parseEditedDouble(text: string): { low: number, high: number } | null {
	const value = Number(text.trim())
	if (!Number.isFinite(value)) return null
	return doubleToBits(value)
}
