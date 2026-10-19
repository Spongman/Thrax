/**
 * Encodings checked against words worked out by hand from the ARM ARM's
 * encoding diagrams (ARM DDI 0100, section A3), not against our decoder.
 */

import { describe, expect, it } from 'vitest'
import { assembleArm, DIALECT_ARMASM, DIALECT_GNU } from '../assembler'
import { decodeImmediate, encodeImmediate } from '../a32/isa'

const BASE = 0x8000

/** The words a GNU snippet assembles to, from BASE. */
function words(code: string, dialect = DIALECT_GNU): number[] {
	const { image, diagnostics } = assembleArm({ name: dialect === DIALECT_GNU ? 'test.s' : 'test.armasm', code }, { textBase: BASE, addressLimit: 2 ** 26 })
	expect(diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([])
	const section = image!.sections[0]
	expect(section.address).toBe(BASE)
	const view = new DataView(section.bytes.buffer, section.bytes.byteOffset, section.bytes.byteLength)
	return Array.from({ length: section.bytes.length / 4 }, (_unused, index) => view.getUint32(index * 4, true))
}

const one = (line: string) => words(`\t${line}\n`)[0]

describe('A32 encodings', () => {
	it.each([
		['mov r0, #0', 0xE3A00000],
		['mov r0, r1', 0xE1A00001],
		['add r0, r1, r2', 0xE0810002],
		['adds r0, r1, #1', 0xE2910001],
		['subs r0, r0, #1', 0xE2500001],
		['cmp r0, #10', 0xE350000A],
		['tst r0, #1', 0xE3100001],
		['rsb r0, r0, #0', 0xE2600000],
		['mov pc, lr', 0xE1A0F00E],
		['movs pc, lr', 0xE1B0F00E],
		['mov r0, #0xFF000000', 0xE3A004FF],
		['mvn r0, #0', 0xE3E00000],
		['teqp pc, #0', 0xE33FF000],
		['addeqs r0, r1, r2', 0x00910002],
		['addseq r0, r1, r2', 0x00910002],
		['orr r0, r0, r1, lsl r2', 0xE1800211],
		['mov r0, r1, lsl #2', 0xE1A00101],
		['mov r0, r1, lsr r2', 0xE1A00231],
		['mov r0, r0, rrx', 0xE1A00060],
		['mov r0, r1, asr #32', 0xE1A00041],
		['add r0, r1', 0xE0800001],
	])('data processing: %s', (line, expected) => {
		expect(one(line)).toBe(expected)
	})

	it.each([
		['mov r0, #-1', 0xE3E00000],
		['add r0, r0, #-4', 0xE2400004],
		['cmp r1, #-1', 0xE3710001],
		['and r0, r0, #0xFFFFFF00', 0xE3C000FF],
	])('swaps to the complementary operation: %s', (line, expected) => {
		expect(one(line)).toBe(expected)
	})

	it.each([
		['mul r0, r1, r2', 0xE0000291],
		['muls r0, r1, r2', 0xE0100291],
		['mla r0, r1, r2, r3', 0xE0203291],
		['swp r0, r1, [r2]', 0xE1020091],
		['swpb r0, r1, [r2]', 0xE1420091],
	])('multiply and swap: %s', (line, expected) => {
		expect(one(line)).toBe(expected)
	})

	it.each([
		['ldr r0, [r1]', 0xE5910000],
		['str r0, [r1, #4]', 0xE5810004],
		['ldr r0, [r1, #-4]', 0xE5110004],
		['ldrb r0, [r1], #1', 0xE4D10001],
		['ldr r0, [r1, r2, lsl #2]', 0xE7910102],
		['str r0, [r1, -r2]', 0xE7010002],
		['strb r0, [r1, #-1]!', 0xE5610001],
		['ldr r0, [r1, #4]!', 0xE5B10004],
		['ldrt r0, [r1], #4', 0xE4B10004],
		['ldreqb r0, [r1]', 0x05D10000],
		['ldrbeq r0, [r1]', 0x05D10000],
	])('single transfer: %s', (line, expected) => {
		expect(one(line)).toBe(expected)
	})

	it.each([
		['stmfd sp!, {r4, lr}', 0xE92D4010],
		['ldmfd sp!, {r4, pc}', 0xE8BD8010],
		['ldmfd sp!, {r4, pc}^', 0xE8FD8010],
		['stmia r0, {r1-r3}', 0xE880000E],
		['ldmdb r0!, {r1, r2}', 0xE9300006],
		['stmib r0, {r1}', 0xE9800002],
		['stmda r0, {r1}', 0xE8000002],
		['push {r0, lr}', 0xE92D4001],
		['pop {r0, pc}', 0xE8BD8001],
		['ldmeqia r0, {r1}', 0x08900002],
	])('block transfer: %s', (line, expected) => {
		expect(one(line)).toBe(expected)
	})

	it.each([
		['swi 0x11', 0xEF000011],
		['swieq 3', 0x0F000003],
		['svc 0', 0xEF000000],
		['b .', 0xEAFFFFFE],
		['bl .', 0xEBFFFFFE],
		['bne .', 0x1AFFFFFE],
		['nop', 0xE1A00000],
		['lsl r0, r1, #3', 0xE1A00181],
		['neg r0, r1', 0xE2610000],
	])('control and conveniences: %s', (line, expected) => {
		expect(one(line)).toBe(expected)
	})

	it('branches forward and back', () => {
		expect(words('\tb next\nnext:\tb start\nstart:\tbl next\n')).toEqual([0xEAFFFFFF, 0xEAFFFFFF, 0xEBFFFFFD])
	})

	it('reads conditions both ways round, and B with LS, LT and LE', () => {
		expect(one('bls .')).toBe(0x9AFFFFFE)
		expect(one('blt .')).toBe(0xBAFFFFFE)
		expect(one('ble .')).toBe(0xDAFFFFFE)
		expect(one('bleq .')).toBe(0x0BFFFFFE)
		expect(one('ldmfdeq sp!, {r0}')).toBe(0x08BD0001)
	})

	it('loads literals with MOV, MVN or a pool word', () => {
		expect(one('ldr r0, =255')).toBe(0xE3A000FF)
		expect(one('ldr r0, =0xFFFFFFFF')).toBe(0xE3E00000)
		// The pool word follows at BASE + 4: PC + 8 - 4.
		expect(words('\tldr r0, =0x12345678\n\t.ltorg\n')).toEqual([0xE51F0004, 0x12345678])
		// One word for equal values; the pool lands at the end of the section without .ltorg.
		expect(words('\tldr r0, =0x12345678\n\tldr r1, =0x12345678\n')).toEqual([0xE59F0000, 0xE51F1004, 0x12345678])
		// A label defined later always goes to the pool.
		expect(words('\tldr r0, =later\nlater:\n')).toEqual([0xE51F0004, BASE + 4])
	})

	it('ADR adds to or subtracts from PC', () => {
		expect(words('\tadr r0, there\nthere:\n\tadr r1, here\nhere:\n\tadr r2, there\n')).toEqual([0xE24F0004, 0xE24F1004, 0xE24F200C])
	})

	it('assembles the same words from armasm', () => {
		const code = '\tAREA Test, CODE\n\tMOV r0, #1\nloop\tSUBS r0, r0, #1\n\tBNE loop\n\tLDR r1, =0x12345678\n\tLTORG\n\tEND\n'
		expect(words(code, DIALECT_ARMASM)).toEqual([0xE3A00001, 0xE2500001, 0x1AFFFFFD, 0xE51F1004, 0x12345678])
	})
})

describe('immediate fields', () => {
	it.each([
		[0, 0x000], [0xFF, 0x0FF], [0x100, 0xC01], [0xFF000000, 0x4FF], [0xF000000F, 0x2FF], [0x3FC, 0xFFF],
	])('encodes %i', (value, field) => {
		expect(encodeImmediate(value)).toBe(field)
		expect(decodeImmediate(field)).toBe(value >>> 0)
	})

	it('refuses what no rotation fits', () => {
		expect(encodeImmediate(0x101)).toBe(-1)
		expect(encodeImmediate(0x12345678)).toBe(-1)
	})
})
