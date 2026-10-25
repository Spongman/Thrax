import { describe, expect, it } from 'vitest'
import { activateArchitecture } from '../../registry'
import type { DebugInspection } from '../../contracts'
import { instructionHelp, instructionLink } from '../instructionHelp'

describe('x86 instruction manual links', () => {
	it('opens each mnemonic in the HTML reference', () => {
		expect(instructionLink('AAA')).toBe('https://pushbx.org/ecm/doc/insref.htm#insAAA')
		expect(instructionLink('jnb')).toBe('https://pushbx.org/ecm/doc/insref.htm#insJcc')
		expect(instructionLink('movsw')).toBe('https://pushbx.org/ecm/doc/insref.htm#insMOVSB')
		expect(instructionLink('enter')).toBe('https://pushbx.org/ecm/doc/insref.htm#insENTER')
		expect(instructionLink('fsqrt')).toBe('https://pushbx.org/ecm/doc/insref.htm#insFSQRT')
		expect(instructionLink('fldz')).toBe('https://pushbx.org/ecm/doc/insref.htm#insFLD1')
		expect(instructionLink('fsincos')).toBe('https://pushbx.org/ecm/doc/insref.htm#insFSIN')
		expect(instructionLink('fucompp')).toBe('https://pushbx.org/ecm/doc/insref.htm#insFUCOM')
		expect(instructionLink('bogus')).toBeUndefined()
	})

	it('links every documented mnemonic', () => {
		expect(Object.keys(instructionHelp).filter(name => !instructionLink(name))).toEqual([])
	})

	it('links the mnemonic at the top of the hover', async () => {
		const { definition } = await activateArchitecture('i8086'), services = definition.createServices()
		const help = services.describeToken!('xlat', 0, { registers: {}, labels: new Map() } as unknown as DebugInspection)!
		expect(help.contents[0]).toContain(`**[XLAT](https://pushbx.org/ecm/doc/insref.htm#insXLATB "Open XLAT in the manual")**`)
	})
})
