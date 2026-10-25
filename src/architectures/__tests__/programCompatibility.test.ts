import { expect, it } from 'vitest'
import { variantOf } from '../contracts'
import { activateArchitecture } from '../registry'

it.each([
	['mos6502', { cpuModel: 'nmos6502' }, { cpuModel: 'w65c02' }],
	['riscv', { isa: 'rv32imc' }, { isa: 'rv32im' }],
	['m68k', { cpuModel: '68020' }, { cpuModel: '68000' }],
	['armv8', { executionState: 'aarch64' }, { executionState: 'cortex-m0' }],
	['armv8', { executionState: 'arm3' }, { executionState: 'arm2' }],
	['armv8', { executionState: 'arm3' }, { executionState: 'aarch32' }],
	['mos6502', { cpuModel: 'w65816' }, { cpuModel: 'w65c02' }],
	['m6800', { cpuModel: 'm6809' }, { cpuModel: 'hc11' }],
	['m6800', { cpuModel: 'hc11' }, { cpuModel: 'm6800' }],
	['sh', { cpuModel: 'sh2' }, { cpuModel: 'sh1' }],
] as const)('%s refuses mismatched models, including programs assembled by another service', async (id, first, other) => {
	const { definition } = await activateArchitecture(id)
	const settings = { ...definition.settings.defaults, ...first }, incompatible = { ...settings, ...other }
	const assembler = definition.createServices(), loader = definition.createServices()
	try {
		await assembler.prepare?.(settings)
		await loader.prepare?.(settings)
		await loader.prepare?.(incompatible)
		const code = variantOf(definition, settings).examples.sum.code
		const program = assembler.assemble({ files: [{ name: 'main.asm', code }], entries: ['main.asm'] }, settings)
		expect(program.diagnostics.filter(d => d.severity === 'error')).toEqual([])
		const machine = loader.createMachine(program, settings, { historyLimit: 100, speed: null })
		expect(() => loader.createMachine(program, incompatible, { historyLimit: 100, speed: null })).toThrow('reassemble for the selected CPU')
		machine.step()
		expect(machine.instructionCount).toBeGreaterThan(0)
	} finally { assembler.dispose(); loader.dispose() }
})
