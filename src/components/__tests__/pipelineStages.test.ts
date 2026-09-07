import { describe, expect, it } from 'vitest'
import { build, withExit } from '../../core/__tests__/helpers'
import { PipelineModel, type PipelineSettings } from '../../tools/pipeline'
import { hazardCounts, hazardsOf, stageAt, stageOccupants } from '../pipelineStages'

/**
 * The pipeline panel reads the same schedule two ways: down an instruction and
 * across a cycle.  These check the second reading against the model that made
 * the first, since a stage view that disagrees with the timeline beside it is
 * worse than no stage view.
 */

const SETTINGS: PipelineSettings = {
	dataHazards: 'forwarding',
	resolveBranchIn: 'ex',
	resolveJumpIn: 'id',
	prediction: 'none',
	windowSize: 64,
}

async function analyse(body: string, settings: Partial<PipelineSettings> = {}) {
	const simulator = build(withExit(body))
	const model = new PipelineModel({ ...SETTINGS, ...settings })
	simulator.observers.push(model)
	await simulator.run()
	return model.snapshot()
}

describe('stage occupancy', () => {
	it('puts each instruction in one stage per cycle, in order', async () => {
		const { rows } = await analyse(`
			addi $t0, $zero, 1
			addi $t1, $zero, 2
			addi $t2, $zero, 3
			addi $t3, $zero, 4
			addi $t4, $zero, 5
		`)
		// The fifth instruction is fetched on the cycle the first writes back, so
		// that cycle has all five stages busy, newest at the front.
		const cycle = rows[0].cycles[4]
		const occupants = stageOccupants(rows, cycle)
		expect(occupants.map((occupant) => occupant?.row.index)).toEqual([5, 4, 3, 2, 1])
		expect(occupants.every((occupant) => occupant && !occupant.stalled)).toBe(true)
	})

	it('leaves a stage empty where the pipeline has not filled', async () => {
		const { rows } = await analyse('addi $t0, $zero, 1')
		const occupants = stageOccupants(rows, rows[0].cycles[0])
		expect(occupants[0]?.row.index).toBe(1)
		expect(occupants.slice(1)).toEqual([null, null, null, null])
	})

	it('holds a stalled instruction in the stage it is waiting in', async () => {
		const { rows } = await analyse(`
			lw $t0, 0($sp)
			add $t1, $t0, $t0
		`)
		const consumer = rows[1]
		expect(consumer.stalls).toBe(1)
		// It decodes, then waits a cycle in ID for the load to come back.
		expect(stageAt(consumer, consumer.cycles[1])).toEqual({ stage: 1, stalled: false })
		expect(stageAt(consumer, consumer.cycles[1] + 1)).toEqual({ stage: 1, stalled: true })
		expect(stageOccupants(rows, consumer.cycles[1] + 1)[1]?.stalled).toBe(true)
	})

	it('reports nothing for a cycle the instruction has left', async () => {
		const { rows } = await analyse('addi $t0, $zero, 1')
		expect(stageAt(rows[0], rows[0].cycles[4] + 1)).toBeNull()
	})
})

describe('hazard report', () => {
	it('names the load a load-use hazard waited for', async () => {
		const { rows } = await analyse(`
			lw $t0, 0($sp)
			add $t1, $t0, $t0
		`)
		const hazards = hazardsOf(rows, 1)
		expect(hazards).toHaveLength(1)
		expect(hazards[0].kind).toBe('load-use')
		expect(hazards[0].cycles).toBe(1)
		expect(hazards[0].register).toBe(8)
		expect(hazards[0].producer?.index).toBe(1)
	})

	it('calls a stall a RAW hazard where forwarding is not doing the work', async () => {
		const { rows } = await analyse(`
			addi $t0, $zero, 1
			add $t1, $t0, $t0
		`, { dataHazards: 'none' })
		const hazards = hazardsOf(rows, 1)
		expect(hazards[0].kind).toBe('data')
		expect(hazards[0].register).toBe(8)
		expect(hazards[0].producer?.index).toBe(1)
	})

	it('reports a redirect against the instruction that paid for it', async () => {
		const { rows } = await analyse(`
			addi $t0, $zero, 1
			j onwards
			nop
		onwards:
			addi $t1, $zero, 2
		`)
		const victim = rows.findIndex((row) => row.flushed > 0)
		expect(victim).toBeGreaterThan(0)
		const [hazard] = hazardsOf(rows, victim)
		expect(hazard.kind).toBe('control')
		expect(hazard.cycles).toBe(rows[victim].flushed)
		// The jump ahead of it is what redirected the front end.
		expect(hazard.producer?.index).toBe(rows[victim].index - 1)
	})

	it('counts nothing for a run with no hazard in it', async () => {
		const { rows } = await analyse(`
			addi $t0, $zero, 1
			addi $t1, $zero, 2
		`)
		expect(hazardCounts(rows.slice(0, 2))).toEqual({ data: 0, 'load-use': 0, control: 0 })
	})
})
