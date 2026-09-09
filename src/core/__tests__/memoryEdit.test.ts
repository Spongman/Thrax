import { describe, expect, it } from 'vitest'
import { build } from './helpers'
import { DEFAULT_SETTINGS, MEMORY_CONFIGURATIONS } from '../settings'

const DATA = MEMORY_CONFIGURATIONS[DEFAULT_SETTINGS.memoryConfiguration].dataBaseAddress

const source = `
	.data
text:	.asciiz "Hello"
	.text
main:	li $v0, 10
	syscall
`

const bytes = (machine: ReturnType<typeof build>, count: number) =>
	Array.from({ length: count }, (unused, offset) => machine.readMemory(DATA + offset, 1))

describe('editing memory a byte at a time', () => {
	it('writes the byte the caret is on, leaving the rest of the word alone', () => {
		const machine = build(source)
		expect(machine.setMemoryByte(DATA + 1, 0x41)).toBe(true)
		expect(bytes(machine, 6)).toEqual([0x48, 0x41, 0x6c, 0x6c, 0x6f, 0x00])
	})

	it('writes a byte at an odd address, which a word edit refuses', () => {
		const machine = build(source)
		expect(machine.setMemoryWord(DATA + 1, 0)).toBe(false)
		expect(machine.setMemoryByte(DATA + 1, 0x41)).toBe(true)
		expect(machine.readMemory(DATA + 1, 1)).toBe(0x41)
	})

	it('steps back out of a byte edit', () => {
		const machine = build(source)
		machine.setMemoryByte(DATA, 0x41)
		expect(machine.readMemory(DATA, 1)).toBe(0x41)
		expect(machine.stepBack()).toBe(true)
		expect(machine.readMemory(DATA, 1)).toBe(0x48)
	})
})

describe('making room for a byte', () => {
	it('moves the region up and drops what reaches the end', () => {
		const machine = build(source)
		expect(machine.insertMemoryByte(DATA, DATA + 5, 0x41)).toBe(true)
		// "Hello\0" becomes "AHello", and the terminator is the byte pushed off.
		expect(bytes(machine, 6)).toEqual([0x41, 0x48, 0x65, 0x6c, 0x6c, 0x6f])
	})

	it('inserts in the middle without disturbing what is before it', () => {
		const machine = build(source)
		machine.insertMemoryByte(DATA + 2, DATA + 7, 0x41)
		expect(bytes(machine, 7)).toEqual([0x48, 0x65, 0x41, 0x6c, 0x6c, 0x6f, 0x00])
	})

	it('crosses a word boundary, since a region is bytes and not words', () => {
		const machine = build(source)
		machine.insertMemoryByte(DATA, DATA + 7, 0x41)
		expect(bytes(machine, 7)).toEqual([0x41, 0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00])
	})

	it('steps back out of the whole shift, not just the byte typed', () => {
		const machine = build(source)
		machine.insertMemoryByte(DATA, DATA + 7, 0x41)
		expect(machine.stepBack()).toBe(true)
		expect(bytes(machine, 6)).toEqual([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00])
	})

	it('refuses a region that ends before it starts', () => {
		const machine = build(source)
		expect(machine.insertMemoryByte(DATA + 4, DATA, 0x41)).toBe(false)
	})
})

describe('taking a byte away', () => {
	it('moves the region down and zeroes the end of it', () => {
		const machine = build(source)
		expect(machine.deleteMemoryByte(DATA, DATA + 5)).toBe(true)
		expect(bytes(machine, 6)).toEqual([0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x00])
	})

	it('undoes an insert at the same address', () => {
		const machine = build(source)
		machine.insertMemoryByte(DATA, DATA + 7, 0x41)
		machine.deleteMemoryByte(DATA, DATA + 7)
		expect(bytes(machine, 6)).toEqual([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00])
	})

	it('steps back out of the shift', () => {
		const machine = build(source)
		machine.deleteMemoryByte(DATA, DATA + 7)
		expect(machine.stepBack()).toBe(true)
		expect(bytes(machine, 6)).toEqual([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00])
	})
})
