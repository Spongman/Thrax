import { describe, expect, it } from 'vitest'
import { INSTRUCTION_MNEMONICS } from '../isa'
import { INSTRUCTION_DOCS, instructionDoc, instructionHelp, instructionSignature } from '../isaDocs'

const mnemonics = [...INSTRUCTION_MNEMONICS].map((mnemonic) => mnemonic.toLowerCase())

describe('instruction docs', () => {
	it('describes every mnemonic the assembler accepts', () => {
		expect(mnemonics.filter((mnemonic) => instructionDoc(mnemonic) === undefined)).toEqual([])
	})

	it('describes nothing that is not a mnemonic', () => {
		expect(Object.keys(INSTRUCTION_DOCS).filter((key) => !mnemonics.includes(key))).toEqual([])
	})

	it('matches a mnemonic however it is cased', () => {
		expect(instructionDoc('ADD.S')).toBe(instructionDoc('add.s'))
		expect(instructionDoc('Syscall')).toBe(instructionDoc('syscall'))
	})

	it('says nothing about a word that is not an instruction', () => {
		expect(instructionDoc('main')).toBeUndefined()
		expect(instructionHelp('main')).toBeNull()
		expect(instructionSignature('main')).toBeUndefined()
	})

	it('shows a basic instruction with its own form', () => {
		expect(instructionHelp('add')).toEqual([
			'**add** basic instruction',
			'Add two registers, trapping on signed overflow.',
			'`add $t1,$t2,$t3`',
			'Pseudo forms: `add $t1,$t2,-100` `add $t1,$t2,100000`',
		])
		expect(instructionSignature('add')).toBe('add $t1,$t2,$t3')
	})

	it('shows a pseudo-instruction as one', () => {
		expect(instructionHelp('move')).toEqual([
			'**move** pseudo-instruction',
			'Copy one register into another.',
			'`move $t1,$t2`',
		])
		expect(instructionSignature('move')).toBe('move $t1,$t2')
	})

	it('counts the forms it does not list', () => {
		// `la` is written ten ways, of which the tip carries six.
		const help = instructionHelp('la')!
		expect(help[2]).toContain('`la $t1,($t2)`')
		expect(help[2]).toMatch(/ and 4 more$/)
	})

	it('is written with only the marks the gutter tip draws', () => {
		for (const mnemonic of mnemonics) {
			for (const paragraph of instructionHelp(mnemonic)!) {
				// Nothing but paired `**strong**` and `` `code` `` is left over.
				const rest = paragraph.replace(/\*\*[^*]+\*\*/g, '').replace(/`[^`]+`/g, '')
				expect(rest, mnemonic).not.toMatch(/[*`_[\]]/)
			}
		}
	})
})
