import { describe, expect, it } from 'vitest'
import { decode } from '../../architectures/mips/core/decoder'
import { PipelineModel, type PipelineSettings } from '../pipeline'
import { registerEffects } from '../../architectures/mips/instructions'
import { build, toolMachine, withExit, words } from '../../architectures/mips/core/__tests__/helpers'

const SETTINGS: PipelineSettings = {
	dataHazards: 'forwarding',
	resolveBranchIn: 'ex',
	resolveJumpIn: 'id',
	prediction: 'none',
	windowSize: 64,
}

/** Runs a program and returns what the pipeline overlay made of it. */
async function analyse(body: string, settings: Partial<PipelineSettings> = {}, delaySlots = false) {
	const simulator = build(withExit(body))
	const model = new PipelineModel({ ...SETTINGS, ...settings })
	model.onConfigure(toolMachine({ delayedBranching: delaySlots }))
	simulator.observers.push(model)
	await simulator.run()
	return model.snapshot()
}

const effectsOf = (source: string) => registerEffects(decode(words(source)[0])!)

describe('register effects', () => {
	it('reads the sources and writes the destination of an R-type', () => {
		const effects = effectsOf('add $t0, $t1, $t2')
		expect(effects.reads).toEqual([9, 10])
		expect(effects.writes).toBe(8)
	})

	it('treats a load as writing rt and a store as reading it', () => {
		const load = effectsOf('lw $t0, 0($sp)')
		expect(load.reads).toEqual([29])
		expect(load.writes).toBe(8)
		expect(load.isLoad).toBe(true)

		const store = effectsOf('sw $t0, 0($sp)')
		expect(store.reads).toEqual([29, 8])
		expect(store.writes).toBe(-1)
		expect(store.isLoad).toBe(false)
	})

	it('ignores $zero, which never carries a dependency', () => {
		expect(effectsOf('add $zero, $t1, $zero').writes).toBe(-1)
		expect(effectsOf('addi $t0, $zero, 1').reads).toEqual([])
	})

	it('knows jal writes $ra and jr reads its target', () => {
		expect(effectsOf('here: jal here').writes).toBe(31)
		expect(effectsOf('jr $ra').reads).toEqual([31])
		expect(effectsOf('jr $ra').isJump).toBe(true)
	})

	it('marks conditional branches as branches, not jumps', () => {
		const branch = effectsOf('here: beq $t0, $t1, here')
		expect(branch.isBranch).toBe(true)
		expect(branch.isJump).toBe(false)
	})

	// P1: bc1t/bc1f with an explicit condition code is shape 'cc,branch', which the
	// isBranch check did not list, so the branch-prediction visualization silently
	// under-counted it (InstructionSet.java:1986).
	it('counts bc1t with a condition code as a branch', () => {
		const branch = effectsOf('here: bc1t 3,here')
		expect(branch.isBranch).toBe(true)
		expect(branch.reads).toEqual([])
	})

	// The twelve traps (rs,imm) had no case at all, so a hazard on their register
	// operand went undetected (InstructionSet.java:2846 teqi).
	it('reads a trap immediate form\'s register operand', () => {
		expect(effectsOf('teqi $t0, -100').reads).toEqual([8])
		expect(effectsOf('tgeiu $t1, -1').reads).toEqual([9])
	})

	// movz.s/movn.s (fd,fs,rt) read the GPR condition; the FP source and destination
	// are not tracked here (only the integer file is modelled).
	it('reads the GPR condition of an FP conditional move and writes nothing GPR', () => {
		const move = effectsOf('movz.s $f0,$f1,$t3')
		expect(move.reads).toEqual([11])
		expect(move.writes).toBe(-1)
	})

	// bgezal/bltzal write $ra like jal, in addition to reading rs (InstructionSet.java:909-924).
	it('knows bgezal and bltzal write $ra', () => {
		expect(effectsOf('here: bgezal $t0, here').writes).toBe(31)
		expect(effectsOf('here: bltzal $t0, here').writes).toBe(31)
		expect(effectsOf('here: bgezal $t0, here').isBranch).toBe(true)
	})

	// movf/movt with an explicit condition code (rd,rs,cc) had no case, so the
	// dependency between rs and rd went untracked.
	it('tracks the register traffic of movf/movt with an explicit condition code', () => {
		const move = effectsOf('movf $t0, $t1, 1')
		expect(move.reads).toEqual([9])
		expect(move.writes).toBe(8)
	})
})

describe('ideal pipeline', () => {
	it('takes one cycle per instruction plus four to fill', async () => {
		// Five independent writes, then the two-instruction exit.
		const snapshot = await analyse('li $t0, 1\nli $t1, 2\nli $t2, 3\nli $t3, 4\nli $t4, 5')
		expect(snapshot.instructions).toBe(7)
		expect(snapshot.cycles).toBe(snapshot.instructions + 4)
		expect(snapshot.dataStalls).toBe(0)
		expect(snapshot.loadUseStalls).toBe(0)
		expect(snapshot.cpi).toBeCloseTo(11 / 7)
	})

	it('walks each instruction through the five stages one cycle apart', async () => {
		const snapshot = await analyse('li $t0, 1\nli $t1, 2')
		expect(snapshot.rows[0].cycles).toEqual([1, 2, 3, 4, 5])
		expect(snapshot.rows[1].cycles).toEqual([2, 3, 4, 5, 6])
	})
})

describe('data hazards', () => {
	it('forwards an ALU result with no stall', async () => {
		const snapshot = await analyse('li $t0, 1\nadd $t1, $t0, $t0\nadd $t2, $t1, $t1')
		expect(snapshot.dataStalls).toBe(0)
		expect(snapshot.loadUseStalls).toBe(0)
	})

	// Table III of the TALE 2019 paper: 0, 2, or 3 bubbles by countermeasure.
	it('costs two stalls when only decode and write-back overlap', async () => {
		const snapshot = await analyse('li $t0, 1\nadd $t1, $t0, $t0\nadd $t2, $t1, $t1', { dataHazards: 'split-decode' })
		// Each of the three dependent pairs waits for write-back.
		expect(snapshot.dataStalls).toBe(6)
		expect(snapshot.rows[1].stalls).toBe(2)
		expect(snapshot.rows[2].stalls).toBe(2)
	})

	it('costs three with no countermeasure at all', async () => {
		const snapshot = await analyse('li $t0, 1\nadd $t1, $t0, $t0\nadd $t2, $t1, $t1', { dataHazards: 'none' })
		expect(snapshot.rows[1].stalls).toBe(3)
		expect(snapshot.rows[2].stalls).toBe(3)
		expect(snapshot.dataStalls).toBe(9)
	})

	it('stalls once on a load-use hazard even with forwarding', async () => {
		const snapshot = await analyse('sw $zero, 0($sp)\nlw $t0, 0($sp)\nadd $t1, $t0, $t0')
		expect(snapshot.loadUseStalls).toBe(1)
		expect(snapshot.dataStalls).toBe(0)
		const consumer = snapshot.rows[2]
		expect(consumer.stalls).toBe(1)
		expect(consumer.cause).toBe('load-use')
		expect(consumer.blockedOn).toBe(8)
	})

	it('does not stall when a load result is used one instruction later', async () => {
		const snapshot = await analyse('sw $zero, 0($sp)\nlw $t0, 0($sp)\nli $t2, 9\nadd $t1, $t0, $t0')
		expect(snapshot.loadUseStalls).toBe(0)
		expect(snapshot.dataStalls).toBe(0)
	})
})

describe('control hazards', () => {
	it('charges nothing for a branch that falls through', async () => {
		const snapshot = await analyse('li $t0, 1\nbeq $t0, $zero, skip\nli $t1, 2\nskip:')
		expect(snapshot.controlFlushes).toBe(0)
	})

	it('flushes two instructions for a taken branch resolved in EX', async () => {
		const snapshot = await analyse('li $t0, 1\nbeq $t0, $t0, skip\nli $t1, 2\nskip:')
		expect(snapshot.controlFlushes).toBe(2)
	})

	it('flushes one when the branch resolves in ID', async () => {
		const snapshot = await analyse('li $t0, 1\nbeq $t0, $t0, skip\nli $t1, 2\nskip:', { resolveBranchIn: 'id' })
		expect(snapshot.controlFlushes).toBe(1)
	})

	it('flushes three when the branch resolves in MEM', async () => {
		const snapshot = await analyse('li $t0, 1\nbeq $t0, $t0, skip\nli $t1, 2\nskip:', { resolveBranchIn: 'mem' })
		expect(snapshot.controlFlushes).toBe(3)
	})

	// A jump needs no comparison, so it resolves a stage before a branch can.
	it('charges an unconditional jump the jump penalty, not the branch one', async () => {
		const snapshot = await analyse('j next\nnext:\nj after\nafter:')
		expect(snapshot.controlFlushes).toBe(2)
	})

	it('charges more when the jump resolves in EX instead', async () => {
		const snapshot = await analyse('j next\nnext:\nj after\nafter:', { resolveJumpIn: 'ex' })
		expect(snapshot.controlFlushes).toBe(4)
	})

	it('charges nothing for a delay slot, which the machine runs anyway', async () => {
		const taken = 'li $t0, 1\nbeq $t0, $t0, skip\nli $t1, 2\nskip:'
		expect((await analyse(taken, {}, true)).controlFlushes).toBe(1)
		expect((await analyse(taken, { resolveBranchIn: 'id' }, true)).controlFlushes).toBe(0)
	})
})

describe('branch prediction', () => {
	// bne runs five times: taken four times, then not taken on the way out.
	const loop = 'li $t0, 5\nloop:\naddi $t0, $t0, -1\nbne $t0, $zero, loop'

	it('pays for every taken branch when nothing predicts', async () => {
		const snapshot = await analyse(loop)
		expect(snapshot.predictions).toBe(0)
		expect(snapshot.controlFlushes).toBe(8)
	})

	it('pays only for the wrong guess with a static predictor', async () => {
		const snapshot = await analyse(loop, { prediction: 'taken' })
		expect(snapshot.predictions).toBe(5)
		expect(snapshot.mispredictions).toBe(1)
		expect(snapshot.controlFlushes).toBe(2)
	})

	it('is wrong twice with one bit of history: entering and leaving', async () => {
		const snapshot = await analyse(loop, { prediction: 'one-bit' })
		expect(snapshot.predictions).toBe(5)
		expect(snapshot.mispredictions).toBe(2)
	})

	it('takes an extra iteration to swing a two-bit counter round', async () => {
		const snapshot = await analyse(loop, { prediction: 'two-bit' })
		expect(snapshot.mispredictions).toBe(3)
	})

	it('marks the row a prediction missed', async () => {
		const snapshot = await analyse('li $t0, 1\nbeq $t0, $t0, skip\nli $t1, 2\nskip:', { prediction: 'not-taken' })
		const branch = snapshot.rows.find((row) => row.op === 'beq')!
		expect(branch.predicted).toBe(false)
		expect(branch.mispredicted).toBe(true)
	})

	it('delays the fetch of whatever follows the redirect', async () => {
		const snapshot = await analyse('li $t0, 1\nbeq $t0, $t0, skip\nli $t1, 2\nskip:\nli $t2, 3')
		const branchRow = snapshot.rows.findIndex((row) => row.op === 'beq')
		// The instruction after the taken branch is fetched two cycles late.
		expect(snapshot.rows[branchRow + 1].flushed).toBe(2)
		expect(snapshot.rows[branchRow + 1].cycles[0] - snapshot.rows[branchRow].cycles[0]).toBe(3)
	})
})

describe('whole programs', () => {
	it('reports a steady-state CPI of one when nothing stalls', async () => {
		const snapshot = await analyse('li $t0, 1\nli $t1, 2\nli $t2, 3\nli $t3, 4\nli $t4, 5')
		expect(snapshot.cpi).toBeGreaterThan(1)
		expect(snapshot.steadyStateCpi).toBeCloseTo(1)
	})

	it('reports a CPI above one for a loop that both branches and depends', async () => {
		const snapshot = await analyse('li $t0, 5\nloop:\naddi $t0, $t0, -1\nbne $t0, $zero, loop')
		expect(snapshot.cpi).toBeGreaterThan(1)
		expect(snapshot.controlFlushes).toBeGreaterThan(0)
		expect(snapshot.cycles).toBeGreaterThan(snapshot.idealCycles)
	})

	it('keeps only the configured window of rows but counts everything', async () => {
		const snapshot = await analyse('li $t0, 40\nloop:\naddi $t0, $t0, -1\nbne $t0, $zero, loop', { windowSize: 8 })
		expect(snapshot.rows).toHaveLength(8)
		expect(snapshot.instructions).toBeGreaterThan(60)
		expect(snapshot.rows[0].cycles[0]).toBe(snapshot.firstCycle)
	})

	it('never lets two instructions execute in the same cycle', async () => {
		const snapshot = await analyse('li $t0, 3\nloop:\nlw $t1, 0($sp)\naddi $t0, $t0, -1\nbne $t0, $zero, loop')
		const exCycles = snapshot.rows.map((row) => row.cycles[2])
		expect(new Set(exCycles).size).toBe(exCycles.length)
		for (let i = 1; i < exCycles.length; i++) expect(exCycles[i]).toBeGreaterThan(exCycles[i - 1])
	})

	it('orders the stages of every row', async () => {
		const snapshot = await analyse('li $t0, 3\nloop:\nlw $t1, 0($sp)\nadd $t2, $t1, $t1\naddi $t0, $t0, -1\nbne $t0, $zero, loop')
		for (const row of snapshot.rows) {
			for (let stage = 1; stage < row.cycles.length; stage++) {
				expect(row.cycles[stage]).toBeGreaterThan(row.cycles[stage - 1])
			}
		}
	})
})
