import { describe, expect, it } from 'vitest'
import { createConfiguredFamily } from '../configuredFamily'
import { cpuHistorySchema, type CpuConfiguration } from '../configuredCpu'
import { ConfiguredRuntime } from '../configuredRuntime'
import { EMPTY_MEMORY, variantOf } from '../../architectures/contracts'

function fixture() {
	const configuration = (id: string, value: number): CpuConfiguration => ({
		id: 'fixture', name: `Fixture ${id}`, language: `fixture-${id}`, reference: 'https://example.com/manual',
		registers: [{ id: 'r0', name: 'R0', bank: 'cpu', bits: value === 1 ? 8 : 16, editable: true }],
		memoryBytes: 256, textBase: 0, dataBase: 128, pcBits: 8, wordBytes: 1, instructionAlignment: 1, littleEndian: true,
		historySchema: cpuHistorySchema({ registers: 1, wide: false, instructionBytes: 1 }), examples: {},
		instructions: ['put'], instructionHelp: { put: { syntax: 'PUT', description: `Store model ${id}'s native value in R0.` } },
		instructionSize: () => 1, encode: () => [value], decode: memory => { if (memory[0] !== value) throw new Error('Wrong native encoding'); return { size: 1, text: 'put', execute: c => { c.r[0] = value } } },
	})
	return createConfiguredFamily({ id: 'fixture', name: 'Fixture', defaultModel: 'a', models: {
		a: { label: 'Model A', configuration: configuration('A', 1) }, b: { label: 'Model B', configuration: configuration('B', 2) },
	} })
}

describe('configured CPU family ownership and variant routing', () => {
	it('selects native metadata and pins instruction help to the loaded variant', () => {
		const definition = fixture(), services = definition.createServices()
		try {
			const assemble = (model: string) => services.assemble({ files: [{ name: 'main.asm', code: 'put' }], entries: ['main.asm'] }, { cpuModel: model })
			expect(variantOf(definition, { cpuModel: 'b' }).registers[0].bits).toBe(16)
			expect(variantOf(definition, { cpuModel: 'invalid' }).registers[0].bits).toBe(8)
			const a = assemble('a'), machine = services.createMachine(a, { cpuModel: 'a' }, { speed: null, historyLimit: 100 }) as ConfiguredRuntime
			machine.step(); expect(machine.registerValues().r0).toBe(1)
			const b = assemble('b'), inspection = { registers: {}, labels: new Map<string, number>(), memory: EMPTY_MEMORY }
			expect(services.describeToken!('put', 0, inspection)!.contents[0]).toContain('Fixture A')
			expect(() => services.createMachine(a, { cpuModel: 'b' }, { speed: null, historyLimit: 100 })).toThrow(/reassemble/)
			expect(machine.isDisposed).toBe(false)
			const next = services.createMachine(b, { cpuModel: 'b' }, { speed: null, historyLimit: 100 }) as ConfiguredRuntime
			expect(machine.isDisposed).toBe(true)
			expect(services.describeToken!('put', 0, inspection)!.contents[0]).toContain('Fixture B')
			services.releaseMachine(machine) // Stale releases cannot clear a new run.
			expect(next.isDisposed).toBe(false)
			next.step(); expect(next.registerValues().r0).toBe(2)
			services.releaseMachine(next); expect(next.isDisposed).toBe(true)
			services.dispose(); expect(() => assemble('a')).toThrow(/disposed/)
		} finally { services.dispose() }
	})
	it('accepts another service’s matching program and refuses a different model', () => {
		const definition = fixture(), first = definition.createServices(), second = definition.createServices()
		try {
			const program = first.assemble({ files: [{ name: 'main.asm', code: 'put' }], entries: ['main.asm'] }, { cpuModel: 'b' })
			expect(() => second.createMachine(program, { cpuModel: 'a' }, { speed: null, historyLimit: 100 })).toThrow(/reassemble/)
			const machine = second.createMachine(program, { cpuModel: 'b' }, { speed: null, historyLimit: 100 })
			machine.step(); expect(machine.registerValues().r0).toBe(2)
		} finally { first.dispose(); second.dispose() }
	})
})
