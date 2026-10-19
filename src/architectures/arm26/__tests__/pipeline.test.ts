import { describe, expect, it } from 'vitest'
import { DEFAULT_PIPELINE_SETTINGS, PipelineModel, type PipelineSettings } from '../../../tools/pipeline'
import { arm26InstructionSet } from '../instructions'

/**
 * The ARM2's three stages: fetch, decode, execute, one instruction a cycle,
 * registers read and written in execute.  Words are hand-encoded.
 */

/** One instruction run, and for a branch which way it went. */
type Step = number | [word: number, taken: boolean]

function analyse(steps: Step[], settings: Partial<PipelineSettings> = {}) {
	const model = new PipelineModel({ ...DEFAULT_PIPELINE_SETTINGS, windowSize: 64, ...settings })
	model.onConfigure({ delayedBranching: false, instructions: arm26InstructionSet })
	steps.forEach((step, count) => {
		const [word, taken] = typeof step === 'number' ? [step, null] : step
		const address = 0x8000 + count * 4
		model.onInstruction(address, word, count)
		if (taken !== null) model.onBranch(address, taken)
	})
	return model.snapshot()
}

const MOV_R1_1 = 0xE3A01001
const ADD_R2_R1_R1 = 0xE0812001
const ADD_R3_R2_R1 = 0xE0823001
const LDR_R2_R1 = 0xE5912000
const B = 0xEAFFFFFE
const BNE = 0x1AFFFFFE

describe('ARM26 pipeline', () => {
	it('runs dependent instructions back to back', () => {
		const snapshot = analyse([MOV_R1_1, ADD_R2_R1_R1, ADD_R3_R2_R1])
		expect(snapshot.rows.map((row) => row.cycles)).toEqual([[1, 2, 3], [2, 3, 4], [3, 4, 5]])
		expect(snapshot.dataStalls).toBe(0)
		expect(snapshot.cycles).toBe(5)
	})

	it('uses a loaded value on the next instruction without a stall', () => {
		const snapshot = analyse([LDR_R2_R1, ADD_R3_R2_R1])
		expect(snapshot.loadUseStalls + snapshot.dataStalls).toBe(0)
	})

	it('discards the two instructions behind a branch it takes', () => {
		const snapshot = analyse([B, MOV_R1_1])
		expect(snapshot.rows.map((row) => row.cycles)).toEqual([[1, 2, 3], [4, 5, 6]])
		const untaken = analyse([[BNE, false], MOV_R1_1])
		expect(untaken.rows[1].cycles).toEqual([2, 3, 4])
		const taken = analyse([[BNE, true], MOV_R1_1])
		expect(taken.rows[1].cycles).toEqual([4, 5, 6])
	})
})
