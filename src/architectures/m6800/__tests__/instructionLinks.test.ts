import { describe, expect, it } from 'vitest'
import { createConfiguredArchitecture } from '../../../core/configuredCpu'
import type { DebugInspection } from '../../contracts'
import { configuration, hc11Configuration, m6809Configuration } from '../index'

describe('6800-family instruction links', () => {
	it.each([
		[configuration, { aba: 'https://k7mem.com/VC_XA_Summary.html#:~:text=ABA', ldaa: 'https://k7mem.com/VC_XA_Summary.html#:~:text=LDAA', lsla: 'https://k7mem.com/VC_XA_Summary.html#:~:text=ASLA', dec: 'https://k7mem.com/VC_XA_Summary.html#:~:text=DEC', wai: 'https://k7mem.com/VC_XA_Summary.html#:~:text=WAI' }],
		[m6809Configuration, { lda: 'https://www.maddes.net/m6809pm/appendix_a.htm#LD%20%288-Bit%29', cmpx: 'https://www.maddes.net/m6809pm/appendix_a.htm#CMP%20%2816-Bit%29', lbne: 'https://www.maddes.net/m6809pm/appendix_a.htm#BNE', leax: 'https://www.maddes.net/m6809pm/appendix_a.htm#LEA', pshs: 'https://www.maddes.net/m6809pm/appendix_a.htm#PSHS', abx: 'https://www.maddes.net/m6809pm/appendix_a.htm#ABX', tstb: 'https://www.maddes.net/m6809pm/appendix_a.htm#TST', andcc: undefined }],
		[hc11Configuration, { ldaa: 'https://www.cs.uaf.edu/2007/fall/cs441/proj1notes/sawyer/inst.html#:~:text=LDAA', cmpd: 'https://www.cs.uaf.edu/2007/fall/cs441/proj1notes/sawyer/inst.html#:~:text=CPD', dec: 'https://www.cs.uaf.edu/2007/fall/cs441/proj1notes/sawyer/inst.html#:~:text=DEC', xgdy: 'https://www.cs.uaf.edu/2007/fall/cs441/proj1notes/sawyer/inst.html#:~:text=XGDY' }],
	])('$name links mnemonics to their own manual entries', (config, expected) => {
		for (const [mnemonic, url] of Object.entries(expected)) expect(config.instructionLink!(mnemonic), mnemonic).toBe(url)
	})

	it('links the mnemonic in the hover', () => {
		const services = createConfiguredArchitecture(configuration).createServices()
		const help = services.describeToken!('ldaa', 0, { registers: {}, labels: new Map() } as unknown as DebugInspection)!
		expect(help.contents[0]).toContain('**[LDAA](https://k7mem.com/VC_XA_Summary.html#:~:text=LDAA')
		services.dispose()
	})
})
