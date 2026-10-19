/**
 * The ARM2's three-stage pipeline: fetch, decode, execute.  Registers are read
 * and written in execute, so one instruction's result is there for the next
 * with no stall; that is modelled as a bypass from execute into execute.  A
 * branch, or any write to PC, is decided in execute, so the two instructions
 * fetched behind it are discarded.  That is also why R15 reads 8 ahead.
 * Multi-cycle instructions (loads, stores, multiplies) are not modelled.
 */

import { PipelineResult, type PipelineModel } from '../contracts'

const { ALU, LOAD } = PipelineResult

export const STAGE_FETCH = 0
export const STAGE_DECODE = 1
export const STAGE_EXECUTE = 2

export const ARM26_PIPELINE: PipelineModel = Object.freeze({
	stages: Object.freeze([
		{ label: 'F', name: 'Fetch', kind: 'if' },
		{ label: 'D', name: 'Decode', kind: 'id' },
		{ label: 'E', name: 'Execute: read registers, shift, ALU or memory, write back', kind: 'ex' },
	]),
	readStage: STAGE_DECODE,
	writeStage: STAGE_EXECUTE,
	hazards: Object.freeze([
		{
			value: 'forwarding', label: 'Read and written in execute (no stalls)', useStage: STAGE_EXECUTE, writeThenRead: false,
			bypasses: Object.freeze([{ from: STAGE_EXECUTE, results: ALU | LOAD }]),
		},
	]),
	branches: Object.freeze([{ value: 'ex', label: 'Execute (2 discarded)', stage: STAGE_EXECUTE }]),
	jumps: Object.freeze([{ value: 'ex', label: 'Execute (2 discarded)', stage: STAGE_EXECUTE }]),
	delaySlots: 0,
})
