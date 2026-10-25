import { describe, expect, it } from 'vitest'
import { variantOf } from '../contracts'
import { activateArchitecture, knownArchitectures } from '../registry'
import { architectureVariants } from './helpers'

describe.each(knownArchitectures())('%s edit validation', id => {
	it('rejects invalid edits without changing state or discarding retained history', async () => {
		const { definition } = await activateArchitecture(id)
		for (const settings of architectureVariants(definition)) {
			const services = definition.createServices()
			try {
				const variant = variantOf(definition, settings)
				const code = variant.examples.sum.code
				await services.prepare?.(settings)
				const program = services.assemble({ files: [{ name: 'main.asm', code }], entries: ['main.asm'] }, settings)
				expect(program.diagnostics.filter(d => d.severity === 'error')).toEqual([])
				const machine = services.createMachine(program, settings, { historyLimit: 100, speed: null })
				try {
					const register = variant.registers.find(r => r.editable && !r.role && r.bits >= 8)!.id
					const base = services.profile(settings).dataBase!
					expect(machine.writeRegister(register, 7)).toBe(true)
					expect(machine.writeRegister(register, 9)).toBe(true)
					expect(machine.stepBack()).toBe(true)
					const snapshot = () => ({ registers: machine.registerValues(), cursor: machine.historyCursor, rows: machine.history.slice(0, machine.history.length).map(r => r.id), byte: machine.inspectMemory().byte(base), halted: machine.halted })
					const before = snapshot()
					for (const value of [NaN, Infinity, -Infinity, 1.5]) {
						for (const r of variant.registers) expect(machine.writeRegister(r.id, value), r.id).toBe(false)
						expect(machine.writeByte(base, value)).toBe(false)
						expect(machine.insertByte(base, base + 3, value)).toBe(false)
						machine.setProgramCounter(value)
					}
					for (const address of [-1, base + 0.5, NaN, Infinity, base + 2 ** 32, Number.MAX_SAFE_INTEGER + 1]) {
						expect(machine.writeByte(address, 1)).toBe(false)
						expect(machine.inspectMemory().byte(address)).toBeUndefined()
						expect(machine.inspectMemory().word(address)).toBeUndefined()
					}
					expect(machine.writeRegister('unknown register', 1)).toBe(false)
					expect(snapshot()).toEqual(before)
					machine.step()
					expect(Number(machine.registerValues()[register])).toBe(9)
					machine.dispose()
					const disposed = snapshot(), pc = machine.pc
					for (const r of variant.registers) expect(machine.writeRegister(r.id, 3), r.id).toBe(false)
					expect(machine.writeByte(base, 1)).toBe(false)
					expect(machine.insertByte(base, base + 3, 1)).toBe(false)
					expect(machine.deleteByte(base, base + 3)).toBe(false)
					machine.setProgramCounter(pc + 4)
					expect(machine.pc).toBe(pc)
					expect(snapshot()).toEqual(disposed)
				} finally { machine.dispose() }
			} finally { services.dispose() }
		}
	})
})

it('retains exact A64 bigint edits and the native zero-extension of W registers', async () => {
	const { definition } = await activateArchitecture('armv8')
	const settings = { ...definition.settings.defaults, executionState: 'aarch64' }
	const services = definition.createServices()
	try {
		const code = variantOf(definition, settings).examples.sum.code
		await services.prepare?.(settings)
		const program = services.assemble({ files: [{ name: 'main.asm', code }], entries: ['main.asm'] }, settings)
		const machine = services.createMachine(program, settings, { historyLimit: 100, speed: null })
		try {
			const value = 0xfedcba9876543211n
			expect(machine.writeRegister('X0', value)).toBe(true)
			expect(machine.registerValues().X0).toBe(value)
			expect(machine.writeRegister('W0', value)).toBe(true)
			expect(machine.registerValues().X0).toBe(0x76543211n)
			expect(machine.stepBack()).toBe(true)
			expect(machine.registerValues().X0).toBe(value)
		} finally { machine.dispose() }
	} finally { services.dispose() }
})
