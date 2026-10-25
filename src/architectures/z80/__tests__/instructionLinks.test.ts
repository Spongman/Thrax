import { describe, expect, it } from 'vitest'
import { Z80_INSTRUCTIONS } from '../catalog'

const link = (name: string) => /\]\((\S+) /.exec(Z80_INSTRUCTIONS.help(name)!.contents[0])?.[1]

describe('Z80 instruction manual links', () => {
	it('links the hover mnemonic to its HTML instruction entry', () => {
		expect(Z80_INSTRUCTIONS.help('LD')!.contents[0].startsWith(`**[LD](https://jnz.dk/z80/instgroups.html#8bitLoadGroup "Open LD in the manual")**`)).toBe(true)
		expect(link('djnz')).toBe('https://jnz.dk/z80/djnz_e.html')
		expect(link('otir')).toBe('https://jnz.dk/z80/otir.html')
		expect(link('cpdr')).toBe('https://jnz.dk/z80/cpdr.html')
		expect(link('sl1')).toBe(link('sll'))
		expect(link('sli')).toBe(link('sll'))
		expect(link('rld')).toBe('https://jnz.dk/z80/rld.html')
	})

	it('links documented mnemonics and the SLL extension', () => {
		expect(Z80_INSTRUCTIONS.names().filter(name => !link(name))).toEqual([])
	})
})
