import { describe, expect, it } from 'vitest'
import type { DataEntry, MemoryView } from '../../core/types'
import { dataRuns, runAt, valueOf } from '../symbolValue'

/**
 * A symbol says more than an address when the assembler wrote down what laid
 * its bytes out.  These check the lookup and the reading of each directive,
 * since a `.float` read as a `.word` is a number nobody would recognise.
 */

const entries: DataEntry[] = [
	{ address: 0x10010000, bytes: [1, 2, 3, 4], directive: '.word' },
	{ address: 0x10010004, bytes: [0, 0, 0, 0], directive: '.float' },
	{ address: 0x10010008, bytes: [0, 0, 0, 0, 0, 0, 0, 0], directive: '.double' },
	{ address: 0x10010010, bytes: [0, 0, 0, 0, 0, 0], directive: '.asciiz' },
	{ address: 0x10010020, bytes: [0, 0, 0, 0], directive: '.space' },
	// A run the assembler laid out without a directive of its own says nothing.
	{ address: 0x10010030, bytes: [0, 0, 0, 0] },
]

const runs = dataRuns(entries)

/** Memory holds words, so a value is written as the word it sits in. */
const memoryOf = (words: Array<[number, number]>): MemoryView => ({
	words: new Map(words.map(([address, value]) => [address >>> 2, value])),
})

describe('what a symbol was declared as', () => {
	it('finds the run an address falls in', () => {
		expect(runAt(runs, 0x10010000)?.directive).toBe('.word')
		expect(runAt(runs, 0x10010002)?.directive).toBe('.word')
		expect(runAt(runs, 0x10010004)?.directive).toBe('.float')
		expect(runAt(runs, 0x10010012)?.directive).toBe('.asciiz')
	})

	it('says nothing about an address no directive laid out', () => {
		expect(runAt(runs, 0x0040_0000)).toBeUndefined()
		expect(runAt(runs, 0x10010030)).toBeUndefined()
		expect(runAt(runs, 0x10010100)).toBeUndefined()
	})
})

describe('the value stored there', () => {
	it('reads a word as a signed number', () => {
		const memory = memoryOf([[0x10010000, 0xfffffffe]])
		expect(valueOf(memory, runAt(runs, 0x10010000)!, 0x10010000)).toBe('-2')
	})

	it('reads a float as a number with a point in it', () => {
		// 1.5 is 0x3fc00000 as an IEEE 754 single.
		const memory = memoryOf([[0x10010004, 0x3fc00000]])
		expect(valueOf(memory, runAt(runs, 0x10010004)!, 0x10010004)).toBe('1.5')
	})

	it('reads a double from the pair of words that hold it', () => {
		// 2.5 is 0x4004000000000000, low word first in memory.
		const memory = memoryOf([[0x10010008, 0x00000000], [0x1001000c, 0x40040000]])
		expect(valueOf(memory, runAt(runs, 0x10010008)!, 0x10010008)).toBe('2.5')
	})

	it('reads a string up to its terminator', () => {
		// "hi", little-endian within the word, then a NUL.
		const memory = memoryOf([[0x10010010, 0x00006968], [0x10010014, 0 ]])
		expect(valueOf(memory, runAt(runs, 0x10010010)!, 0x10010010)).toBe('"hi"')
	})

	it('says nothing for space, which nothing wrote', () => {
		const memory = memoryOf([[0x10010020, 0x41414141]])
		expect(valueOf(memory, runAt(runs, 0x10010020)!, 0x10010020)).toBeNull()
	})

	it('says nothing where memory does not hold the bytes', () => {
		expect(valueOf(memoryOf([]), runAt(runs, 0x10010000)!, 0x10010000)).toBeNull()
	})

	// The value is read from memory rather than from the program, so a word the
	// program wrote is the word the table shows.
	it('follows what the program wrote, not what was assembled', () => {
		const memory = memoryOf([[0x10010000, 7]])
		expect(valueOf(memory, runAt(runs, 0x10010000)!, 0x10010000)).toBe('7')
	})
})
