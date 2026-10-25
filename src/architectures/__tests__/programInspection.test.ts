import { describe, expect, it } from 'vitest'
import { EMPTY_MEMORY, variantOf } from '../contracts'
import { activateArchitecture, knownArchitectures } from '../registry'

it.each(knownArchitectures())('%s rejects an invalid assembly without replacing its loaded machine', async id => {
	const { definition } = await activateArchitecture(id)
	const settings = definition.settings.defaults, services = definition.createServices()
	try {
		await services.prepare?.(settings)
		const assemble = (code: string) => services.assemble({ files: [{ name: 'main.asm', code }], entries: ['main.asm'] }, settings)
		const good = assemble(variantOf(definition, settings).examples.sum.code)
		const machine = services.createMachine(good, settings, { historyLimit: 100, speed: null })
		machine.step()
		const registers = machine.registerValues(), count = machine.instructionCount
		const invalid = assemble('    .thrax_unknown_directive 1, 2, 3')
		expect(invalid.diagnostics.some(d => d.severity === 'error')).toBe(true)
		expect(() => services.createMachine(invalid, settings, { historyLimit: 100, speed: null })).toThrow('assembly errors')
		expect(machine.registerValues()).toEqual(registers)
		machine.step()
		expect(machine.instructionCount).toBeGreaterThan(count)
	} finally { services.dispose() }
})

describe('loaded program symbol inspection', () => {
	it.each([
		['beta', {}, 'INSPECTION_VALUE = '],
		['mos6502', {}, 'INSPECTION_VALUE = '],
		['z80', {}, 'INSPECTION_VALUE = '],
		['armv8', { executionState: 'arm3' }, '.equ INSPECTION_VALUE, '],
		['armv8', { executionState: 'aarch64' }, '.equ INSPECTION_VALUE, '],
		['armv8', { executionState: 'aarch32' }, '.equ INSPECTION_VALUE, '],
		['armv8', { executionState: 'cortex-m0' }, '.equ INSPECTION_VALUE, '],
	] as const)('%s/%j keeps symbol values tied to the loaded program', async (id, overrides, prefix) => {
		const { definition } = await activateArchitecture(id)
		const settings = { ...definition.settings.defaults, ...overrides }, services = definition.createServices()
		try {
			await services.prepare?.(settings)
			const assemble = (value: number) => services.assemble({ files: [{ name: 'main.asm', code: `${prefix}${value}\n${variantOf(definition, settings).examples.sum.code}` }], entries: ['main.asm'] }, settings)
			const original = assemble(17)
			expect(original.diagnostics.filter(d => d.severity === 'error')).toEqual([])
			services.createMachine(original, settings, { historyLimit: 100, speed: null })
			const inspection = { registers: {}, labels: new Map<string, number>(), memory: EMPTY_MEMORY }
			const tip = () => services.describeToken?.('INSPECTION_VALUE', 1, inspection)
			const before = tip()
			expect(before).toBeTruthy()
			const preview = assemble(29)
			expect(preview.diagnostics.filter(d => d.severity === 'error')).toEqual([])
			expect(tip()).toEqual(before)
			services.createMachine(preview, settings, { historyLimit: 100, speed: null })
			expect(tip()).not.toEqual(before)
			services.createMachine(original, settings, { historyLimit: 100, speed: null })
			expect(tip()).toEqual(before)
		} finally { services.dispose() }
	})
})

it.each([
	['mos6502', { cpuModel: 'nmos6502' }, '.org $1000\nslo $10', { cpuModel: 'w65c02' }, '.org $1000\nrmb0 $10'],
	['riscv', { isa: 'rv32imc' }, 'c.nop', { isa: 'rv32im' }, 'nop'],
	['m68k', { cpuModel: '68010' }, 'bkpt #2', { cpuModel: '68000' }, 'nop'],
	['armv8', { executionState: 'aarch64' }, 'nop', { executionState: 'cortex-m0' }, 'nop'],
] as const)('%s retains the loaded decoder while another variant assembles', async (id, first, code, second, otherCode) => {
	const { definition } = await activateArchitecture(id)
	const services = definition.createServices()
	try {
		const settings = { ...definition.settings.defaults, ...first }
		await services.prepare?.(settings)
		const program = services.assemble({ files: [{ name: 'main.asm', code }], entries: ['main.asm'] }, settings)
		expect(program.diagnostics.filter(d => d.severity === 'error')).toEqual([])
		const machine = services.createMachine(program, settings, { historyLimit: 100, speed: null })
		const before = services.disassembly.at(machine.inspectMemory(), machine.pc)
		expect(before).toBeTruthy()
		const other = { ...definition.settings.defaults, ...second }
		await services.prepare?.(other)
		const preview = services.assemble({ files: [{ name: 'main.asm', code: otherCode }], entries: ['main.asm'] }, other)
		expect(preview.diagnostics.filter(d => d.severity === 'error')).toEqual([])
		expect(services.disassembly.at(machine.inspectMemory(), machine.pc)).toBe(before)
	} finally { services.dispose() }
})
