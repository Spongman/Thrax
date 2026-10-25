import { describe, expect, it } from 'vitest'
import { variantOf } from '../contracts'
import { activateArchitecture, knownArchitectures } from '../registry'
import { architectureVariants } from './helpers'

describe.each(knownArchitectures())('%s stop reasons', id => {
	if (id !== 'avr') it('keeps console input waits resumable', async () => {
		const { definition } = await activateArchitecture(id)
		for (const settings of architectureVariants(definition)) {
			const services = definition.createServices()
			try {
				await services.prepare?.(settings)
				const program = services.assemble({ files: [{ name: 'main.asm', code: variantOf(definition, settings).examples.input.code }], entries: ['main.asm'] }, settings)
				const machine = services.createMachine(program, settings, { historyLimit: 100, speed: null })
				await machine.run()
				expect(machine.pendingInput).not.toBeNull()
				expect(machine.stopReason).toBeNull()
				expect(machine.halted).toBe(false)
			} finally { services.dispose() }
		}
	})

	it('distinguishes debugger Stop, resumable pauses and guest completion across variants', async () => {
		const { definition } = await activateArchitecture(id)
		for (const settings of architectureVariants(definition)) {
			const services = definition.createServices()
			try {
				await services.prepare?.(settings)
				const code = variantOf(definition, settings).examples.sum.code
				const program = services.assemble({ files: [{ name: 'main.asm', code }], entries: ['main.asm'] }, settings)
				const machine = services.createMachine(program, settings, { historyLimit: 1000, speed: null })
				expect(machine.stopReason).toBeNull()
				machine.pause()
				expect(machine.stopReason).toBeNull()
				machine.stop()
				expect(machine.stopReason).toEqual({ kind: 'stop' })
				await machine.continue()
				expect(machine.instructionCount).toBe(0)
				machine.setProgramCounter(machine.pc)
				expect(machine.stopReason).toBeNull()
				await machine.run()
				expect(machine.stopReason).toEqual({ kind: 'halt' })
				expect(machine.stepBack()).toBe(true)
				expect(machine.stopReason).toBeNull()
				machine.step()
				expect(machine.stopReason).toEqual({ kind: 'halt' })
			} finally { services.dispose() }
		}
	})
})

it.each([
	['avr', {}, '.word 0xffff'],
	['riscv', {}, '.word 0xffffffff'],
	['m68k', {}, 'illegal'],
	['armv8', { executionState: 'cortex-m0' }, '.hword 0xde00'],
] as const)('%s reports faults encountered while classifying Step Over', async (id, overrides, code) => {
	const { definition } = await activateArchitecture(id)
	const settings = { ...definition.settings.defaults, ...overrides }, services = definition.createServices()
	try {
		await services.prepare?.(settings)
		const program = services.assemble({ files: [{ name: 'main.asm', code }], entries: ['main.asm'] }, settings)
		const machine = services.createMachine(program, settings, { historyLimit: 100, speed: null })
		await expect(machine.stepOver()).rejects.toThrow()
		expect(machine.stopReason?.kind).toBe('fault')
		expect(machine.halted).toBe(true)
	} finally { services.dispose() }
})

it.each([
	['mips', {}, 'lui $t0,0x7fff\nori $t0,$t0,0xffff\naddi $t1,$t0,1'],
	['beta', {}, '.include "beta.uasm"\nLONG(0x04000000)'],
	['armv8', { executionState: 'arm3' }, '.word 0xe7f000f0'],
	['armv8', { executionState: 'aarch64' }, '.word 0'],
	['armv8', { executionState: 'aarch32' }, '.word 0xe7f000f0'],
	['armv8', { executionState: 'cortex-m0' }, '.hword 0xde00'],
	['avr', {}, '.word 0xffff'],
	['riscv', {}, '.word 0xffffffff'],
	['m68k', {}, 'illegal'],
] as const)('%s/%j exposes native fault details and permits explicit recovery', async (id, overrides, code) => {
	const { definition } = await activateArchitecture(id)
	const settings = { ...definition.settings.defaults, ...overrides }, services = definition.createServices()
	try {
		await services.prepare?.(settings)
		const program = services.assemble({ files: [{ name: 'main.asm', code }], entries: ['main.asm'] }, settings)
		expect(program.diagnostics.filter(d => d.severity === 'error')).toEqual([])
		const machine = services.createMachine(program, settings, { historyLimit: 100, speed: null })
		try { await machine.run() } catch { /* Native thrown faults still reach API callers. */ }
		expect(machine.stopReason?.kind).toBe('fault')
		if (machine.stopReason?.kind === 'fault') {
			expect(machine.stopReason.message.length).toBeGreaterThan(0)
			expect(Number.isSafeInteger(machine.stopReason.address)).toBe(true)
		}
		expect(machine.halted).toBe(true)
		const count = machine.instructionCount
		await machine.continue()
		expect(machine.instructionCount).toBe(count)
		machine.setProgramCounter(machine.pc)
		expect(machine.stopReason).toBeNull()
	} finally { services.dispose() }
})

it('keeps a recorded MIPS fault distinct from a normal halt after rewind and replay', async () => {
	const { definition } = await activateArchitecture('mips')
	const services = definition.createServices(), settings = definition.settings.defaults
	try {
		const program = services.assemble({ files: [{ name: 'main.asm', code: 'lui $t0,0x7fff\nori $t0,$t0,0xffff\naddi $t1,$t0,1' }], entries: ['main.asm'] }, settings)
		const machine = services.createMachine(program, settings, { historyLimit: 100, speed: null })
		await machine.run()
		const reason = machine.stopReason, count = machine.instructionCount
		expect(reason?.kind).toBe('fault')
		expect(machine.stepBack()).toBe(true)
		expect(machine.stopReason).toBeNull()
		machine.step()
		expect(machine.stopReason).toEqual(reason)
		expect(machine.instructionCount).toBe(count)
	} finally { services.dispose() }
})
