import { describe, expect, it } from 'vitest'
import { variantOf, type Machine } from '../contracts'
import { activateArchitecture, knownArchitectures } from '../registry'
import { architectureVariants } from './helpers'

function finish(machine: Machine) {
	for (let steps = 0; !machine.halted && steps < 100_000; steps++) machine.step()
	expect(machine.halted).toBe(true)
}

describe.each(knownArchitectures())('%s history navigation', (id) => {
	if (id !== 'avr') it('replays accepted console input without requesting it again', async () => {
		const { definition } = await activateArchitecture(id)
		for (const settings of architectureVariants(definition)) {
			const services = definition.createServices()
			try {
				const code = variantOf(definition, settings).examples.input.code
				const program = services.assemble({ files: [{ name: 'main.asm', code }], entries: ['main.asm'] }, settings)
				const machine = services.createMachine(program, settings, { speed: null, historyLimit: 100_000 })
				try {
					for (let steps = 0; !machine.pendingInput && steps < 1000; steps++) machine.step()
					expect(machine.pendingInput).not.toBeNull()
					const cursor = machine.historyCursor
					expect(machine.provideInput(machine.pendingInput!.type === 'integer' ? '17' : 'abc')).toBe(true)
					finish(machine)
					const output = machine.console, count = machine.instructionCount, length = machine.history.length
					const entry = machine.history.at(Math.max(0, cursor - 1))!
					machine.rewindTo(entry.id)
					expect(machine.instructionCount).toBe(entry.instructionCount)
					await machine.continue()
					expect(machine.halted).toBe(true)
					expect(machine.console).toBe(output)
					expect(machine.instructionCount).toBe(count)
					expect(machine.history.length).toBe(length)
				} finally { machine.dispose() }
			} finally { services.dispose() }
		}
	})

	it('retains later rows and replays registers, output, memory, halt and debugger edits across CPU variants', async () => {
		const { definition } = await activateArchitecture(id)
		for (const settings of architectureVariants(definition)) {
			const services = definition.createServices()
			try {
				for (const key of ['sum', 'bitmap', 'factorial']) {
					const code = variantOf(definition, settings).examples[key].code
					const program = services.assemble({ files: [{ name: 'main.asm', code }], entries: ['main.asm'] }, settings)
					expect(program.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
					const machine = services.createMachine(program, settings, { speed: null, historyLimit: 100_000 })
					try {
						finish(machine)
						const registers = machine.registerValues(), output = machine.console
						const base = services.profile(settings).dataBase!
						const bytes = () => Array.from({ length: 64 }, (_, i) => machine.inspectMemory().byte(base + i))
						const memory = bytes(), history = machine.history
						const rows = history.slice(0, history.length).map((row) => [row.id, row.instructionCount, row.address, row.kind])
						const second = history.at(1)!.id
						for (let repeat = 0; repeat < 2; repeat++) {
							expect(machine.rewindTo(second)).toBe(true)
							expect(machine.historyCursor).toBe(1)
							expect(history.slice(0, history.length).map((row) => [row.id, row.instructionCount, row.address, row.kind])).toEqual(rows)
							expect(machine.rewindTo(second)).toBe(false) // A second click does nothing.
							expect(machine.historyCursor).toBe(1)
							finish(machine)
							expect(machine.registerValues()).toEqual(registers)
							expect(machine.console).toBe(output)
							expect(bytes()).toEqual(memory)
							expect(machine.callStack).toEqual([])
							expect(machine.historyCursor).toBe(rows.length)
							expect(history.slice(0, history.length).map((row) => [row.id, row.instructionCount, row.address, row.kind])).toEqual(rows)
						}
						machine.rewindTo(second)
						expect(machine.writeByte(base, 42)).toBe(true)
						expect(history.length).toBe(2)
						expect(machine.stepBack()).toBe(true)
						machine.step() // Recorded edit, rather than executing the next instruction.
						expect(machine.inspectMemory().byte(base)).toBe(42)
						expect(machine.historyCursor).toBe(2)
					} finally { machine.dispose() }
				}
			} finally { services.dispose() }
		}
	}, 30_000)
})
