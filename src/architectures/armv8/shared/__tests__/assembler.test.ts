import { describe, expect, it } from 'vitest'
import { ARCH_V8 } from '../a32/isa'
import { assembleArm, DIALECT_ARMASM, DIALECT_GNU, dialectFor } from '../assembler'

const BASE = 0x8000
const options = { textBase: BASE, addressLimit: 2 ** 26 }

const errors = (name: string, code: string) => assembleArm({ name, code }, options).diagnostics.filter((diagnostic) => diagnostic.severity === 'error')

/** The bytes at `address` of an assembled image. */
function bytesAt(code: string, name: string, address: number, length: number): number[] {
	const { image, diagnostics } = assembleArm({ name, code }, options)
	expect(diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([])
	const section = image!.sections.find((candidate) => address >= candidate.address && address + length <= candidate.address + candidate.bytes.length)
	expect(section).toBeDefined()
	return Array.from(section!.bytes.subarray(address - section!.address, address - section!.address + length))
}

describe('dialect choice', () => {
	it('goes by extension, then by content, then by the setting', () => {
		expect(dialectFor('main.s', '\tAREA x, CODE\n', DIALECT_ARMASM)).toBe(DIALECT_GNU)
		expect(dialectFor('main.S', '', DIALECT_ARMASM)).toBe(DIALECT_GNU)
		expect(dialectFor('main.armasm', '\t.text\n', DIALECT_GNU)).toBe(DIALECT_ARMASM)
		expect(dialectFor('main.asm', '\tAREA x, CODE\n', DIALECT_GNU)).toBe(DIALECT_ARMASM)
		expect(dialectFor('main.asm', '\t.text\n', DIALECT_ARMASM)).toBe(DIALECT_GNU)
		expect(dialectFor('main.asm', 'start: mov r0, #1\n', DIALECT_ARMASM)).toBe(DIALECT_ARMASM)
		expect(dialectFor('untitled.asm', '', DIALECT_GNU)).toBe(DIALECT_GNU)
	})
})

describe('GNU as', () => {
	it('lays out .data after the code, word aligned', () => {
		const { image, values } = assembleArm({ name: 'a.s', code: '\t.text\n_start:\tldr r0, =message\n\tswi 0x11\n\t.data\nmessage:\t.asciz "hi"\n' }, options)
		// Two instructions and a pool word, then the data.
		expect(values.get('message')).toBe(BASE + 12)
		expect(image!.entryAddress).toBe(BASE)
		expect(bytesAt('\t.data\nmessage:\t.asciz "hi"\n\t.text\n\tldr r0, =message\n', 'a.s', BASE + 8, 3)).toEqual([0x68, 0x69, 0])
	})

	it('starts at _start when it is defined', () => {
		const { image } = assembleArm({ name: 'a.s', code: '\tnop\n_start:\tnop\n' }, options)
		expect(image!.entryAddress).toBe(BASE + 4)
	})

	it('lays out data directives little-endian', () => {
		const code = '\t.word 0x11223344, label\n\t.hword 0x5566\n\t.byte 1, -1, \'A\'\n\t.align 2\nlabel:\t.ascii "ab"\n\t.balign 4\n\t.space 4\n\t.space 2, 0xEE\n'
		expect(bytesAt(code, 'a.s', BASE, 20)).toEqual([0x44, 0x33, 0x22, 0x11, 0x10, 0x80, 0, 0, 0x66, 0x55, 1, 0xFF, 0x41, 0, 0, 0, 0x61, 0x62, 0, 0])
		// Zero-filled space is skipped rather than written.
		expect(bytesAt(code, 'a.s', BASE + 0x18, 2)).toEqual([0xEE, 0xEE])
	})

	it('reads equates, expressions and local labels', () => {
		const code = 'COUNT = 3\n\t.equ SHIFTED, COUNT << 2 | 1\n1:\tsubs r0, r0, #SHIFTED\n\tbne 1b\n\tb 1f\n1:\tmov r1, #(COUNT * 2) % 4\n'
		const { image, values, diagnostics } = assembleArm({ name: 'a.s', code }, options)
		expect(diagnostics).toEqual([])
		expect(values.get('SHIFTED')).toBe(13)
		const view = new DataView(image!.sections[0].bytes.buffer)
		expect(view.getUint32(0, true)).toBe(0xE250000D)
		expect(view.getUint32(4, true)).toBe(0x1AFFFFFD)
		expect(view.getUint32(8, true)).toBe(0xEAFFFFFF)
		expect(view.getUint32(12, true)).toBe(0xE3A01002)
	})

	it('expands macros with parameters and \\@', () => {
		const code = '.macro inc reg, by=1\n\tadd \\reg, \\reg, #\\by\n.endm\n.macro spin\nloop\\@:\tb loop\\@\n.endm\n\tinc r1\n\tinc r2, 4\n\tspin\n\tspin\n'
		const { image, diagnostics } = assembleArm({ name: 'a.s', code }, options)
		expect(diagnostics).toEqual([])
		const view = new DataView(image!.sections[0].bytes.buffer)
		expect([0, 4, 8, 12].map((offset) => view.getUint32(offset, true))).toEqual([0xE2811001, 0xE2822004, 0xEAFFFFFE, 0xEAFFFFFE])
	})

	it('takes ; as a statement separator and @ as a comment', () => {
		const { image } = assembleArm({ name: 'a.s', code: '\tmov r0, #1 ; mov r1, #2 @ mov r2, #3\n' }, options)
		expect(image!.sections[0].bytes.length).toBe(8)
	})

	it('reports errors with their line and column', () => {
		// A parse error stops the build before layout.
		const parse = errors('a.s', '\tmov r0, #1\n\tmov r0, #0x101\n\tfrob r1\n')
		expect(parse.map((diagnostic) => diagnostic.line)).toEqual([3])
		expect(parse[0].message).toMatch(/^Unknown instruction 'frob'/)
		const layout = errors('a.s', '\tmov r0, #0x101\n\tldr r0, [r1, #5000]\n\tb nowhere\n')
		expect(layout.map((diagnostic) => diagnostic.line)).toEqual([1, 2, 3])
		expect(layout[0].column).toBe(11)
		expect(layout[0].message).toMatch(/^Immediate 0x101 is not an 8-bit value rotated by an even amount/)
		expect(layout[1].message).toMatch(/^Offset 5000 is out of range/)
		expect(layout[2].message).toMatch(/^Symbol 'nowhere' is undefined/)
	})

	it('says when an armasm file is read as GNU', () => {
		expect(errors('a.s', '\tAREA x, CODE\n')[0].message).toMatch(/AREA is armasm, so name the file \.armasm/)
	})

	it('refuses Thumb and duplicate labels', () => {
		expect(errors('a.s', '\t.thumb\n')[0].message).toMatch(/Thumb/)
		const duplicate = errors('a.s', 'x:\tnop\nx:\tnop\n')
		expect(duplicate[0].line).toBe(2)
		expect(duplicate[0].message).toMatch(/already defined on line 1/)
	})

	it('warns about MUL with Rd equal to Rm', () => {
		const { diagnostics } = assembleArm({ name: 'a.s', code: '\tmul r0, r0, r1\n' }, options)
		expect(diagnostics).toEqual([expect.objectContaining({ severity: 'warning', line: 1 })])
	})

	it('reports an unreachable literal pool', () => {
		const found = errors('a.s', '\tldr r0, =0x12345678\n\t.space 5000\n')
		expect(found[0].message).toMatch(/out of LDR's reach/)
		expect(found[0].line).toBe(1)
	})

	it('includes other workspace files', () => {
		const files = [{ name: 'lib.s', code: 'twice:\tadd r0, r0, r0\n\tmov pc, lr\n' }]
		const { values, diagnostics } = assembleArm({ name: 'main.s', code: '\tbl twice\n\t.include "lib.s"\n' }, { ...options, files })
		expect(diagnostics).toEqual([])
		expect(values.get('twice')).toBe(BASE + 4)
	})

	it('names SWIs by string from the predefined table', () => {
		const predefined = new Map([['OS_WriteC', 0], ['OS_Exit', 0x11]])
		const { image } = assembleArm({ name: 'a.s', code: '\tswi "OS_Exit"\n\tswi OS_WriteC\n' }, { ...options, predefined })
		const view = new DataView(image!.sections[0].bytes.buffer)
		expect(view.getUint32(0, true)).toBe(0xEF000011)
		expect(view.getUint32(4, true)).toBe(0xEF000000)
	})
})

describe('armasm', () => {
	it('reads column-1 labels, AREA, DC directives, EQU and ENTRY', () => {
		const code = [
			'\tAREA Program, CODE, READONLY',
			'COUNT\tEQU 2',
			'\tB start',
			'start\tMOV r0, #COUNT :SHL: 1 ; four',
			'\tENTRY',
			'\tLDR r1, =table',
			'\tLTORG',
			'\tAREA Tables, DATA, READWRITE',
			'bytes\tDCB "ab", 0',
			'table\tDCD 0x11223344, &FF, 2_101',
			'half\tDCW 7',
			'\tEND',
			'\tthis is ignored',
		].join('\n')
		const { image, values, diagnostics } = assembleArm({ name: 'a.armasm', code }, options)
		expect(diagnostics).toEqual([])
		expect(values.get('start')).toBe(BASE + 4)
		expect(image!.entryAddress).toBe(BASE + 8)
		// Code: B, MOV, LDR, pool word; data after it, with DCD aligning its label.
		expect(values.get('bytes')).toBe(BASE + 16)
		expect(values.get('table')).toBe(BASE + 20)
		expect(values.get('half')).toBe(BASE + 32)
		const view = new DataView(image!.sections[0].bytes.buffer)
		expect(view.getUint32(4, true)).toBe(0xE3A00004)
		expect(view.getUint32(12, true)).toBe(BASE + 20)
		expect(view.getUint32(20, true)).toBe(0x11223344)
		expect(view.getUint32(24, true)).toBe(0xFF)
		expect(view.getUint32(28, true)).toBe(5)
	})

	it('explains an unindented instruction', () => {
		const found = errors('a.armasm', '\tAREA x, CODE\nMOV r0, #1\n')
		expect(found[0].line).toBe(2)
		expect(found[0].message).toMatch(/column 1 is read as a label/)
	})

	it('refuses directives it does not support', () => {
		expect(errors('a.armasm', '\tMACRO\n')[0].message).toMatch(/MACRO directive is not supported/)
	})
})

describe('armasm dots', () => {
	const v8 = { ...options, arch: ARCH_V8 }
	const word = (name: string, code: string) => {
		const { image, diagnostics } = assembleArm({ name, code }, v8)
		expect(diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([])
		return Array.from(image!.sections[0].bytes.subarray(0, 4))
	}

	// A start character that was not also a part never advanced, and ran out of memory.
	it.each([
		['a lone dot', '\tAREA t, CODE\n\t.\n\tEND\n'],
		['a decimal point', '\tAREA t, CODE\nx\tDCD 1.5\n\tEND\n'],
	])('reports %s instead of hanging', (_, code) => {
		expect(assembleArm({ name: 't.armasm', code }, v8).diagnostics.length).toBeGreaterThan(0)
	}, 2000)

	it('reads a dotted VFP mnemonic as GNU does', () => {
		expect(word('t.armasm', '\tAREA t, CODE\n\tvadd.f32 s0, s1, s2\n\tEND\n')).toEqual(word('t.s', '\tvadd.f32 s0, s1, s2\n'))
	}, 2000)
})
