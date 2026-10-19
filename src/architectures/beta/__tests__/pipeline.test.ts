import { describe, expect, it } from 'vitest'
import { DEFAULT_PIPELINE_SETTINGS, PipelineModel, type PipelineSettings } from '../../../tools/pipeline'
import { betaInstructionSet } from '../instructions'
import { OP_ADD, OP_ADDC, OP_BNE, OP_JMP, OP_LD, OP_SUBC } from '../isa'

/**
 * Timings worked by hand from L15 "Pipelining the Beta"
 * (computationstructures.org/lectures/pbeta/pbeta.html).  Cycles are listed
 * as the cycle each of IF, RF, ALU, MEM and WB is entered.
 */

const op = (opcode: number, ra: number, rb: number, rc: number) => ((opcode << 26) | (rc << 21) | (ra << 16) | (rb << 11)) >>> 0
const opc = (opcode: number, ra: number, literal: number, rc: number) => ((opcode << 26) | (rc << 21) | (ra << 16) | (literal & 0xFFFF)) >>> 0

const R31 = 31

/** One instruction run, and for a branch which way it went. */
type Step = number | [word: number, taken: boolean]

function analyse(steps: Step[], settings: Partial<PipelineSettings> = {}) {
	const model = new PipelineModel({ ...DEFAULT_PIPELINE_SETTINGS, windowSize: 64, ...settings })
	model.onConfigure({ delayedBranching: false, instructions: betaInstructionSet })
	steps.forEach((step, count) => {
		const [word, taken] = typeof step === 'number' ? [step, null] : step
		const address = count * 4
		model.onInstruction(address, word, count)
		if (taken !== null) model.onBranch(address, taken)
	})
	return model.snapshot()
}

describe('Beta pipeline: RAW chain', () => {
	// ADDC(R31, 1, R1); ADD(R1, R1, R2); ADD(R2, R1, R3)
	const chain = [opc(OP_ADDC, R31, 1, 1), op(OP_ADD, 1, 1, 2), op(OP_ADD, 2, 1, 3)]

	it('bypasses ALU and MEM results into RF with no stall', () => {
		const snapshot = analyse(chain)
		expect(snapshot.rows.map((row) => row.cycles)).toEqual([
			[1, 2, 3, 4, 5],
			[2, 3, 4, 5, 6],
			[3, 4, 5, 6, 7],
		])
		expect(snapshot.dataStalls).toBe(0)
		expect(snapshot.cycles).toBe(7)
	})

	// The ADDC/SUBC slide: stalled three times in RF, reading R2 in cycle 6.
	it('stalls three cycles per adjacent dependency without bypassing', () => {
		const snapshot = analyse(chain, { dataHazards: 'none' })
		expect(snapshot.rows.map((row) => row.cycles)).toEqual([
			[1, 2, 3, 4, 5],
			// RF on 3, 4, 5, reads the register file on 6.
			[2, 3, 7, 8, 9],
			// IF holds behind it; then RF waits for R2 written at the end of 9.
			[3, 7, 11, 12, 13],
		])
		expect(snapshot.rows.map((row) => row.stalls)).toEqual([0, 3, 3])
		expect(snapshot.rows[2].blockedOn).toBe(2)
		expect(snapshot.dataStalls).toBe(6)
	})

	it('offers no split-decode, so that setting reads as the first policy', () => {
		expect(analyse(chain, { dataHazards: 'split-decode' }).dataStalls).toBe(0)
	})
})

describe('Beta pipeline: load-use', () => {
	const load = opc(OP_LD, R31, 0, 2)
	const use = opc(OP_SUBC, 2, 1, 3)
	const other = opc(OP_ADDC, R31, 7, 4)

	// LD data is only in the datapath in WB: SUBC sits in RF on 3, 4 and 5.
	it('stalls two cycles even with full bypassing', () => {
		const snapshot = analyse([load, use])
		expect(snapshot.rows[1].cycles).toEqual([2, 3, 6, 7, 8])
		expect(snapshot.rows[1].stalls).toBe(2)
		expect(snapshot.rows[1].cause).toBe('load-use')
		expect(snapshot.loadUseStalls).toBe(2)
		expect(snapshot.dataStalls).toBe(0)
	})

	it('stalls one cycle with one instruction between', () => {
		const snapshot = analyse([load, other, use])
		expect(snapshot.rows[2].cycles).toEqual([3, 4, 6, 7, 8])
		expect(snapshot.loadUseStalls).toBe(1)
	})

	it('does not stall with two between, when LD is in WB as the use is in RF', () => {
		expect(analyse([load, other, other, use]).loadUseStalls).toBe(0)
	})

	it('stalls until cycle 6 without the WB bypass', () => {
		const snapshot = analyse([load, use], { dataHazards: 'none' })
		expect(snapshot.rows[1].cycles).toEqual([2, 3, 7, 8, 9])
		expect(snapshot.rows[1].cause).toBe('data')
	})
})

describe('Beta pipeline: control', () => {
	// ADDC(R31, 1, R1); BNE(R1, back, R31) taken; then the target.
	const set = opc(OP_ADDC, R31, 1, 1)
	const branch = opc(OP_BNE, 1, -2, R31)
	const target = opc(OP_ADDC, R31, 2, 5)

	// Decided in RF on cycle 3 from the bypassed R1; the IF instruction is annulled.
	it('annuls the one instruction fetched behind a taken branch', () => {
		const snapshot = analyse([set, [branch, true], target])
		expect(snapshot.rows[1].cycles).toEqual([2, 3, 4, 5, 6])
		expect(snapshot.rows[1].stalls).toBe(0)
		expect(snapshot.rows[2].cycles).toEqual([4, 5, 6, 7, 8])
		expect(snapshot.rows[2].flushed).toBe(1)
		expect(snapshot.controlFlushes).toBe(1)
	})

	it('annuls one even where the MIPS setting names EX or MEM', () => {
		expect(analyse([set, [branch, true], target], { resolveBranchIn: 'mem' }).controlFlushes).toBe(1)
	})

	it('lets the speculated PC + 4 run on behind a branch not taken', () => {
		const snapshot = analyse([set, [branch, false], target])
		expect(snapshot.rows[2].cycles).toEqual([3, 4, 5, 6, 7])
		expect(snapshot.controlFlushes).toBe(0)
	})

	it('annuls one behind every JMP', () => {
		const snapshot = analyse([op(OP_JMP, 1, 0, R31), target])
		expect(snapshot.rows[1].flushed).toBe(1)
	})

	it('runs no delay slot even on a machine that reports one', () => {
		const model = new PipelineModel({ ...DEFAULT_PIPELINE_SETTINGS })
		model.onConfigure({ delayedBranching: true, instructions: betaInstructionSet })
		model.onInstruction(0, branch, 0)
		model.onBranch(0, true)
		expect(model.snapshot().controlFlushes).toBe(1)
	})
})

describe('pipeline availability', () => {
	it('reports a machine with no pipeline model as unavailable', () => {
		const model = new PipelineModel()
		expect(model.snapshot().available).toBe(true)
		model.onConfigure({ delayedBranching: false, instructions: { ...betaInstructionSet, pipeline: undefined } })
		model.onInstruction(0, opc(OP_ADDC, R31, 1, 1), 0)
		const snapshot = model.snapshot()
		expect(snapshot.available).toBe(false)
		expect(snapshot.rows).toHaveLength(0)
	})
})
