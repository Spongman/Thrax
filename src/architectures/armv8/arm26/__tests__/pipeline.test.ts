import { describe, expect, it } from 'vitest'
import { DEFAULT_PIPELINE_SETTINGS, PipelineModel, type PipelineSettings } from '../../../../tools/pipeline'
import { arm26InstructionSet } from '../instructions'
import definition from '../index'
import { DEFAULT_ARM26_SETTINGS } from '../settings'
import { stageAt } from '../../../../components/pipelineStages'
import { variantOf } from '../../../contracts'

/**
 * The ARM2's three stages: fetch, decode, execute, one instruction a cycle,
 * registers read and written in execute.  Words are hand-encoded.
 */

/** One instruction run, and for a branch which way it went. */
type Step = number | [word: number, taken: boolean]

function analyse(steps: Step[], settings: Partial<PipelineSettings> = {}) {
	const model = new PipelineModel({ ...DEFAULT_PIPELINE_SETTINGS, windowSize: 64, ...settings })
	model.onConfigure({ delayedBranching: false, instructions: arm26InstructionSet })
	steps.forEach((step, count) => {
		const [word, taken] = typeof step === 'number' ? [step, null] : step
		const address = 0x8000 + count * 4
		model.onInstruction(address, word, count)
		if (taken !== null) model.onBranch(address, taken)
	})
	return model.snapshot()
}

const MOV_R1_1 = 0xE3A01001
const ADD_R2_R1_R1 = 0xE0812001
const ADD_R3_R2_R1 = 0xE0823001
const LDR_R2_R1 = 0xE5912000
const B = 0xEAFFFFFE
const BNE = 0x1AFFFFFE

describe('ARM26 pipeline', () => {
	it.each(['arm2', 'arm3'] as const)('keeps %s clock schedules exact with slow memory and replay', cpuModel => {
		const services = definition.createServices()
		const settings = { ...DEFAULT_ARM26_SETTINGS, cpuModel, sequentialCycles: 3, latencyCycles: 2 }
		const code = cpuModel === 'arm3' ? variantOf(definition, settings).examples.cache.code : 'mov r1,#5\nmov r2,#7\nmul r3,r1,r2\ncmp r3,#35\nbeq done\nmov r3,#0\ndone: swi OS_Exit'
		try {
			const program = services.assemble({ files: [{ name: 'test.s', code }], entries: ['test.s'] }, settings)
			expect(program.diagnostics).toEqual([])
			const runtime = services.createMachine(program, settings, { historyLimit: 100, speed: null })
			const model = new PipelineModel({ ...DEFAULT_PIPELINE_SETTINGS, windowSize: 64, prediction: 'two-bit' })
			model.onConfigure(runtime.toolConfig())
			runtime.observers.push(model)
			for (let count = 0; count < 100 && !runtime.halted; count++) runtime.step()
			expect(runtime.halted).toBe(true)
			const before = model.snapshot()
			expect(before.cycles).toBe(Number(runtime.registerValues().CYCLES))
			expect(before.settings.prediction).toBe('none')
			expect(before.predictions).toBe(0)
			for (let cycle = 1; cycle <= before.cycles; cycle++) for (let stage = 0; stage < 3; stage++) {
				expect(before.rows.filter(row => stageAt(row, cycle)?.stage === stage).length, `${cpuModel}/${cycle}/${stage}`).toBeLessThanOrEqual(1)
			}
			for (let count = 0; count < 5; count++) runtime.stepBack()
			model.snapshot()
			while (!runtime.halted) runtime.step()
			expect(model.snapshot()).toEqual(before)
		} finally { services.dispose() }
	})

	it('runs dependent instructions back to back', () => {
		const snapshot = analyse([MOV_R1_1, ADD_R2_R1_R1, ADD_R3_R2_R1])
		expect(snapshot.rows.map((row) => row.cycles)).toEqual([[1, 2, 3], [2, 3, 4], [3, 4, 5]])
		expect(snapshot.dataStalls).toBe(0)
		expect(snapshot.cycles).toBe(5)
	})

	it('uses a loaded value on the next instruction without a stall', () => {
		const snapshot = analyse([LDR_R2_R1, ADD_R3_R2_R1])
		expect(snapshot.loadUseStalls + snapshot.dataStalls).toBe(0)
		expect(snapshot.structuralStalls).toBe(2)
		expect(snapshot.rows[0].durations).toEqual([1, 1, 3])
		expect(snapshot.rows[1].cycles).toEqual([2, 3, 6])
		expect(snapshot.cycles).toBe(6)
	})

	it.each([[0xE5812000, 2], [0xE8A1001C, 4], [0xE8B1001C, 5], [0xE1012093, 4], [0xE1A03211, 2]])(
		'holds execute for a multi-cycle operation 0x%s', (word, duration) => {
			const snapshot = analyse([word, MOV_R1_1])
			expect(snapshot.rows[0].durations![2]).toBe(duration)
			expect(snapshot.rows[0].completed).toBe(2 + duration)
			expect(snapshot.rows[1].cycles[2]).toBe(3 + duration)
			expect(snapshot.multiCycleCycles).toBe(duration - 1)
			for (let cycle = 1; cycle <= snapshot.cycles; cycle++) {
				for (let stage = 0; stage < 3; stage++)
					expect(snapshot.rows.filter((row) => stageAt(row, cycle)?.stage === stage).length).toBeLessThanOrEqual(1)
			}
		})

	it('starts a PC-loading refill after the multi-cycle load completes', () => {
		const snapshot = analyse([0xE591F000, MOV_R1_1])
		expect(snapshot.rows[0].completed).toBe(5)
		expect(snapshot.rows[1].cycles).toEqual([6, 7, 8])
		expect(snapshot.controlFlushes).toBe(2)
	})

	it('uses the executed multiplier operand and reproduces timing after rewind and reconfiguration', () => {
		const services = definition.createServices()
		const sources = { files: [{ name: 'test.s', code: 'mov r1,#7\nmov r2,#8\nmul r3,r1,r2\nmov r0,#0\nswi OS_Exit' }], entries: ['test.s'] }
		const program = services.assemble(sources, DEFAULT_ARM26_SETTINGS)
		expect(program.diagnostics).toEqual([])
		const runtime = services.createMachine(program, DEFAULT_ARM26_SETTINGS, { historyLimit: 100, speed: null })
		const model = new PipelineModel()
		model.onConfigure(runtime.toolConfig())
		runtime.observers.push(model)
		for (let step = 0; step < 5; step++) runtime.step()
		const before = model.snapshot()
		expect(before.cycles).toBe(12)
		expect(before.rows[2].durations).toEqual([1, 1, 4])
		expect(before.multiCycleCycles).toBe(4)
		expect(runtime.registerValues().CYCLES).toBe(12n)
		runtime.stepBack()
		runtime.stepBack()
		runtime.stepBack()
		expect(model.snapshot().cycles).toBe(5)
		expect(runtime.registerValues().CYCLES).toBe(5n)
		for (let step = 0; step < 3; step++) runtime.step()
		expect(model.snapshot().rows).toEqual(before.rows)
		model.configure({ ...DEFAULT_PIPELINE_SETTINGS, prediction: 'not-taken' })
		expect(model.snapshot().cycles).toBe(before.cycles)
		expect(model.snapshot().rows[2].durations).toEqual([1, 1, 4])
		services.dispose()
	})

	it('charges a failed conditional multiply one cycle without inventing a write or redirect', () => {
		const model = new PipelineModel()
		model.onConfigure({ delayedBranching: false, instructions: arm26InstructionSet })
		model.onInstruction(0x8000, { word: 0x00030291, executeCycles: 1, passed: false, redirected: false }, 0)
		expect(model.snapshot().cycles).toBe(3)
		expect(model.snapshot().multiCycleCycles).toBe(0)
	})

	it('does not replay an input-wait transition as an extra retired instruction', () => {
		const services = definition.createServices()
		const program = services.assemble({ files: [{ name: 'test.s', code: 'swi OS_ReadC\nswi OS_Exit' }], entries: ['test.s'] }, DEFAULT_ARM26_SETTINGS)
		const runtime = services.createMachine(program, DEFAULT_ARM26_SETTINGS, { historyLimit: 100, speed: null })
		const model = new PipelineModel()
		model.onConfigure(runtime.toolConfig())
		runtime.observers.push(model)
		runtime.step()
		expect(runtime.instructionCount).toBe(0)
		expect(runtime.history.at(0)!.kind).toBe('edit')
		runtime.provideInput('x')
		runtime.step()
		runtime.step()
		expect(model.snapshot().instructions).toBe(2)
		model.configure({ ...DEFAULT_PIPELINE_SETTINGS, prediction: 'not-taken' })
		expect(model.snapshot().instructions).toBe(2)
		services.dispose()
	})

	it('uses measured bus schedules without stage collisions, including after rewind', () => {
		const services = definition.createServices()
		const settings = { ...DEFAULT_ARM26_SETTINGS, sequentialCycles: 3, latencyCycles: 2 }
		const code = 'ldr r5,=0x10000\nmov r1,#2\nmov r2,#8\nstr r1,[r5]\nldr r3,[r5]\nmul r4,r1,r2\ncmp r4,#16\nbeq done\nmov r0,#0\ndone: swi OS_Exit'
		const program = services.assemble({ files: [{ name: 'test.s', code }], entries: ['test.s'] }, settings)
		const runtime = services.createMachine(program, settings, { historyLimit: 100, speed: null })
		const model = new PipelineModel()
		model.onConfigure(runtime.toolConfig())
		runtime.observers.push(model)
		while (!runtime.halted) runtime.step()
		const before = model.snapshot()
		expect(before.cycles).toBe(Number(runtime.registerValues().CYCLES))
		expect(before.controlFlushes).toBe(8) // Nonsequential target fetch (5) plus sequential second fetch (3).
		for (let cycle = 1; cycle <= before.cycles; cycle++) {
			for (let stage = 0; stage < 3; stage++)
				expect(before.rows.filter((row) => stageAt(row, cycle)?.stage === stage).length).toBeLessThanOrEqual(1)
		}
		for (let step = 0; step < 6; step++) runtime.stepBack()
		model.snapshot()
		while (!runtime.halted) runtime.step()
		expect(model.snapshot().rows).toEqual(before.rows)
		services.dispose()
	})

	it('discards the two instructions behind a branch it takes', () => {
		const snapshot = analyse([B, MOV_R1_1])
		expect(snapshot.rows.map((row) => row.cycles)).toEqual([[1, 2, 3], [4, 5, 6]])
		const untaken = analyse([[BNE, false], MOV_R1_1])
		expect(untaken.rows[1].cycles).toEqual([2, 3, 4])
		const taken = analyse([[BNE, true], MOV_R1_1])
		expect(taken.rows[1].cycles).toEqual([4, 5, 6])
	})
})
