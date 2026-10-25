/**
 * The ARM2's three-stage pipeline: fetch, decode, execute.  Registers are read
 * and written in execute, so one instruction's result is there for the next
 * with no stall; that is modelled as a bypass from execute into execute.  A
 * branch, or any write to PC, is decided in execute, so the two instructions
 * fetched behind it are discarded.  That is also why R15 reads 8 ahead.
 * Multi-cycle operations hold execute while fetch and decode back up behind it.
 */

import { PipelineResult, type PipelineModel } from '../../contracts'
import { operationCycles } from './timing'

const { ALU, LOAD } = PipelineResult

export const STAGE_FETCH = 0
export const STAGE_DECODE = 1
export const STAGE_EXECUTE = 2

export const ARM26_PIPELINE: PipelineModel = Object.freeze({
	name: 'ARM2/ARM3 execution schedule',
	description: 'Fetch/decode/execute timing recorded by the selected CPU model, including multicycle operations, configured bus timing and ARM3 cache behavior. Counts are reference-clock ticks; board-level MEMC and refresh are not modeled.',
	resultStages: Object.freeze({ alu: STAGE_EXECUTE, load: STAGE_EXECUTE }),
	prediction: false,
	executionTiming(instruction: unknown) {
		if (typeof instruction === 'number') return undefined
		const executed = instruction as { timing?: readonly number[], redirected: boolean }
		const t = executed.timing
		return t ? {
			starts: [t[0], t[5], t[2]],
			durations: [Math.max(1, t[1] - t[0]), 1, Math.max(1, t[3] - t[2])],
			completed: t[4], discarded: executed.redirected ? 2 : 0,
			refillCycles: executed.redirected ? Math.max(0, t[4] - t[3]) : 0,
		} : undefined
	},
	stageCycles(instruction: unknown, stage: number) {
		if (stage !== STAGE_EXECUTE) return 1
		return typeof instruction === 'number' ? operationCycles(instruction, 0) : (instruction as { executeCycles: number }).executeCycles
	},
	stages: Object.freeze([
		{ label: 'F', name: 'Fetch', kind: 'if' },
		{ label: 'D', name: 'Decode', kind: 'id' },
		{ label: 'E', name: 'Execute: read registers, shift, ALU or memory, write back', kind: 'ex' },
	]),
	readStage: STAGE_DECODE,
	writeStage: STAGE_EXECUTE,
	hazards: Object.freeze([
		{
			value: 'forwarding', label: 'Read and written in execute (no RAW stalls)', useStage: STAGE_EXECUTE, writeThenRead: false,
			bypasses: Object.freeze([{ from: STAGE_EXECUTE, results: ALU | LOAD }]),
		},
	]),
	branches: Object.freeze([{ value: 'ex', label: 'Execute (2 discarded)', stage: STAGE_EXECUTE }]),
	jumps: Object.freeze([{ value: 'ex', label: 'Execute (2 discarded)', stage: STAGE_EXECUTE }]),
	delaySlots: 0,
})
