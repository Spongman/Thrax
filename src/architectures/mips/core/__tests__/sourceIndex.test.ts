import { describe, expect, it } from 'vitest'
import { assembleMips } from '../../assembler'
import { check } from './helpers'

/** The index of a single-file assembly, whose one file is unnamed. */
function indexOf(source: string) {
	return check(assembleMips(source)).program.sourceIndex
}

describe('source index', () => {
	it('gives a pseudo-instruction line one address per word, and maps each back', () => {
		const index = indexOf('main:\n\tli $t0, 0x12345678\n\tnop\n')

		const addresses = index.addressesForLine('', 2)
		expect(addresses).toEqual([0x00400000, 0x00400004])
		for (const address of addresses) expect(index.lineForAddress(address)).toEqual({ file: '', line: 2 })
		expect(index.addressesForLine('', 3)).toEqual([0x00400008])
		// A breakpoint on the line goes on the first of its words.
		expect(index.codeAddressForLine('', 2)).toBe(0x00400000)
		// The later words of a pseudo-instruction are not places stepping stops.
		expect([...index.codeAddresses('')]).toEqual([0x00400000, 0x00400008])
	})

	it('gives a blank, comment or label-only line no address at all', () => {
		const index = indexOf('# a comment\n\nmain:\n\tnop\n')

		expect(index.addressesForLine('', 1)).toEqual([])
		expect(index.addressesForLine('', 2)).toEqual([])
		expect(index.addressesForLine('', 3)).toEqual([])
		expect(index.addressesForLine('', 4)).toEqual([0x00400000])
		expect(index.lineForAddress(0x00400ffc)).toBeNull()
		// A click on one of those lines aims at the next line that does assemble.
		expect(index.codeLineAtOrAfter('', 1)).toBe(4)
		expect(index.codeAddressAtOrAfter('', 1)).toBe(0x00400000)
		expect(index.codeLineAtOrAfter('', 5)).toBeUndefined()
	})

	it('maps the lines of an included file to their own addresses', () => {
		const files = [
			{ name: 'main.asm', code: 'main:\n\tjal helper\n\t.include "lib.asm"\n' },
			{ name: 'lib.asm', code: 'helper:\n\tjr $ra\n' },
		]
		const index = check(assembleMips(files, ['main.asm'])).program.sourceIndex

		expect(index.entryFile).toBe('main.asm')
		expect(index.addressesForLine('main.asm', 2)).toEqual([0x00400000])
		expect(index.addressesForLine('lib.asm', 2)).toEqual([0x00400004])
		expect(index.lineForAddress(0x00400000)).toEqual({ file: 'main.asm', line: 2 })
		expect(index.lineForAddress(0x00400004)).toEqual({ file: 'lib.asm', line: 2 })
		// Line 2 of one file says nothing about line 2 of the other.
		expect(index.addressesForLine('main.asm', 3)).toEqual([])
		expect([...index.codeAddresses('main.asm')]).toEqual([0x00400000])
		expect([...index.codeAddresses('lib.asm')]).toEqual([0x00400004])
		expect(index.hasCode('nowhere.asm')).toBe(false)
	})

	it('lists every file that assembled to something', () => {
		const files = [
			{ name: 'main.asm', code: 'main:\n\tjal helper\n' },
			{ name: 'lib.asm', code: 'helper:\n\tjr $ra\n\t.globl helper\n' },
		]
		const index = check(assembleMips(files, ['main.asm', 'lib.asm'])).program.sourceIndex

		// Nothing else can enumerate the assembled files; the text segment table
		// needs them to show a row per word of the whole program.
		expect([...index.files()]).toEqual(['main.asm', 'lib.asm'])
		expect([...indexOf('main:\n\tnop\n').files()]).toEqual([''])
	})

	it('spreads a data directive over one row per word', () => {
		const index = indexOf('\t.data\nmsg:\t.asciiz "hello"\n\t.text\nmain:\tnop\n')

		const rows = index.rowsForLine('', 2)
		expect(rows.map((row) => row.address)).toEqual([0x10010000, 0x10010004])
		// Six bytes, so the second row is two bytes short of a full word.
		expect(rows.map((row) => row.length)).toEqual([4, 2])
		expect(rows.every((row) => row.instruction === null && row.directive === '.asciiz')).toBe(true)
		expect(index.lineForAddress(0x10010004)).toEqual({ file: '', line: 2 })
		// Data never executes, so neither a breakpoint nor the pc lands on it.
		expect(index.codeAddressForLine('', 2)).toBeUndefined()
		expect(index.codeAddresses('').has(0x10010000)).toBe(false)
		expect(index.codeLineAtOrAfter('', 2)).toBe(4)
	})

	it('assembles the same program twice to the same machine code', () => {
		const source = 'main:\n\tli $t0, 0x12345678\n\tnop\n'

		const first = check(assembleMips(source))
		const second = check(assembleMips(source))

		expect(first.machineCode).toHaveLength(3)
		expect(second.machineCode).toEqual(first.machineCode)
		expect(second.program.sourceIndex.addressesForLine('', 2)).toEqual([0x00400000, 0x00400004])
	})

	it('keeps one diagnostic per fault across repeated assemblies', () => {
		const first = assembleMips('main:\n\tj missing\n')
		const second = assembleMips('main:\n\tj missing\n')

		expect(first.diagnostics).toHaveLength(1)
		expect(second.diagnostics).toEqual(first.diagnostics)
	})

	// The parser no longer places text at all; it only records where a `.text` or
	// `.ktext` directive asked the assembler's layout to start.
	it('lays each text segment out from the base its directive named', () => {
		const index = indexOf('\t.text 0x00401000\nmain:\tnop\n\t.ktext 0x80000180\nhandler:\teret\n')

		expect(index.addressesForLine('', 2)).toEqual([0x00401000])
		expect(index.addressesForLine('', 4)).toEqual([0x80000180])
		expect(index.lineForAddress(0x80000180)).toEqual({ file: '', line: 4 })
	})

	it('refuses to restart a text segment at a second address', () => {
		const { diagnostics } = assembleMips('\t.text\nmain:\tnop\n\t.text 0x00402000\n\tnop\n')

		expect(diagnostics).toHaveLength(1)
		expect(diagnostics[0].message).toContain('.text cannot be restarted at a new address')
	})

	it('still binds data labels to the address their directive lands on', () => {
		const { program } = check(assembleMips('\t.data 0x10020000\nv:\t.word 7\n\t.text\nmain:\tlw $t0, v\n'))

		expect(program.labels.get('v')).toBe(0x10020000)
		expect(program.data[0].address).toBe(0x10020000)
		expect(program.sourceIndex.rowsForLine('', 2).map((row) => row.address)).toEqual([0x10020000])
	})
})
