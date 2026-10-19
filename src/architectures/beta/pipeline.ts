/**
 * The 6.004 five-stage pipelined Beta, after L15 "Pipelining the Beta"
 * (computationstructures.org/lectures/pbeta/pbeta.html):
 *
 * - IF, RF, ALU, MEM, WB; RF reads Ra and Rb (Rc for ST), WB writes Rc at the
 *   end of its cycle, and a read on that same cycle still sees the old value.
 * - Full bypassing routes ALU, MEM and WB stage results (PC + 4 included) into
 *   RF's read ports, so dependent ALU instructions run back to back.
 * - LD data is only in the datapath once LD reaches WB, so a use right behind
 *   it stalls two cycles in RF even with full bypassing.
 * - Without bypassing RF stalls until the register file holds the value, three
 *   cycles for adjacent instructions.
 * - Branches and JMP decide in RF.  Fetch speculates PC + 4 and the one
 *   instruction in IF is annulled for a JMP or a taken branch; no delay slot.
 */

import { PipelineResult, type PipelineModel } from '../contracts'

const { ALU, LOAD } = PipelineResult

export const STAGE_IF = 0
export const STAGE_RF = 1
export const STAGE_ALU = 2
export const STAGE_MEM = 3
export const STAGE_WB = 4

export const BETA_PIPELINE: PipelineModel = Object.freeze({
	stages: Object.freeze([
		{ label: 'IF', name: 'Instruction fetch', kind: 'if' },
		{ label: 'RF', name: 'Register file, with bypass; decides branches and JMP', kind: 'id' },
		{ label: 'ALU', name: 'ALU, or memory address', kind: 'ex' },
		{ label: 'MEM', name: 'Memory access', kind: 'mem' },
		{ label: 'WB', name: 'Write back', kind: 'wb' },
	]),
	readStage: STAGE_RF,
	writeStage: STAGE_WB,
	hazards: Object.freeze([
		{
			value: 'forwarding', label: 'Full bypass (LD: 2 stalls)', useStage: STAGE_RF, writeThenRead: false,
			bypasses: Object.freeze([
				{ from: STAGE_ALU, results: ALU },
				{ from: STAGE_MEM, results: ALU },
				{ from: STAGE_WB, results: ALU | LOAD },
			]),
		},
		{ value: 'none', label: 'Stall only (3)', useStage: STAGE_RF, writeThenRead: false, bypasses: [] },
	]),
	branches: Object.freeze([{ value: 'id', label: 'RF (1 annulled)', stage: STAGE_RF }]),
	jumps: Object.freeze([{ value: 'id', label: 'RF (1 annulled)', stage: STAGE_RF }]),
	delaySlots: 0,
})
