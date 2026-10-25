/**
 * The classic MIPS five-stage pipeline, as the countermeasures of Tables III
 * and IV of Lim & Smitha, "Pipelined MIPS Simulation" (TALE 2019) describe it.
 * Forwarding feeds EX from the EX/MEM and MEM/WB latches; split decode reads
 * the register file in the half cycle after write-back writes it.
 */

import { PipelineResult, type PipelineModel } from '../contracts'

const { ALU, LOAD } = PipelineResult

const ID = 1
const EX = 2
const MEM = 3
const WB = 4

export const MIPS_PIPELINE: PipelineModel = Object.freeze({
	name: 'MIPS five-stage teaching pipeline',
	description: 'Single-issue, in-order estimate with the selected bypass, resolution and prediction rules. It does not model MARS instruction timing, floating-point unit latency, caches or bus contention.',
	stages: Object.freeze([
		{ label: 'IF', name: 'Instruction fetch', kind: 'if' },
		{ label: 'ID', name: 'Instruction decode', kind: 'id' },
		{ label: 'EX', name: 'Execute', kind: 'ex' },
		{ label: 'MEM', name: 'Memory access', kind: 'mem' },
		{ label: 'WB', name: 'Write back', kind: 'wb' },
	]),
	readStage: ID,
	writeStage: WB,
	hazards: Object.freeze([
		{
			value: 'forwarding', label: 'Forwarding (0 stalls)', useStage: EX, writeThenRead: true,
			bypasses: Object.freeze([{ from: MEM, results: ALU }, { from: WB, results: ALU | LOAD }]),
		},
		{ value: 'split-decode', label: 'Decode with write-back (2)', useStage: ID, writeThenRead: true, bypasses: [] },
		{ value: 'none', label: 'No countermeasure (3)', useStage: ID, writeThenRead: false, bypasses: [] },
	]),
	branches: Object.freeze([
		{ value: 'id', label: 'ID (1 bubble)', stage: ID },
		{ value: 'ex', label: 'EX (2 bubbles)', stage: EX },
		{ value: 'mem', label: 'MEM (3 bubbles)', stage: MEM },
	]),
	jumps: Object.freeze([
		{ value: 'id', label: 'ID (1 bubble)', stage: ID },
		{ value: 'ex', label: 'EX (2 bubbles)', stage: EX },
	]),
	delaySlots: 1,
})
