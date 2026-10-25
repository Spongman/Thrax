import { describe, expect, it } from 'vitest'
import { activateArchitecture } from '../../registry'
import type { DebugInspection } from '../../contracts'
import { instructionHelp, instructionLink } from '../instructionHelp'

const manual = 'https://www.ibm.com/docs/en/ssw_aix_71/assembler/idalangref_'

describe('PowerPC instruction manual links', () => {
	it('opens each mnemonic on its AIX assembler reference page', () => {
		expect(instructionLink('add')).toBe(`${manual}cax.html`)
		expect(instructionLink('add.')).toBe(`${manual}cax.html`)
		expect(instructionLink('andi.')).toBe(`${manual}andil_inst.html`)
		expect(instructionLink('lwzx')).toBe(`${manual}lwzx_lx_lwzi_instrus.html`)
		expect(instructionLink('fmsubs')).toBe(`${manual}fmsubms_instrs.html`)
		expect(instructionLink('blr')).toBe(`${manual}branch_conditional_link_register.html`)
		expect(instructionLink('bogus')).toBeUndefined()
	})

	it('links every documented mnemonic', () => {
		expect(Object.keys(instructionHelp).filter(name => !instructionLink(name))).toEqual([])
	})

	it('links the mnemonic at the top of the hover', async () => {
		const { definition } = await activateArchitecture('powerpc'), services = definition.createServices()
		const help = services.describeToken!('lfsux', 0, { registers: {}, labels: new Map() } as unknown as DebugInspection)!
		expect(help.contents[0]).toContain(`**[LFSUX](${manual}lsux_lfps_instrs.html "Open LFSUX in the manual")**`)
	})
})
