import { describe, expect, it } from 'vitest'
import definition from '../index'
import { variantOf } from '../../contracts'
import { architectureVariants } from '../../__tests__/helpers'

const run = async (settings: Record<string, unknown>, key: string, input?: string) => {
	const services = definition.createServices()
	try {
		await services.prepare?.(settings)
		const code = variantOf(definition, settings).examples[key].code
		const program = services.assemble({ files: [{ name: 'main.mac', code }], entries: ['main.mac'] }, settings)
		expect(program.diagnostics, key).toEqual([])
		const machine = services.createMachine(program, settings, { speed: null, historyLimit: 1000 })
		for (let i = 0; i < 2_000_000 && !machine.halted; i++) {
			if (machine.pendingInput) machine.provideInput(input ?? '0')
			else machine.step()
		}
		expect(machine.halted, key).toBe(true)
		return machine.console
	} finally { services.dispose() }
}

describe('PDP-11 examples on every model', () => {
	const variants = architectureVariants(definition)
	it('offers every model and floating-point option once', () => {
		expect(variants.map(settings => `${settings.cpuModel}/${settings.floatingPoint}`)).toEqual(['pdp1140/none', 'pdp1120/none', 'pdp1140/fis', 'pdp1145/none', 'pdp1145/fp11', 'lsi1123/none', 'lsi1123/fp11'])
	})
	it.each(variants.map(settings => [`${settings.cpuModel}/${settings.floatingPoint}`, settings] as const))('%s prints the shared answers', async (_label, settings) => {
		expect(await run(settings, 'hello')).toBe('Hello, THRAX!\n')
		expect(await run(settings, 'input', '-17')).toBe('-17')
		expect(await run(settings, 'sum')).toBe('8')
		expect(await run(settings, 'factorial')).toBe('120')
		expect(await run(settings, 'fibonacci')).toBe('55')
		expect(await run(settings, 'loop')).toBe('1 2 3 4 5 ')
		expect(await run(settings, 'bitwise')).toBe('8 14 6')
		expect(await run(settings, 'ackermann')).toBe('61')
	})
	it('computes the floating-point examples', async () => {
		expect(await run({ cpuModel: 'pdp1145', floatingPoint: 'fp11' }, 'floatingpoint')).toBe('3142 1')
		expect(await run({ cpuModel: 'lsi1123', floatingPoint: 'fp11' }, 'floatingpoint')).toBe('3142 1')
		expect(await run({ cpuModel: 'pdp1140', floatingPoint: 'fis' }, 'floatingpoint')).toBe('3142')
	})
})
