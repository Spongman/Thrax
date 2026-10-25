import { describe, expect, it } from 'vitest'
import { activateArchitecture } from '../../registry'
import type { DebugInspection } from '../../contracts'
import { instructionHelp, instructionLink } from '../instructionHelp'

const manual = 'https://www.renesas.com/en/document/mas/sh-1sh-2sh-dsp-software-manual'

describe('SuperH instruction manual links', () => {
	it('opens each mnemonic on its software manual page', () => {
		expect(instructionLink('add')).toBe(`${manual}#page=147`)
		expect(instructionLink('BT/S')).toBe(`${manual}#page=167`)
		expect(instructionLink('cmp/str')).toBe(`${manual}#page=171`)
		expect(instructionLink('mov.l')).toBe(`${manual}#page=212`)
		expect(instructionLink('mac.w')).toBe(`${manual}#page=209`)
		expect(instructionLink('mov32')).toBeUndefined()
	})

	it('links every native mnemonic', () => {
		expect(Object.keys(instructionHelp).filter(name => !instructionLink(name))).toEqual(['mov32'])
	})

	it('links the mnemonic at the top of the hover', async () => {
		const { definition } = await activateArchitecture('sh'), services = definition.createServices()
		const help = services.describeToken!('xtrct', 0, { registers: {}, labels: new Map() } as unknown as DebugInspection)!
		expect(help.contents[0]).toContain(`**[XTRCT](${manual}#page=284 "Open XTRCT in the manual")**`)
	})
})
