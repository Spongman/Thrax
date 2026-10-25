import { describe, expect, it } from 'vitest'
import { variantOf, type Machine } from '../contracts'
import { activateArchitecture, knownArchitectures } from '../registry'
import { architectureVariants } from './helpers'

function recursiveCall(machine: Machine): { returnAddress: number; depth: number } {
	for (let steps = 0; steps < 100_000 && !machine.halted; steps++) {
		const frames = [...machine.callStack]
		machine.step()
		const after = machine.callStack
		const added = after[after.length - 1]
		if (after.length > frames.length && frames.some((frame) => frame.targetAddress === added.targetAddress)) {
			expect(machine.stepBack()).toBe(true)
			return { returnAddress: added.returnAddress, depth: frames.length }
		}
	}
	throw new Error('Ackermann never made a recursive call')
}

describe.each(knownArchitectures())('%s shared debugger policy', (id) => {
	it('continues after Pause, keeps Stop terminal, and can rewind a stopped run', async () => {
		const { definition } = await activateArchitecture(id)
		for (const settings of architectureVariants(definition)) {
			const services = definition.createServices()
			const code = variantOf(definition, settings).examples.sum.code
			await services.prepare?.(settings)
			const program = services.assemble({ files: [{ name: 'main.asm', code }], entries: ['main.asm'] }, settings)
			const machine = services.createMachine(program, settings, { speed: null, historyLimit: 100_000 })
			try {
				machine.stop()
				expect(machine.stepBack()).toBe(false)
				expect(machine.halted).toBe(true)
				machine.setProgramCounter(machine.pc)
				expect(machine.halted).toBe(false)
				machine.step()
				const count = machine.instructionCount
				machine.pause()
				expect(machine.halted).toBe(false)
				await machine.continue()
				expect(machine.instructionCount).toBeGreaterThan(count)
				expect(machine.halted).toBe(true)
				machine.rewindTo(machine.history.at(1)!.id)
				const cursor = machine.historyCursor, stoppedAt = machine.instructionCount
				const row = machine.history.at(cursor - 1)!
				const effects = machine.historyFormat.effects(row, true)
				machine.stop()
				expect(machine.historyFormat.effects(row, true)).toEqual(effects)
				expect(machine.halted).toBe(true)
				expect(machine.paused).toBe(false)
				await machine.continue()
				expect(machine.instructionCount).toBe(stoppedAt)
				expect(machine.historyCursor).toBe(cursor)
				expect(machine.stepBack()).toBe(true)
				expect(machine.halted).toBe(false)
				await machine.continue()
				expect(machine.instructionCount).toBeGreaterThan(stoppedAt)
			} finally { machine.dispose(); services.dispose() }
		}
	})

	it('steps over recursion and out of a frame using the same completion rules', async () => {
		const { definition } = await activateArchitecture(id)
		for (const settings of architectureVariants(definition)) {
			const services = definition.createServices()
			const code = variantOf(definition, settings).examples.ackermann.code
			await services.prepare?.(settings)
			const program = services.assemble({ files: [{ name: 'main.asm', code }], entries: ['main.asm'] }, settings)
			expect(program.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
			const machine = services.createMachine(program, settings, { speed: null, historyLimit: 100_000 })
			try {
				const { returnAddress, depth } = recursiveCall(machine)
				const entry = machine.history.at(machine.historyCursor)!
				const callAddress = machine.pc
				machine.addBreakpoint(callAddress)
				const breakpoints = [...machine.getBreakpoints()]
				machine.onProgress = () => { if (machine.instructionCount > 500_000) machine.pause() }
				await machine.stepOver()
				expect(machine.pc).toBe(returnAddress)
				expect(machine.callStack.length).toBe(depth)
				expect([...machine.getBreakpoints()]).toEqual(breakpoints)
				machine.removeBreakpoint(callAddress)
				machine.rewindTo(entry.id)
				machine.step()
				expect(machine.callStack.length).toBe(depth + 1)
				await machine.stepToReturn()
				expect(machine.pc).toBe(returnAddress)
				expect(machine.callStack.length).toBe(depth)
			} finally { machine.dispose(); services.dispose() }
		}
	}, 30_000)

	it('inserts/deletes memory as single reversible edits across variants', async () => {
		const { definition } = await activateArchitecture(id)
		for (const settings of architectureVariants(definition)) {
			const services = definition.createServices()
			const code = variantOf(definition, settings).examples.sum.code
			await services.prepare?.(settings)
			const program = services.assemble({ files: [{ name: 'main.asm', code }], entries: ['main.asm'] }, settings)
			const machine = services.createMachine(program, settings, { speed: null, historyLimit: 1000 })
			try {
				const base = services.profile(settings).dataBase!
				for (const [offset, value] of [17, 34, 51, 68, 0].entries()) expect(machine.writeByte(base + offset, value)).toBe(true)
				const bytes = () => Array.from({ length: 5 }, (_, i) => machine.inspectMemory().byte(base + i))
				const length = machine.history.length
				expect(machine.insertByte(base + 1, base + 4, 99)).toBe(true)
				expect(bytes()).toEqual([17, 99, 34, 51, 68])
				expect(machine.history.length).toBe(length + 1)
				machine.stepBack()
				expect(bytes()).toEqual([17, 34, 51, 68, 0])
				machine.step()
				expect(bytes()).toEqual([17, 99, 34, 51, 68])
				expect(machine.deleteByte(base + 1, base + 4)).toBe(true)
				expect(bytes()).toEqual([17, 34, 51, 68, 0])
				expect(machine.history.length).toBe(length + 2)
				machine.stepBack()
				expect(bytes()).toEqual([17, 99, 34, 51, 68])
				machine.step()
				expect(bytes()).toEqual([17, 34, 51, 68, 0])
				expect(machine.insertByte(base + 1.5, base + 4, 99)).toBe(false)
				expect(machine.deleteByte(base + 1, base - 1)).toBe(false)
			} finally { machine.dispose(); services.dispose() }
		}
	})
})

// AVR address translation is deliberately supplied by the CPU, not inferred by shared code.
it('keeps AVR shifts within flash, register aliases, special registers and SRAM', async () => {
	const { definition } = await activateArchitecture('avr')
	const services = definition.createServices(), settings = definition.settings.defaults
	await services.prepare?.(settings)
	const program = services.assemble({ files: [{ name: 'main.asm', code: 'break' }], entries: ['main.asm'] }, settings)
	const machine = services.createMachine(program, settings, { speed: null, historyLimit: 1000 })
	try {
		for (const base of [0x100, 0x10000, 0x10100]) {
			for (const [i, value] of [17, 34, 51, 0].entries()) machine.writeByte(base + i, value)
			const count = machine.history.length
			expect(machine.insertByte(base, base + 3, 99)).toBe(true)
			expect(machine.history.length).toBe(count + 1)
			expect(Array.from({ length: 4 }, (_, i) => machine.inspectMemory().byte(base + i))).toEqual([99, 17, 34, 51])
			machine.stepBack()
			expect(Array.from({ length: 4 }, (_, i) => machine.inspectMemory().byte(base + i))).toEqual([17, 34, 51, 0])
			machine.step()
		}
		const count = machine.history.length
		for (const [from, to] of [[0xFFFF, 0x10000], [0x1001F, 0x10020], [0x1005F, 0x10060], [0x10060, 0x10061]]) {
			expect(machine.insertByte(from, to, 1)).toBe(false)
			expect(machine.deleteByte(from, to)).toBe(false)
		}
		expect(machine.history.length).toBe(count)
	} finally { machine.dispose(); services.dispose() }
})
