import { describe, expect, it } from 'vitest'
import { activateArchitecture } from '../../registry'
import type { DebugInspection } from '../../contracts'
import { instructionHelp, instructionLink } from '../instructionHelp'

describe('Alpha instruction manual links', () => {
	it('opens each mnemonic in the DEC HTML handbook', () => {
		expect(instructionLink('lda')).toBe('https://www.cs.auckland.ac.nz/references/unix/digital/APS31DTE/DOCU_009.HTM#load_table')
		expect(instructionLink('CMOVEQ')).toBe('https://www.cs.auckland.ac.nz/references/unix/digital/APS31DTE/DOCU_009.HTM#move_table')
		expect(instructionLink('addt/sui')).toBe('https://www.cs.auckland.ac.nz/references/unix/digital/APS31DTE/DOCU_010.HTM#arith_instruct_descriptions')
		expect(instructionLink('mov')).toBe('https://www.cs.auckland.ac.nz/references/unix/digital/APS31DTE/DOCU_009.HTM#move_table')
		expect(instructionLink('call_pal')).toBe('https://www.cs.auckland.ac.nz/references/unix/digital/APS31DTE/DOCU_009.HTM#special_table')
		expect(instructionLink('ftois')).toBe('https://vaxhaven.com/images/7/7e/EC-QD2KC-TE.pdf#page=179')
		expect(instructionLink('bogus')).toBeUndefined()
	})

	it('links every documented mnemonic', () => {
		expect(Object.keys(instructionHelp).filter(name => !instructionLink(name))).toEqual([])
	})

	it('links the mnemonic at the top of the hover', async () => {
		const { definition } = await activateArchitecture('alpha'), services = definition.createServices()
		const help = services.describeToken!('zapnot', 0, { registers: {}, labels: new Map() } as unknown as DebugInspection)!
		expect(help.contents[0]).toContain(`**[ZAPNOT](https://www.cs.auckland.ac.nz/references/unix/digital/APS31DTE/DOCU_009.HTM#byte_manip_table "Open ZAPNOT in the manual")**`)
	})
})
