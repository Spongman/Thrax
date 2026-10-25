import { describe, expect, it } from 'vitest'
import { instructionHelp, instructionLink } from '../core/isaDocs'

describe('MIPS instruction manual links', () => {
	it('opens each mnemonic in the MARS HTML reference', () => {
		expect(instructionLink('add')).toBe('https://asm-editor.specy.app/documentation/mips/instruction/add')
		expect(instructionLink('LW')).toBe('https://asm-editor.specy.app/documentation/mips/instruction/lw')
		expect(instructionLink('c.lt.d')).toBe('https://asm-editor.specy.app/documentation/mips/instruction/c.lt.d')
		expect(instructionLink('cvt.s.w')).toBe('https://asm-editor.specy.app/documentation/mips/instruction/cvt.s.w')
		expect(instructionLink('beqz')).toBe('https://asm-editor.specy.app/documentation/mips/instruction/beqz')
		expect(instructionLink('blt')).toBe('https://asm-editor.specy.app/documentation/mips/instruction/blt')
	})

	it('links the mnemonic at the top of the hover', () => {
		expect(instructionHelp('swc1')!.contents[0]).toContain(`**[SWC1](https://asm-editor.specy.app/documentation/mips/instruction/swc1 "Open SWC1 in the manual")**`)
		expect(instructionHelp('li')!.contents[0]).toContain('**[LI](https://asm-editor.specy.app/documentation/mips/instruction/li')
	})
})
