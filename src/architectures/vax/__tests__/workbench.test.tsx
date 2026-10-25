import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import RegisterView from '../../../components/RegisterView'
import type { DebugInspection } from '../../contracts'
import definition from '../index'
import { instructionLink } from '../manual'
import { instructions } from '../isa'


afterEach(() => { vi.unstubAllGlobals() })

describe('VAX register panel', () => {
	it('reads R0-R11 as F_floating and register pairs as D_floating beside the integers', () => {
		const formats = { General: { '0n': false, '0x': true, f: true, d: true } }
		vi.stubGlobal('window', { localStorage: { getItem: (key: string) => key.endsWith('registers.formats') ? JSON.stringify(formats) : null, setItem: () => {} } })
		const registers = Object.fromEntries(definition.registers.map(register => [register.id, 0]))
		// R0 = F 1.5; R2/R3 = D -2.5 with the sign word in R2.
		const markup = renderToStaticMarkup(<RegisterView registers={{ ...registers, r0: 0x40c0, r2: 0xc120, r3: 0 }} descriptors={definition.registers} />)
		expect(markup).toContain('>1.5<')
		expect(markup).toContain('>-2.5<')
		expect(markup).toMatch(/40[cC]0/)
	})
})

describe('VAX manual links', () => {
	it.each([
		['addl2', 'https://docs.vmssoftware.com/vsi-openvms-vax-macro-and-instruction-set-reference-manual/#d0e19844'], ['ADDB3', 'https://docs.vmssoftware.com/vsi-openvms-vax-macro-and-instruction-set-reference-manual/#d0e19844'], ['movc5', 'https://docs.vmssoftware.com/vsi-openvms-vax-macro-and-instruction-set-reference-manual/#d0e32556'], ['cvtrdl', 'https://docs.vmssoftware.com/vsi-openvms-vax-macro-and-instruction-set-reference-manual/#d0e29625'], ['bneq', 'https://docs.vmssoftware.com/vsi-openvms-vax-macro-and-instruction-set-reference-manual/#d0e24679'], ['calls', 'https://docs.vmssoftware.com/vsi-openvms-vax-macro-and-instruction-set-reference-manual/#d0e26529'], ['addg2', 'https://docs.vmssoftware.com/vsi-openvms-vax-macro-and-instruction-set-reference-manual/#d0e29167'], ['mtpr', 'https://docs.vmssoftware.com/vsi-openvms-vax-macro-and-instruction-set-reference-manual/#d0e38788'],
	] as const)('links %s to its HTML entry', (mnemonic, url) => {
		expect(instructionLink(mnemonic)).toBe(url)
	})

	it('links every documented mnemonic and puts the link in the hover', () => {
		for (const name of instructions) expect(instructionLink(name), name).toMatch(/https:\/\/docs\.vmssoftware\.com\/\S+#\w+$/)
		const services = definition.createServices()
		try {
			const state = { registers: {}, labels: new Map() } as unknown as DebugInspection
			expect(services.describeToken!('ADDL2', 0, state)!.contents[0]).toBe(`**[ADDL2](https://docs.vmssoftware.com/vsi-openvms-vax-macro-and-instruction-set-reference-manual/#d0e19844 "Open ADDL2 in the manual")** — DEC VAX-11/780 assembly.`)
		} finally { services.dispose() }
	})
})
