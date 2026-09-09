import { describe, expect, it } from 'vitest'
import { afterWrite, applyNibble, asciiByte, beforeCaret, Column, hexDigit, moveCaret, type Caret, type CaretBounds } from '../memoryCaret'

/*
 * Two rows of eight bytes in groups of four, which is enough for every move to
 * have somewhere to go.  The hex column draws a group most significant first,
 * so the first row reads 03 02 01 00 | 07 06 05 04 across the screen and the
 * second 0b 0a 09 08 | 0f 0e 0d 0c.  Typing follows the screen, so those are
 * the orders the moves below are in.
 */
const bounds: CaretBounds = { start: 0x10010000, end: 0x1001000f, origin: 0x10010000, stride: 8, group: 4, page: 1 }

const hex = (address: number, nibble = 0): Caret => ({ address, nibble, column: Column.HEX })
const ascii = (address: number): Caret => ({ address, nibble: 0, column: Column.ASCII })

describe('moving the caret', () => {
	it('crosses a byte a nibble at a time in the hex column', () => {
		expect(moveCaret(hex(0x10010003, 0), 'ArrowRight', bounds)).toEqual(hex(0x10010003, 1))
		expect(moveCaret(hex(0x10010003, 1), 'ArrowRight', bounds)).toEqual(hex(0x10010002, 0))
		expect(moveCaret(hex(0x10010002, 0), 'ArrowLeft', bounds)).toEqual(hex(0x10010003, 1))
	})

	it('reads the hex column left to right, whatever that does to the address', () => {
		// The digits are typed in the order they are drawn, so a group is entered
		// most significant byte first and the address counts down through it.
		const typed: number[] = []
		let caret = hex(0x10010003, 0)
		for (let step = 0; step < 8; step++) {
			typed.push(caret.address & 0xff)
			caret = afterWrite(afterWrite(caret, bounds), bounds)
		}
		expect(typed).toEqual([0x03, 0x02, 0x01, 0x00, 0x07, 0x06, 0x05, 0x04])
	})

	it('steps between groups the way the screen does', () => {
		// The last byte of the first group is followed by the first of the second.
		expect(moveCaret(hex(0x10010000, 1), 'ArrowRight', bounds)).toEqual(hex(0x10010007, 0))
		expect(moveCaret(hex(0x10010007, 0), 'ArrowLeft', bounds)).toEqual(hex(0x10010000, 1))
	})

	it('keeps the ascii column in address order, where a byte is a character', () => {
		expect(moveCaret(ascii(0x10010003), 'ArrowRight', bounds)).toEqual(ascii(0x10010004))
	})

	it('crosses a byte at a time in the ascii column, where a keystroke is a byte', () => {
		expect(moveCaret(ascii(0x10010000), 'ArrowRight', bounds)).toEqual(ascii(0x10010001))
		expect(moveCaret(ascii(0x10010001), 'ArrowLeft', bounds)).toEqual(ascii(0x10010000))
	})

	it('refuses a byte move past either end rather than turning it into a nibble move', () => {
		// Clamping the address alone would answer a left arrow at the first digit by
		// moving right, onto the second nibble of it.  The ends are the ends of the
		// column as drawn: the leftmost digit of the first row and the rightmost of
		// the last.
		expect(moveCaret(hex(0x10010003, 0), 'ArrowLeft', bounds)).toEqual(hex(0x10010003, 0))
		expect(moveCaret(hex(0x1001000c, 1), 'ArrowRight', bounds)).toEqual(hex(0x1001000c, 1))
	})

	it('moves a row at a time, keeping the nibble and the place on the row', () => {
		// A row is a whole number of groups, so the same address step is the same
		// place on the row however the groups are drawn.
		expect(moveCaret(hex(0x10010003, 1), 'ArrowDown', bounds)).toEqual(hex(0x1001000b, 1))
		expect(moveCaret(hex(0x1001000b, 1), 'ArrowUp', bounds)).toEqual(hex(0x10010003, 1))
	})

	it('lands a page move on the end it is heading for rather than refusing it', () => {
		expect(moveCaret(hex(0x10010003), 'PageDown', bounds)).toEqual(hex(0x1001000b))
		expect(moveCaret(hex(0x1001000b), 'PageDown', bounds)).toEqual(hex(0x1001000f))
		expect(moveCaret(hex(0x1001000b), 'PageUp', bounds)).toEqual(hex(0x10010003))
	})

	it('takes home and end to the ends of the row as it is drawn', () => {
		// The leftmost digit of the second row is the top byte of its first group,
		// and the rightmost is the bottom byte of its last.
		expect(moveCaret(hex(0x10010009, 1), 'Home', bounds)).toEqual(hex(0x1001000b))
		expect(moveCaret(hex(0x10010009, 1), 'End', bounds)).toEqual(hex(0x1001000c))
		// The ascii column reads in address order, so its ends are the plain ones.
		expect(moveCaret(ascii(0x10010009), 'Home', bounds)).toEqual(ascii(0x10010008))
		expect(moveCaret(ascii(0x10010009), 'End', bounds)).toEqual(ascii(0x1001000f))
	})

	it('reads a byte at a time when a group is one byte, hex column and all', () => {
		const single: CaretBounds = { ...bounds, group: 1 }
		expect(moveCaret(hex(0x10010000, 1), 'ArrowRight', single)).toEqual(hex(0x10010001, 0))
		expect(moveCaret(hex(0x10010004, 1), 'Home', single)).toEqual(hex(0x10010000))
	})

	it('measures a row from the window origin rather than from a round address', () => {
		// Rows are drawn from wherever the window starts, so home is the first byte
		// of the row as it is drawn and not the nearest multiple of the stride.
		const offset: CaretBounds = { start: 0x10010004, end: 0x10010013, origin: 0x10010004, stride: 8, group: 1, page: 1 }
		expect(moveCaret(hex(0x1001000b), 'Home', offset)).toEqual(hex(0x10010004))
		expect(moveCaret(hex(0x1001000b), 'End', offset)).toEqual(hex(0x1001000b))
	})

	it('swaps columns on tab, and drops the nibble the hex column had', () => {
		expect(moveCaret(hex(0x10010004, 1), 'Tab', bounds)).toEqual(ascii(0x10010004))
		expect(moveCaret(ascii(0x10010004), 'Tab', bounds)).toEqual(hex(0x10010004, 0))
	})

	it('says nothing about a key that is not a movement', () => {
		for (const key of ['a', 'Enter', 'Insert', 'Delete', 'Escape']) {
			expect(moveCaret(hex(0x10010004), key, bounds), key).toBeNull()
		}
	})
})

describe('typing', () => {
	it('advances over the nibble just written', () => {
		expect(afterWrite(hex(0x10010003, 0), bounds)).toEqual(hex(0x10010003, 1))
		expect(afterWrite(hex(0x10010003, 1), bounds)).toEqual(hex(0x10010002, 0))
		expect(afterWrite(ascii(0x10010000), bounds)).toEqual(ascii(0x10010001))
	})

	it('names the byte a backspace acts on, which is the one to the left of it', () => {
		expect(beforeCaret(hex(0x10010002, 1), bounds)).toEqual(hex(0x10010003, 0))
		expect(beforeCaret(ascii(0x10010004), bounds)).toEqual(ascii(0x10010003))
		// Nothing to the left of the leftmost digit, so the caret stays put.
		expect(beforeCaret(hex(0x10010003, 0), bounds)).toEqual(hex(0x10010003, 0))
		expect(beforeCaret(ascii(0x10010000), bounds)).toEqual(ascii(0x10010000))
	})

	it('writes the first digit typed into the high half of the byte', () => {
		expect(applyNibble(0x00, 0, 0xa)).toBe(0xa0)
		expect(applyNibble(0xa0, 1, 0xb)).toBe(0xab)
		expect(applyNibble(0xab, 0, 0xc)).toBe(0xcb)
	})

	it('reads a hex digit and nothing else', () => {
		expect(hexDigit('0')).toBe(0)
		expect(hexDigit('f')).toBe(15)
		expect(hexDigit('F')).toBe(15)
		for (const key of ['g', 'ArrowLeft', ' ', '', '-']) expect(hexDigit(key), key).toBeNull()
	})

	it('takes a character as its byte, up to the top of latin-1', () => {
		expect(asciiByte('A')).toBe(0x41)
		expect(asciiByte(' ')).toBe(0x20)
		expect(asciiByte('ÿ')).toBe(0xff)
		// A key that is a name, and a character that would not fit in a byte.
		for (const key of ['Enter', 'ArrowUp', '€']) expect(asciiByte(key), key).toBeNull()
	})
})
