import { describe, expect, it } from 'vitest'
import { activateArchitecture } from '../../registry'
import type { DebugInspection } from '../../contracts'
import { instructionHelp, instructionLink } from '../instructionHelp'

describe('8051 instruction manual links', () => {
	it('opens each mnemonic on its Instruction Definitions page', () => {
		expect(instructionLink('ACALL')).toBe('https://www.keil.com/support/man/docs/is51/is51_acall.asp')
		expect(instructionLink('cjne')).toBe('https://www.keil.com/support/man/docs/is51/is51_cjne.asp')
		expect(instructionLink('movx')).toBe('https://www.keil.com/support/man/docs/is51/is51_movx.asp')
		expect(instructionLink('xchd')).toBe('https://www.keil.com/support/man/docs/is51/is51_xchd.asp')
		expect(instructionLink('bogus')).toBeUndefined()
	})

	it('links every documented mnemonic', () => {
		expect(Object.keys(instructionHelp).filter(name => !instructionLink(name))).toEqual([])
	})

	it('links the mnemonic at the top of the hover', async () => {
		const { definition } = await activateArchitecture('i8051'), services = definition.createServices()
		const help = services.describeToken!('djnz', 0, { registers: {}, labels: new Map() } as unknown as DebugInspection)!
		expect(help.contents[0]).toContain(`**[DJNZ](https://www.keil.com/support/man/docs/is51/is51_djnz.asp "Open DJNZ in the manual")**`)
	})
})
