/**
 * Where typing lands in the memory window, and where each key moves it.
 *
 * The window is a hex editor rather than a grid of edit boxes: a caret sits on
 * one nibble of one byte, or on one character of the ASCII column, and a key
 * writes there and moves on.  Every one of those keys is arithmetic over an
 * address, so what a key does is decided here and only drawn by the panel.
 */

/** Which column the caret is in.  A column is dispatched on, so it is a number. */
export class Column {
	static readonly HEX = 0
	static readonly ASCII = 1
}

export interface Caret {
	/** The byte the caret is on. */
	address: number
	/** Which half of that byte: 0 is the digit written first.  ASCII has one. */
	nibble: number
	column: number
}

/** How far the caret can go, and how far one key takes it. */
export interface CaretBounds {
	/** First and last byte on show, which the caret stays between. */
	start: number
	end: number
	/** Address of the first byte of the first row, which rows are measured from. */
	origin: number
	/** Bytes on a row, so up and down move one row. */
	stride: number
	/**
	 * Bytes in a hex group.  The column shows a group's bytes most significant
	 * first, so within one group the byte to the right of another is the byte
	 * *below* it in address, and a move across the column has to be worked out
	 * in what is on screen rather than in addresses.
	 */
	group: number
	/** Rows a page key moves. */
	page: number
}

const clamp = (address: number, bounds: CaretBounds) =>
	Math.max(bounds.start, Math.min(bounds.end, address))

/** The first byte of the row an address is on. */
const rowStart = (address: number, bounds: CaretBounds) =>
	address - ((address - bounds.origin) % bounds.stride)

/**
 * Display order and address order are each other's mirror inside a group, so
 * one function carries an offset either way: the nth byte from the left of a
 * group is the nth from the top of its addresses.
 */
const flip = (offset: number, group: number) => {
	const within = offset % group
	return offset - within + (group - 1 - within)
}

/** Where an address sits along the hex column, counting from the origin. */
const column = (address: number, bounds: CaretBounds) => flip(address - bounds.origin, bounds.group)

/** The address at a place along the hex column. */
const columnAddress = (place: number, bounds: CaretBounds) => bounds.origin + flip(place, bounds.group)

/** A position the caret can hold, with the column deciding whether a nibble does. */
const at = (address: number, nibble: number, column: number): Caret =>
	({ address, nibble: column === Column.ASCII ? 0 : nibble, column })

/**
 * A move by rows lands as near the asked-for row as the window reaches, since
 * a page down near the end means the end.  A move by bytes past either end is
 * refused instead, so a caret already at the first byte does not answer a left
 * arrow by moving right into the second nibble of it.
 */
const rowwise = (address: number, caret: Caret, bounds: CaretBounds): Caret =>
	at(clamp(address, bounds), caret.nibble, caret.column)

const bytewise = (address: number, nibble: number, caret: Caret, bounds: CaretBounds): Caret =>
	address < bounds.start || address > bounds.end ? caret : at(address, nibble, caret.column)

/**
 * A byte move along the hex column, which follows the digits as they are drawn.
 * Typing reads left to right, so the byte after the one being typed is the byte
 * to the right of it, whichever address that turns out to be.
 */
const alongColumn = (steps: number, nibble: number, caret: Caret, bounds: CaretBounds): Caret => {
	const place = column(caret.address, bounds) + steps
	if (place < 0) return caret
	return bytewise(columnAddress(place, bounds), nibble, caret, bounds)
}

/**
 * Where `key` takes the caret, or null when it is not a movement.
 *
 * Left and right cross a byte a nibble at a time in the hex column, since that
 * is the unit typing writes there, and a character at a time in the ASCII
 * column, where a keystroke is a whole byte.
 */
export function moveCaret(caret: Caret, key: string, bounds: CaretBounds): Caret | null {
	const { address, nibble, column: here } = caret
	const wide = here === Column.ASCII
	const start = rowStart(address, bounds)
	const last = start + bounds.stride - 1
	switch (key) {
		case 'ArrowRight':
			if (wide) return bytewise(address + 1, 0, caret, bounds)
			if (nibble === 1) return alongColumn(1, 0, caret, bounds)
			return at(address, 1, here)
		case 'ArrowLeft':
			if (wide) return bytewise(address - 1, 0, caret, bounds)
			if (nibble === 0) return alongColumn(-1, 1, caret, bounds)
			return at(address, 0, here)
		case 'ArrowUp': return rowwise(address - bounds.stride, caret, bounds)
		case 'ArrowDown': return rowwise(address + bounds.stride, caret, bounds)
		case 'PageUp': return rowwise(address - bounds.stride * bounds.page, caret, bounds)
		case 'PageDown': return rowwise(address + bounds.stride * bounds.page, caret, bounds)
		// The ends of the row as it is drawn: in the hex column the leftmost digit
		// belongs to the top byte of the first group, and the rightmost to the
		// bottom byte of the last.
		case 'Home': return at(clamp(wide ? start : columnAddress(start - bounds.origin, bounds), bounds), 0, here)
		case 'End': return at(clamp(wide ? last : columnAddress(start - bounds.origin + bounds.stride - 1, bounds), bounds), 0, here)
		case 'Tab': return at(address, 0, wide ? Column.HEX : Column.ASCII)
		default: return null
	}
}

/** Where the caret goes once a keystroke has been written where it was. */
export const afterWrite = (caret: Caret, bounds: CaretBounds): Caret =>
	moveCaret(caret, 'ArrowRight', bounds) ?? caret

/** The byte before the caret's, which is what a backspace acts on. */
export const beforeCaret = (caret: Caret, bounds: CaretBounds): Caret =>
	caret.column === Column.ASCII
		? bytewise(caret.address - 1, 0, caret, bounds)
		: alongColumn(-1, 0, caret, bounds)

/** `byte` with one of its halves replaced; nibble 0 is the high one. */
export const applyNibble = (byte: number, nibble: number, digit: number) =>
	nibble === 0 ? ((digit << 4) | (byte & 0x0f)) : ((byte & 0xf0) | digit)

/** The value of a typed hex digit, or null when the key is not one. */
export function hexDigit(key: string): number | null {
	if (key.length !== 1) return null
	const value = Number.parseInt(key, 16)
	return Number.isNaN(value) ? null : value
}

/**
 * The byte a typed key stands for in the ASCII column, or null when the key is
 * not a character.  Latin-1 and no further: a byte is a byte, and a keystroke
 * that needs two of them is not one this column can take.
 */
export function asciiByte(key: string): number | null {
	if (key.length !== 1) return null
	const code = key.charCodeAt(0)
	return code >= 0x20 && code <= 0xff ? code : null
}
