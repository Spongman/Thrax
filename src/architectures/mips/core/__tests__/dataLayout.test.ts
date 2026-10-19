import { describe, expect, it } from 'vitest'
import { assembleMips } from '../../assembler'
import { Lexer } from '../../assembler/lexer'
import { Parser } from '../../assembler/parser'
import { assemble } from './helpers'

/** Address of the entry the directive on `line` produced. */
function dataAt(source: string, line: number): number {
	const entry = assemble(source).program.data.find((item) => item.sourceLine === line)
	if (!entry) throw new Error(`no data from line ${line}`)
	return entry.address
}

function labelAt(source: string, name: string): number | undefined {
	return assemble(source).program.labels.get(name)
}

/**
 * MARS aligns each datum to its natural boundary before emitting it
 * (`Assembler.java:1289-1290`, `:1313-1314`), and `alignToBoundary` carries any
 * label bound to the old address forward with it (`:1339-1340`).
 */
describe('automatic data alignment', () => {
	it('aligns .word to a 4-byte boundary after a .byte', () => {
		expect(dataAt('.data\n.byte 1\n.word 0x11223344\n', 3)).toBe(0x10010004)
	})

	it('moves a label sitting immediately before the aligned .word', () => {
		expect(labelAt('.data\n.byte 1\nvalue: .word 0x11223344\n', 'value')).toBe(0x10010004)
	})

	it('aligns .half to 2 and .double to 8', () => {
		expect(dataAt('.data\n.byte 1\n.half 0x1122\n', 3)).toBe(0x10010002)
		expect(dataAt('.data\n.byte 1\n.double 1.5\n', 3)).toBe(0x10010008)
	})

	it('aligns .float to 4', () => {
		expect(dataAt('.data\n.byte 1\n.float 1.5\n', 3)).toBe(0x10010004)
	})

	it('leaves .byte, .ascii and .space unaligned', () => {
		expect(dataAt('.data\n.byte 1\n.byte 2\n', 3)).toBe(0x10010001)
		expect(dataAt('.data\n.byte 1\n.asciiz "a"\n', 3)).toBe(0x10010001)
		expect(dataAt('.data\n.byte 1\n.space 2\n', 3)).toBe(0x10010001)
	})

	it('is disabled by .align 0, for the datum and its label', () => {
		const source = '.data\n.align 0\n.byte 1\nvalue: .word 0x11223344\n'
		expect(dataAt(source, 4)).toBe(0x10010001)
		expect(labelAt(source, 'value')).toBe(0x10010001)
	})

	it('is cancelled by a .data after a .text section', () => {
		expect(dataAt('.data\n.align 0\n.byte 1\n.text\nnop\n.data\n.word 0x11223344\n', 7)).toBe(0x10010004)
	})

	/**
	 * Only `.data`/`.kdata` restore it (`Assembler.java:762`); `.text`/`.ktext`
	 * leave it off.  Data can only follow a data directive, so the flag that
	 * survives is read off the parser rather than from an address.
	 */
	it('survives .text and .ktext', () => {
		const parser = new Parser(new Lexer('.data\n.align 0\n.text\nnop\n.ktext\nnop\n').tokenize())
		parser.parse()

		expect(parser.autoAlign).toBe(false)
	})

	// The reset is per file MARS assembles in its own right (`Assembler.java:216`).
	it('restores automatic alignment at the start of the next source file', () => {
		const files = [
			{ name: 'a.asm', code: '.data\n.align 0\n.byte 1\n' },
			{ name: 'b.asm', code: '.data\n.byte 2\n.word 0x11223344\n' },
		]
		const { program } = assembleMips(files)
		const word = program.data.find((item) => item.sourceFile === 'b.asm' && item.sourceLine === 3)

		expect(word?.address).toBe(0x10010004)
	})
})

/** `.extern` names a symbol in the extern region and emits nothing (`Assembler.java:850-856`). */
describe('.extern', () => {
	it('places the symbol at the extern base and emits no bytes', () => {
		const { program } = assemble('.extern buf, 8\n.text\nnop\n')

		expect(program.labels.get('buf')).toBe(0x10000000)
		expect(program.data).toHaveLength(0)
	})

	it('allocates each new name from the extern cursor, not the data cursor', () => {
		const { program } = assemble('.extern buf, 8\n.extern tail, 4\n.data\n.word 1\n')

		expect(program.labels.get('buf')).toBe(0x10000000)
		expect(program.labels.get('tail')).toBe(0x10000008)
		// Neither declaration moved the data cursor.
		expect(program.data[0].address).toBe(0x10010000)
	})

	it('is idempotent: a repeat allocates nothing and bumps no cursor', () => {
		const { program } = assemble('.extern buf, 8\n.extern buf, 8\n.extern tail, 4\n.text\nnop\n')

		expect(program.labels.get('buf')).toBe(0x10000000)
		expect(program.labels.get('tail')).toBe(0x10000008)
		expect(program.data).toHaveLength(0)
	})
})
