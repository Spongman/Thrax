/**
 * Reading a pipeline schedule two ways: across an instruction, which is the
 * timeline, and across a cycle, which is the five stages of the machine at one
 * moment.  Both come from the same window of rows, so a cycle picked in one is
 * the cycle shown in the other.
 */

import { REGISTER_NAMES } from '../core/registers'
import type { PipelineRow } from '../tools/pipeline'

/** The stage cells, in the order a row's cycles are recorded. */
export const STAGE_KINDS = ['if', 'id', 'ex', 'mem', 'wb'] as const
export const STAGE_LABELS = ['IF', 'ID', 'EX', 'MEM', 'WB'] as const
export const STAGE_NAMES = ['Instruction fetch', 'Instruction decode', 'Execute', 'Memory access', 'Write back'] as const

export interface StagePosition {
	/** Index into STAGE_KINDS. */
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
	const [fetch, decode, execute, memory, write] = row.cycles
	if (cycle === write) return { stage: 4, stalled: false }
	if (cycle === memory) return { stage: 3, stalled: false }
	if (cycle === execute) return { stage: 2, stalled: false }
	if (cycle >= decode && cycle < execute) return { stage: 1, stalled: cycle > decode }
	if (cycle >= fetch && cycle < decode) return { stage: 0, stalled: cycle > fetch }
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
export function stageOccupants(rows: readonly PipelineRow[], cycle: number): Array<StageOccupant | null> {
	const occupants: Array<StageOccupant | null> = [null, null, null, null, null]
	for (const row of rows) {
		const position = stageAt(row, cycle)
		if (position && !occupants[position.stage]) occupants[position.stage] = { row, stalled: position.stalled }
	}
	return occupants
}

export type HazardKind = 'data' | 'load-use' | 'control'

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
	if (row.stalls > 0) {
		hazards.push({
			kind: row.cause === 'load-use' ? 'load-use' : 'data',
			cycles: row.stalls,
			register: row.blockedOn,
			producer: rows.find((candidate) => candidate.index === row.blockedBy) ?? null,
		})
	}
	if (row.flushed > 0) {
		hazards.push({ kind: 'control', cycles: row.flushed, register: null, producer: rows[at - 1] ?? null })
	}
	return hazards
}

/** How many of each hazard the shown rows carry. */
export function hazardCounts(rows: readonly PipelineRow[]): Record<HazardKind, number> {
	const counts: Record<HazardKind, number> = { data: 0, 'load-use': 0, control: 0 }
	for (let index = 0; index < rows.length; index++) {
		for (const hazard of hazardsOf(rows, index)) counts[hazard.kind] += 1
	}
	return counts
}

export const registerName = (register: number) => REGISTER_NAMES[register] ?? `$${register}`

/** One line of the hazard report. */
export function describeHazard(hazard: Hazard): string {
	if (hazard.kind === 'control') return 'Control: the branch or jump before it redirected the front end'
	const register = hazard.register === null ? 'an earlier result' : registerName(hazard.register)
	return hazard.kind === 'load-use'
		? `Load-use: waiting on ${register}, which a load has not yet returned`
		: `RAW: waiting on ${register}, which is still being computed`
}
