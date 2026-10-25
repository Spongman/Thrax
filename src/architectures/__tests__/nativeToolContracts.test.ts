import { describe, expect, it } from 'vitest'
import { activateArchitecture, knownArchitectures } from '../registry'
import { variantOf, type Registers, type InstructionInfo } from '../contracts'

function resourceValue(name: string, values: Registers) {
	if (name === 'CCR/SR') return values.SR
	if (name === 'IXH' || name === 'IYH') return Number(values[name.slice(0, 2)]) >>> 8
	if (name === 'IXL' || name === 'IYL') return Number(values[name.slice(0, 2)]) & 255
	if (/^[BCDEHLFA]2$/.test(name)) {
		const pair = name[0] === 'A' || name[0] === 'F' ? 'AF2' : name[0] === 'B' || name[0] === 'C' ? 'BC2' : name[0] === 'D' || name[0] === 'E' ? 'DE2' : 'HL2'
		return (Number(values[pair]) >>> ('BDHA'.includes(name[0]) ? 8 : 0)) & 255
	}
	return values[name]
}

describe.each(knownArchitectures())('%s shared tool contracts', id => {
	it('supplies explicit units and shared retention counters', async () => {
		const { definition } = await activateArchitecture(id)
		const services = definition.createServices()
		try {
			const settings = definition.settings.defaults
			await services.prepare?.(settings)
			const program = services.assemble({ files: [{ name: 'main.asm', code: variantOf(definition, settings).examples.sum.code }], entries: ['main.asm'] }, settings)
			expect(program.diagnostics.filter(d => d.severity === 'error')).toEqual([])
			const machine = services.createMachine(program, settings, { speed: null, historyLimit: 10 })
			try {
				expect(machine.toolConfig().addressing?.instructionBytes).toBeGreaterThan(0)
				expect(machine.toolConfig().addressing?.memoryWordBytes).toBeGreaterThan(0)
				machine.step()
				expect(machine.history.retention).toMatchObject({ entries: machine.history.length, entryLimit: 10, entryEvictions: 0, byteEvictions: 0, oversizedEntries: 0 })
				expect(machine.history.retention!.liveBufferBytes).toBeGreaterThan(0)
			} finally { machine.dispose() }
		} finally { services.dispose() }
	})
})

describe.each(['z80', 'avr', 'mos6502', 'm68k', 'armv8'])('%s executed dependency coverage', id => {
	it('names every changed data register and flag resource in representative ports', async () => {
		const { definition } = await activateArchitecture(id)
		const settings = { ...definition.settings.defaults, ...(id === 'armv8' ? { executionState: 'cortex-m0' } : {}) }
		const services = definition.createServices()
		try {
			for (const topic of ['sum', 'factorial', 'fibonacci', 'loop', 'bitwise', 'ackermann', 'mandelbrot']) {
				await services.prepare?.(settings)
				const program = services.assemble({ files: [{ name: 'main.asm', code: variantOf(definition, settings).examples[topic].code }], entries: ['main.asm'] }, settings)
				expect(program.diagnostics.filter(d => d.severity === 'error')).toEqual([])
				const machine = services.createMachine(program, settings, { speed: null, historyLimit: 100 })
				try {
					const instructions = machine.toolConfig().instructions!
					let info: InstructionInfo | undefined
					machine.observers.push({ onInstruction: (_address, decoded) => { info = instructions.describe(decoded) } })
					for (let step = 0; step < 400 && !machine.halted && !machine.pendingInput; step++) {
						const before = machine.registerValues()
						info = undefined
						machine.step()
						if (!info) continue
						const after = machine.registerValues()
						for (const [resource, name] of instructions.registerNames.entries()) {
							if (name === 'PC' || (id === 'z80' && name === 'R')) continue // Implicit fetch progression.
							if (resourceValue(name, before) !== resourceValue(name, after)) {
								expect((info as InstructionInfo).writes, `${id}/${topic}/${step} ${name}`).toContain(resource)
							}
						}
					}
				} finally { machine.dispose() }
			}
		} finally { services.dispose() }
	})
})
