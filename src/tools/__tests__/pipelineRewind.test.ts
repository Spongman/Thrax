import { describe, expect, it } from 'vitest'
import { build, withExit } from '../../core/__tests__/helpers'
import { PipelineModel, DEFAULT_PIPELINE_SETTINGS, type PipelineSettings } from '../pipeline'

/**
 * Stepping back moves the machine, and the pipeline's reading has to move with
 * it.  It keeps no copy of itself per step, so what these check is that running
 * the instructions again lands on exactly what running them the first time did,
 * however far back the step goes.
 */

const body = `
	li $t0, 600
loop:
${Array.from({ length: 8 }, (_, index) => `	addi $t${(index % 6) + 1}, $zero, ${index}`).join('\n')}
	addi $t0, $t0, -1
	bgtz $t0, loop
`

function start(settings: Partial<PipelineSettings> = {}) {
	const simulator = build(withExit(body))
	const model = new PipelineModel({ ...DEFAULT_PIPELINE_SETTINGS, ...settings })
	model.onConfigure({ delayedBranching: false, history: simulator.executionHistory })
	simulator.observers.push(model)
	return { simulator, model }
}

/** The reading of a run that stopped at `target` and went no further. */
function reading(target: number, settings: Partial<PipelineSettings> = {}) {
	const { simulator, model } = start(settings)
	for (let step = 0; step < target; step++) simulator.step()
	return model.snapshot()
}

const shape = (snapshot: ReturnType<PipelineModel['snapshot']>) => ({
	cycles: snapshot.cycles,
	firstCycle: snapshot.firstCycle,
	rows: snapshot.rows.map((row) => [row.index, row.address, ...row.cycles, row.stalls, row.flushed].join(':')),
	dataStalls: snapshot.dataStalls,
	loadUseStalls: snapshot.loadUseStalls,
	controlFlushes: snapshot.controlFlushes,
	mispredictions: snapshot.mispredictions,
})

describe('the pipeline after a rewind', () => {
	it('agrees with a run that stopped there, past any window of checkpoints', () => {
		const target = 200
		const expected = reading(target)

		const { simulator, model } = start()
		for (let step = 0; step < 5000; step++) simulator.step()
		while (simulator.instructionCount > target) simulator.stepBack()

		expect(simulator.instructionCount).toBe(target)
		expect(shape(model.snapshot())).toEqual(shape(expected))
	})

	it('lands on the same reading going back and forward again', () => {
		const { simulator, model } = start()
		for (let step = 0; step < 900; step++) simulator.step()
		const before = shape(model.snapshot())

		for (let step = 0; step < 400; step++) simulator.stepBack()
		for (let step = 0; step < 400; step++) simulator.step()

		expect(shape(model.snapshot())).toEqual(before)
	})

	it('keeps the predictor honest across a rewind', () => {
		const target = 300
		const expected = reading(target, { prediction: 'two-bit' })

		const { simulator, model } = start({ prediction: 'two-bit' })
		for (let step = 0; step < 3000; step++) simulator.step()
		while (simulator.instructionCount > target) simulator.stepBack()

		const rewound = model.snapshot()
		expect(rewound.predictions).toBe(expected.predictions)
		expect(rewound.mispredictions).toBe(expected.mispredictions)
		expect(shape(rewound)).toEqual(shape(expected))
	})

	it('works the timeline out again when the timing model changes', () => {
		const target = 120
		const { simulator, model } = start()
		for (let step = 0; step < target; step++) simulator.step()

		model.configure({ ...DEFAULT_PIPELINE_SETTINGS, dataHazards: 'none' })
		expect(shape(model.snapshot())).toEqual(shape(reading(target, { dataHazards: 'none' })))
	})
})
