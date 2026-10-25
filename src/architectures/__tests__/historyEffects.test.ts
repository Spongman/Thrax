import { expect, it } from 'vitest'
import { activateArchitecture } from '../registry'
import { variantOf } from '../contracts'

it.each([
	['riscv', 'x1', {}],
	['avr', 'r0', {}],
	['m68k', 'D0', {}],
	['armv8', 'R0', { executionState: 'cortex-m0' }],
] as const)('%s displays native register snapshots on either side of the cursor', async (id, register, overrides) => {
	const { definition } = await activateArchitecture(id)
	const settings = { ...definition.settings.defaults, ...overrides }
	const services = definition.createServices()
	try {
		const code = variantOf(definition, settings).examples.sum.code
		await services.prepare?.(settings)
		const program = services.assemble({ files: [{ name: 'main.asm', code }], entries: ['main.asm'] }, settings)
		const machine = services.createMachine(program, settings, { historyLimit: 100, speed: null })
		try {
			const initial = Number(machine.registerValues()[register])
			expect(machine.writeRegister(register, 10)).toBe(true)
			expect(machine.writeRegister(register, 20)).toBe(true)
			const rows = machine.history.slice(0, machine.history.length)
			const value = (index: number, applied: boolean) => machine.historyFormat.effects(rows[index], applied).find(effect => effect.register === register)?.value
			expect(value(0, true)).toBe(initial)
			expect(value(1, true)).toBe(10)
			expect(machine.rewindTo(rows[0].id)).toBe(true)
			expect(value(0, false)).toBe(10)
			expect(value(1, false)).toBe(20)
			machine.step()
			machine.step()
			expect(Number(machine.registerValues()[register])).toBe(20)
			expect(machine.history.slice(0, machine.history.length).map(row => row.id)).toEqual(rows.map(row => row.id))
		} finally { machine.dispose() }
	} finally { services.dispose() }
})
