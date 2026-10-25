import { describe, expect, it } from 'vitest'
import { NMOS_MODEL, W65C02_MODEL } from '../isa'
import { mos6502InstructionHelp } from '../instructionHelp'

const REFERENCE = 'https://www.pagetable.com/c64ref/6502/'

describe('6502 instruction links', () => {
	it.each([
		['lda', NMOS_MODEL, '?tab=2#LDA'],
		['rmb3', W65C02_MODEL, '?cpu=65c02s&tab=2#RMB3'], ['bra', W65C02_MODEL, '?cpu=65c02s&tab=2#BRA'], ['stz', W65C02_MODEL, '?cpu=65c02s&tab=2#STZ'],
	])('%s links to its CPU-specific reference entry', (mnemonic, model, suffix) => {
		const name = mnemonic.toUpperCase()
		expect(mos6502InstructionHelp(mnemonic, model)!.contents[0].startsWith(`**[${name}](${REFERENCE}${suffix} "Open ${name} in the manual")**`)).toBe(true)
	})
	it.each(['axs', 'kil', 'slo', 'xaa'])('%s links to the visible undocumented instruction description', mnemonic => {
		expect(mos6502InstructionHelp(mnemonic, NMOS_MODEL)!.contents[0]).toContain('https://www.oxyron.de/html/opcodes02.html#:~:text=')
		expect(mos6502InstructionHelp(mnemonic, NMOS_MODEL)!.contents[0]).not.toContain('masswerk')
	})
})
