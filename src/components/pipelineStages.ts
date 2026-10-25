/**
 * Reading a pipeline schedule two ways: across an instruction, which is the
 * timeline, and across a cycle, which is the stages of the machine at one
 * moment.  Both come from the same window of rows, so a cycle picked in one is
 * the cycle shown in the other.
 */

import type { PipelineRow } from '../tools/pipeline'

export interface StagePosition {
	/** Index into the model's stages. */
	stage: number
	/** Held in the stage rather than working in it, waiting on what is ahead. */
	stalled: boolean
}

/**
 * Where `row` is on `cycle`, or null when it is not in flight.  A stage runs
 * from the cycle it is entered until the next stage is entered, so the cycles
 * between are the bubble a hazard opened up.
 */
export function stageAt(row: PipelineRow, cycle: number): StagePosition | null {
	const { cycles } = row
	const last = cycles.length - 1
	if (cycle >= cycles[last] && cycle < cycles[last] + (row.durations?.[last] ?? 1)) return { stage: last, stalled: false }
	for (let stage = last - 1; stage >= 0; stage--) {
		if (cycle >= cycles[stage] && cycle < cycles[stage + 1]) return { stage, stalled: cycle >= cycles[stage] + (row.durations?.[stage] ?? 1) }
	}
	return null
}

export interface StageOccupant {
	row: PipelineRow
	stalled: boolean
}

/**
 * The instruction in each stage on `cycle`, or null for a stage standing empty.
 * The machine issues in order, so one stage holds at most one instruction.
 */
export function stageOccupants(rows: readonly PipelineRow[], cycle: number, stageCount = rows[0]?.cycles.length ?? 0): Array<StageOccupant | null> {
	const occupants = new Array<StageOccupant | null>(stageCount).fill(null)
	for (const row of rows) {
		const position = stageAt(row, cycle)
		if (position && !occupants[position.stage]) occupants[position.stage] = { row, stalled: position.stalled }
	}
	return occupants
}

export type HazardKind = 'data' | 'load-use' | 'control' | 'structural'

export interface Hazard {
	kind: HazardKind
	/** Cycles this instruction lost to it. */
	cycles: number
	/** Register waited on, for a data hazard. */
	register: number | null
	/** The instruction that caused it, when its row is still in the window. */
	producer: PipelineRow | null
}

/**
 * What `rows[at]` waited for.  A data hazard names the register the model
 * blocked on; a control hazard is the redirect the instruction before it
 * caused, which is where a real pipeline pays the penalty.
 */
export function hazardsOf(rows: readonly PipelineRow[], at: number): Hazard[] {
	const row = rows[at]
	if (!row) return []
	const hazards: Hazard[] = []
	const structural = row.structuralStalls ?? 0
	if (structural > 0) hazards.push({ kind: 'structural', cycles: structural, register: null, producer: rows[at - 1] ?? null })
	if (row.stalls > structural) {
		hazards.push({
			kind: row.cause === 'load-use' ? 'load-use' : 'data',
			cycles: row.stalls - structural,
			register: row.blockedOn,
			producer: rows.find((candidate) => candidate.index === row.blockedBy) ?? null,
		})
	}
	if (row.flushed > 0) {
		const producer = row.flushedBy === undefined ? rows[at - 1] : rows.find(candidate => candidate.index === row.flushedBy)
		hazards.push({ kind: 'control', cycles: row.flushed, register: null, producer: producer ?? null })
	}
	return hazards
}

/** How many of each hazard the shown rows carry. */
export function hazardCounts(rows: readonly PipelineRow[]): Record<HazardKind, number> {
	const counts: Record<HazardKind, number> = { data: 0, 'load-use': 0, control: 0, structural: 0 }
	for (let index = 0; index < rows.length; index++) {
		for (const hazard of hazardsOf(rows, index)) counts[hazard.kind] += 1
	}
	return counts
}

export const registerName = (register: number, names: readonly string[]) => names[register] ?? `r${register}`

/** One line of the hazard report. */
export function describeHazard(hazard: Hazard, names: readonly string[]): string {
	if (hazard.kind === 'control') return 'Control: an earlier branch or jump redirected the front end'
	if (hazard.kind === 'structural') return 'Resource: an earlier instruction still occupies the next stage'
	const register = hazard.register === null ? 'an earlier result' : registerName(hazard.register, names)
	return hazard.kind === 'load-use'
		? `Load-use: waiting on ${register}, which a load has not yet returned`
		: `RAW: waiting on ${register}, which is still being computed`
}
