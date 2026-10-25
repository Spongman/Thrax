import { describe, expect, it } from 'vitest'
import { AVR_INSTRUCTIONS } from '../catalog'

const manual = 'https://ww1.microchip.com/downloads/en/DeviceDoc/AVR-Instruction-Set-Manual-DS40002198A.pdf'
const link = (name: string) => /\]\((\S+) /.exec(AVR_INSTRUCTIONS.help(name)!.contents[0])?.[1]

describe('AVR instruction manual links', () => {
	it('links the hover mnemonic to its page in the instruction set manual', () => {
		expect(AVR_INSTRUCTIONS.help('ADD')!.contents[0]).toContain(`**[ADD](${manual}#page=24 "Open ADD in the manual")**`)
		expect(link('brne')).toBe(`${manual}#page=44`)
		expect(link('sbrs')).toBe(`${manual}#page=122`)
		expect(link('ld')).toBe(`${manual}#page=85`)
		expect(link('tst')).toBe(`${manual}#page=144`)
	})

	it('links every documented mnemonic', () => {
		expect(AVR_INSTRUCTIONS.names().filter(name => !link(name))).toEqual([])
	})
})
