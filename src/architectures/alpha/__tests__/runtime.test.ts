import { describe, expect, it } from 'vitest'
import definition from '../index'

describe('Alpha exact 64-bit shared runtime history', () => {
	it('undoes/redoes exact register and quadword memory edits above Number precision', () => {
		const services = definition.createServices(), settings = definition.settings.defaults
		try {
			const program = services.assemble({ files: [{ name: 'main.asm', code: '.text\naddq $1, 1, $2\nldah $3, 1($31)\nstq $2, 0($3)\ncall_pal 0' }], entries: ['main.asm'] }, settings)
			expect(program.diagnostics).toEqual([])
			const machine = services.createMachine(program, settings, { speed: null, historyLimit: 100 })
			const value = 0x20000000000001n
			expect(machine.writeRegister('r1', value)).toBe(true)
			expect(machine.registerValues().r1).toBe(value)
			machine.stepBack()
			expect(machine.registerValues().r1).toBe(0n)
			machine.step()
			machine.step()
			expect(machine.registerValues().r2).toBe(value + 1n)
			machine.step()
			machine.step()
			expect(machine.inspectMemory().byte(0x10000)).toBe(2)
			expect(machine.inspectMemory().byte(0x10006)).toBe(0x20)
			machine.stepBack()
			expect(machine.inspectMemory().byte(0x10006)).toBe(0)
			machine.step()
			expect(machine.inspectMemory().byte(0x10006)).toBe(0x20)
			expect(machine.writeRegister('r31', 1n)).toBe(false)
		} finally { services.dispose() }
	})
})
