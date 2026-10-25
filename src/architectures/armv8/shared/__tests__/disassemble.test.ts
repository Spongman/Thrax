import { describe, expect, it } from 'vitest'
import { disassembleA32 } from '../a32/disassemble'
import { FORMAT_BLOCK, FORMAT_BRANCH, FORMAT_COPROCESSOR, FORMAT_DATA, FORMAT_MULTIPLY, FORMAT_SWAP, FORMAT_SWI, FORMAT_TRANSFER, FORMAT_UNDEFINED, formatOf } from '../a32/isa'

describe('A32 disassembly', () => {
	it.each([
		[0xE3A00000, 'mov r0, #0'],
		[0xE0810002, 'add r0, r1, r2'],
		[0x00910002, 'addeqs r0, r1, r2'],
		[0xE3A004FF, 'mov r0, #0xff000000'],
		[0xE1B0F00E, 'movs pc, lr'],
		[0xE33FF000, 'teqp pc, #0'],
		[0xE350000A, 'cmp r0, #10'],
		[0xE1800211, 'orr r0, r0, r1, lsl r2'],
		[0xE1A00060, 'mov r0, r0, rrx'],
		[0xE1A00041, 'mov r0, r1, asr #32'],
		[0xE0203291, 'mla r0, r1, r2, r3'],
		[0xE0100291, 'muls r0, r1, r2'],
		[0xE1420091, 'swpb r0, r1, [r2]'],
		[0xE5910000, 'ldr r0, [r1]'],
		[0xE5110004, 'ldr r0, [r1, #-4]'],
		[0xE4D10001, 'ldrb r0, [r1], #1'],
		[0xE7910102, 'ldr r0, [r1, r2, lsl #2]'],
		[0xE7010002, 'str r0, [r1, -r2]'],
		[0xE5610001, 'strb r0, [r1, #-1]!'],
		[0xE4B10004, 'ldrt r0, [r1], #4'],
		[0xE92D4010, 'stmfd sp!, {r4, lr}'],
		[0xE8FD8010, 'ldmfd sp!, {r4, pc}^'],
		[0xE880000E, 'stmia r0, {r1-r3}'],
		[0xE9300006, 'ldmdb r0!, {r1, r2}'],
		[0xEF000011, 'swi 0x11'],
	])('%s reads as %s', (word, text) => {
		expect(disassembleA32(word, 0x8000)).toBe(text)
	})

	it('writes branch targets and PC-relative loads as addresses', () => {
		expect(disassembleA32(0xEAFFFFFE, 0x8000)).toBe('b 0x00008000')
		expect(disassembleA32(0x1BFFFFFD, 0x8008)).toBe('blne 0x00008004')
		expect(disassembleA32(0xE51F1004, 0x800C)).toBe('ldr r1, [pc, #-4]  ; 0x00008010')
	})

	it('sorts words into their classes', () => {
		expect(formatOf(0xE0810002)).toBe(FORMAT_DATA)
		expect(formatOf(0xE0000291)).toBe(FORMAT_MULTIPLY)
		expect(formatOf(0xE1020091)).toBe(FORMAT_SWAP)
		expect(formatOf(0xE5910000)).toBe(FORMAT_TRANSFER)
		expect(formatOf(0xE8BD8010)).toBe(FORMAT_BLOCK)
		expect(formatOf(0xEAFFFFFE)).toBe(FORMAT_BRANCH)
		expect(formatOf(0xEF000000)).toBe(FORMAT_SWI)
		expect(formatOf(0xEE000000)).toBe(FORMAT_COPROCESSOR)
		// LDRH (ARMv4), MRS (ARMv3) and the architecturally undefined space.
		expect(formatOf(0xE1D000B0)).toBe(FORMAT_UNDEFINED)
		expect(formatOf(0xE10F0000)).toBe(FORMAT_UNDEFINED)
		expect(formatOf(0xE7F000F0)).toBe(FORMAT_UNDEFINED)
	})
})
