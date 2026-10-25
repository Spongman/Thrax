import { describe, expect, it } from 'vitest'
import { activateArchitecture } from '../../registry'
import type { DebugInspection } from '../../contracts'
import { instructionHelp, instructionLink } from '../instructionHelp'

describe('SPARC instruction manual links', () => {
	it('opens each mnemonic in the Sun HTML manual', () => {
		expect(instructionLink('ldsb')).toBe('https://docs.oracle.com/cd/E19120-01/open.solaris/816-1681/instructionset-18901/index.html#instructionset-14888')
		expect(instructionLink('bne,a')).toBe('https://docs.oracle.com/cd/E19120-01/open.solaris/816-1681/instructionset-18901/index.html#instructionset-14888')
		expect(instructionLink('fbuge')).toBe('https://docs.oracle.com/cd/E19120-01/open.solaris/816-1681/instructionset-18901/index.html#instructionset-14888')
		expect(instructionLink('FSMULD')).toBe('https://docs.oracle.com/cd/E19120-01/open.solaris/816-1681/instructionset-18901/index.html#instructionset-20389')
		expect(instructionLink('cmp')).toBe('https://docs.oracle.com/cd/E19120-01/open.solaris/816-1681/instructionset-18901/index.html#instructionset-28164')
		expect(instructionLink('bogus')).toBeUndefined()
	})

	it('links every documented mnemonic', () => {
		expect(Object.keys(instructionHelp).filter(name => !instructionLink(name))).toEqual([])
	})

	it('links the mnemonic at the top of the hover', async () => {
		const { definition } = await activateArchitecture('sparc'), services = definition.createServices()
		const help = services.describeToken!('save', 0, { registers: {}, labels: new Map() } as unknown as DebugInspection)!
		expect(help.contents[0]).toContain(`**[SAVE](https://docs.oracle.com/cd/E19120-01/open.solaris/816-1681/instructionset-18901/index.html#instructionset-28164 "Open SAVE in the manual")**`)
	})
})
