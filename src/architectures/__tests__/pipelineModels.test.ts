import { describe, expect, it } from 'vitest'
import { activateArchitecture, knownArchitectures } from '../registry'
import { variantOf } from '../contracts'
import { architectureVariants } from './helpers'
import { DEFAULT_PIPELINE_SETTINGS, PipelineModel } from '../../tools/pipeline'
import { stageAt } from '../../components/pipelineStages'

describe.each(knownArchitectures())('%s pipeline capability', id => {
	it('declares the correct model and preserves its schedule through replay for every variant', async () => {
		const { definition } = await activateArchitecture(id), services = definition.createServices()
		try {
			for (const settings of architectureVariants(definition)) {
				await services.prepare?.(settings)
				const variant = variantOf(definition, settings), context = `${id}/${JSON.stringify(settings)}`
				const program = services.assemble({ files: [{ name: 'main.asm', code: variant.examples.factorial.code }], entries: ['main.asm'] }, settings)
				expect(program.diagnostics.filter(d => d.severity === 'error'), context).toEqual([])
				const machine = services.createMachine(program, settings, { speed: null, historyLimit: 1000 })
				const model = new PipelineModel({ ...DEFAULT_PIPELINE_SETTINGS, windowSize: 64 })
				model.onConfigure(machine.toolConfig())
				machine.observers.push(model)
				for (let i = 0; i < 40 && !machine.halted; i++) machine.step()
				const snapshot = model.snapshot()
				const supported = ['mips', 'beta'].includes(id) || id === 'armv8' && settings.executionState !== 'cortex-m0'
				expect(snapshot.available, context).toBe(supported)
				if (!supported) {
					expect(snapshot).toMatchObject({ model: null, instructions: 0, cycles: 0, rows: [] })
					continue
				}
				expect(snapshot.instructions, context).toBe(machine.instructionCount)
				expect(snapshot.model!.name, context).toBeTruthy()
				expect(snapshot.model!.description, context).toBeTruthy()
				for (const row of snapshot.rows) {
					expect(row.cycles, context).toHaveLength(snapshot.model!.stages.length)
					for (let i = 1; i < row.cycles.length; i++) expect(row.cycles[i], context).toBeGreaterThanOrEqual(row.cycles[i - 1] + row.durations![i - 1])
				}
				for (let cycle = snapshot.firstCycle; cycle <= snapshot.cycles; cycle++) for (let stage = 0; stage < snapshot.model!.stages.length; stage++) {
					expect(snapshot.rows.filter(row => stageAt(row, cycle)?.stage === stage).length, `${context}/${cycle}/${stage}`).toBeLessThanOrEqual(1)
				}
				const before = structuredClone({ ...snapshot, model: null })
				const count = Math.min(8, machine.historyCursor)
				for (let i = 0; i < count; i++) expect(machine.stepBack(), context).toBe(true)
				expect(model.snapshot().instructions, context).toBe(machine.instructionCount)
				for (let i = 0; i < count; i++) machine.step()
				expect({ ...model.snapshot(), model: null }, context).toEqual(before)
			}
		} finally { services.dispose() }
	})
})
