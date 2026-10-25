import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DebugInspection } from '../../contracts'
import RegisterView from '../../../components/RegisterView'
import powerpc from '../index'

const PI = 0x400921fb54442d18n

describe('PowerPC float register display', () => {
	it('shows 64-bit FPRs as doubles in the register panel', () => {
		const registers = Object.fromEntries(powerpc.registers.map(register => [register.id, register.bits === 64 ? 0n : 0]))
		const markup = renderToStaticMarkup(<RegisterView registers={{ ...registers, f1: PI, f2: 0xc004000000000000n }} descriptors={powerpc.registers.filter(register => register.bank === 'float')} />)
		expect(markup).toContain('3.141592653589793')
		expect(markup).toContain('-2.5')
		expect(markup).toContain('FPSCR')
	})
	it('shows the double in a data tip', () => {
		const services = powerpc.createServices()
		try {
			const state = { registers: { f1: PI }, labels: new Map() } as unknown as DebugInspection
			expect(services.describeToken!('fmr f2, f1', 9, state)?.contents[0]).toBe('**f1** = 0x400921fb54442d18 (3.141592653589793)')
		} finally { services.dispose() }
	})
})
