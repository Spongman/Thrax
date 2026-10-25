import { describe, expect, it } from 'vitest'
import definition from '../../index'
import { DEFAULT_ARMV8_SETTINGS } from '../../settings'
import { a32InstructionSet } from '../instructions'
import { DEFAULT_PIPELINE_SETTINGS, PipelineModel } from '../../../../tools/pipeline'

async function build(code: string) {
	const services = definition.createServices(), settings = { ...DEFAULT_ARMV8_SETTINGS, executionState: 'aarch32' }
	await services.prepare?.(settings)
	const program = services.assemble({ files: [{ name: 'test.s', code }], entries: ['test.s'] }, settings)
	expect(program.diagnostics).toEqual([])
	const machine = services.createMachine(program, settings, { speed: null, historyLimit: 100 })
	const model = new PipelineModel({ ...DEFAULT_PIPELINE_SETTINGS, windowSize: 64 })
	model.onConfigure(machine.toolConfig())
	machine.observers.push(model)
	return { services, machine, model }
}

describe('A32 executed pipeline metadata', () => {
	it.each([
		['adr r4,target\nmov pc,r4', 2, 'alu'],
		['adr r4,pointer\nldr pc,[r4]', 3, 'load'],
	] as const)('waits for a computed target in %s despite selecting ID resolution', async (body, stage, result) => {
		const { services, machine, model } = await build(`${body}\nmov r1,#99\ntarget: mov r7,#1\nsvc #0\npointer: .word target`)
		try {
			model.configure({ ...DEFAULT_PIPELINE_SETTINGS, resolveBranchIn: 'id', resolveJumpIn: 'id', windowSize: 64 })
			while (!machine.halted) machine.step()
			const snapshot = model.snapshot()
			expect(snapshot.controlFlushes).toBe(stage)
			expect(snapshot.rows[2].cycles[0]).toBeGreaterThanOrEqual(snapshot.rows[1].cycles[stage + 1])
			const instruction = a32InstructionSet.decodeExecuted(machine.history.at(1)!)
			expect(a32InstructionSet.describe(instruction).controlResult).toBe(result)
		} finally { services.dispose() }
	})

	it('keeps failed predicates free of false data traffic and redirects during replay', async () => {
		const { services, machine, model } = await build('mov r0,#0\ncmp r0,#0\nmovne r1,#99\nldrne r2,[r3]\nmovne pc,r4\nadd r5,r1,#1\nmov r7,#1\nsvc #0')
		try {
			while (!machine.halted) machine.step()
			expect(machine.registerValues().R5).toBe(1)
			const entries = machine.history.slice(0, machine.history.length)
			for (const entry of entries.slice(2, 5)) {
				const decoded = a32InstructionSet.decodeExecuted(entry)
				expect(decoded).toMatchObject({ passed: false })
				expect(a32InstructionSet.describe(decoded)).toMatchObject({ reads: [16], writes: [], isLoad: false, isJump: false })
			}
			const before = model.snapshot()
			expect(before.controlFlushes).toBe(0)
			expect(before.loadUseStalls).toBe(0)
			model.configure({ ...DEFAULT_PIPELINE_SETTINGS, dataHazards: 'none', windowSize: 64 })
			const rebuilt = model.snapshot()
			expect(rebuilt.rows[5].stalls).toBe(0) // R1 was never written by MOVNE.
			for (let i = 0; i < 6; i++) machine.stepBack()
			model.snapshot()
			while (!machine.halted) machine.step()
			expect(model.snapshot()).toEqual(rebuilt)
		} finally { services.dispose() }
	})

	it('reports a conditional ALU write to PC as a branch with its actual outcome', async () => {
		const { services, machine, model } = await build('adr r4,target\ncmp r0,#0\nmoveq pc,r4\nmov r1,#99\ntarget: mov r7,#1\nsvc #0')
		try {
			while (!machine.halted) machine.step()
			expect(machine.registerValues().R1).toBe(0)
			expect(model.snapshot().controlFlushes).toBe(2)
			model.configure({ ...DEFAULT_PIPELINE_SETTINGS, prediction: 'taken', windowSize: 64 })
			expect(model.snapshot().predictions).toBe(1)
			expect(model.snapshot().mispredictions).toBe(0)
			expect(model.snapshot().controlFlushes).toBe(0)
		} finally { services.dispose() }
	})
})
