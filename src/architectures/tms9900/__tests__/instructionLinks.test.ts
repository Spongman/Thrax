import { describe, expect, it } from 'vitest'
import { createConfiguredArchitecture } from '../../../core/configuredCpu'
import type { DebugInspection } from '../../contracts'
import { configuration } from '../index'

describe('TMS9900 instruction links', () => {
	it('links mnemonics to named HTML entries', () => {
		for (const [mnemonic, url] of Object.entries({ mov: 'https://www.unige.ch/medecine/nouspikel/ti99/assembly.htm#MOV', blwp: 'https://www.unige.ch/medecine/nouspikel/ti99/assembly.htm#BLWP', ldcr: 'https://www.unige.ch/medecine/nouspikel/ti99/assembly.htm#LDCR', jeq: 'https://www.unige.ch/medecine/nouspikel/ti99/assembly.htm#JUMPs', li: 'https://www.unige.ch/medecine/nouspikel/ti99/assembly.htm#LI', rtwp: 'https://www.unige.ch/medecine/nouspikel/ti99/assembly.htm#RTWP' })) expect(configuration.instructionLink!(mnemonic), mnemonic).toBe(url)
		expect(configuration.instructionLink!('unknown')).toBeUndefined()
	})

	it('links the mnemonic in the hover', () => {
		const services = createConfiguredArchitecture(configuration).createServices()
		const help = services.describeToken!('MOV', 0, { registers: {}, labels: new Map() } as unknown as DebugInspection)!
		expect(help.contents[0]).toContain('**[MOV](https://www.unige.ch/medecine/nouspikel/ti99/assembly.htm#MOV')
		services.dispose()
	})
})
