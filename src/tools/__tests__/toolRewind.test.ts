import { describe, expect, it } from 'vitest'
import { Assembler } from '../../core/assembler'
import { firstError } from '../../core/diagnostics'
import type { MachineConfig } from '../../core/observer'
import { MipsSimulator } from '../../core/simulator'
import { BranchHistoryTable } from '../branchHistory'
import { CacheSimulator } from '../cache'
import { PipelineModel } from '../pipeline'
import { ExecutionProfile } from '../profile'
import { MemoryReferenceVisualizer } from '../memoryReference'
import { InstructionStatistics } from '../statistics'

/** Loops, branches and touches memory, so every tool has something to count. */
const PROGRAM = `
	.data
buffer:	.space 256
	.text
main:	li $t0, 20
	la $t1, buffer
loop:	sw $t0, 0($t1)
	lw $t2, 0($t1)
	addi $t1, $t1, 4
	addi $t0, $t0, -1
	bgtz $t0, loop
	li $v0, 10
	syscall
`

/** The same shape of work, but long enough to step back a long way through. */
const LONG_PROGRAM = PROGRAM.replace('li $t0, 20', 'li $t0, 1500')

function build(source = PROGRAM) {
	const { program, machineCode, diagnostics } = new Assembler(source).assemble()
	expect(firstError(diagnostics)?.message).toBeUndefined()
	const simulator = new MipsSimulator(machineCode, program)
	const tools = {
		statistics: new InstructionStatistics(),
		cache: new CacheSimulator(),
		branches: new BranchHistoryTable(),
		pipeline: new PipelineModel(),
		profile: new ExecutionProfile(),
		memoryReference: new MemoryReferenceVisualizer(),
	}
	// What the registry tells a tool as it attaches: the pipeline rewinds by
	// replaying the machine's log, so it has to be given one.
	for (const tool of Object.values(tools)) {
		(tool as { onConfigure?: (machine: MachineConfig) => void }).onConfigure?.({
			delayedBranching: false,
			history: simulator.executionHistory,
		})
	}
	simulator.observers.push(...Object.values(tools))
	return { simulator, tools }
}

const views = (tools: ReturnType<typeof build>['tools']) => ({
	statistics: tools.statistics.snapshot(),
	cache: tools.cache.snapshot(),
	branches: tools.branches.snapshot(),
	pipeline: tools.pipeline.snapshot(),
	profile: tools.profile.snapshot(),
	memoryReference: tools.memoryReference.snapshot(),
})

function stepTo(simulator: MipsSimulator, count: number) {
	while (simulator.instructionCount < count && !simulator.halted) simulator.step()
}

describe('the tools roll back with the machine', () => {
	it('shows the same numbers after a rewind and a replay', () => {
		const { simulator, tools } = build()

		stepTo(simulator, 100)
		const atHundred = views(tools)
		expect(atHundred.statistics.total).toBe(100)
		expect(atHundred.cache.accesses).toBeGreaterThan(0)
		expect(atHundred.branches.predictions).toBeGreaterThan(0)

		while (simulator.instructionCount > 50) simulator.stepBack()
		const atFifty = views(tools)
		// Counted forward only, these would still read 100.
		expect(atFifty.statistics.total).toBe(50)
		expect(atFifty.cache.accesses).toBeLessThan(atHundred.cache.accesses)
		expect(atFifty.branches.predictions).toBeLessThan(atHundred.branches.predictions)

		stepTo(simulator, 100)
		expect(views(tools)).toEqual(atHundred)
	})

	it('comes back to the same numbers over several passes', () => {
		const { simulator, tools } = build()
		stepTo(simulator, 80)
		const settled = views(tools)

		for (let pass = 0; pass < 3; pass++) {
			while (simulator.stepBack()) { /* to the start */ }
			const start = views(tools)
			expect(start.statistics.total).toBe(0)
			// All the way back is empty, not merely zeroed: the profile keeps one
			// record per instruction naming the address it touched, so undoing the
			// first visit to an address has to take the address away again.
			expect(start.profile.byAddress.size).toBe(0)
			expect(start.profile.total).toBe(0)
			expect(start.profile.max).toBe(0)
			stepTo(simulator, 80)
			expect(views(tools)).toEqual(settled)
		}
	})

	/**
	 * The tools kept one copy of themselves per step and could only go back over
	 * the last two thousand of them.  Past that the panels showed a part of the
	 * run the machine had long left, and said nothing about it.
	 */
	it('is exact after a rewind of thousands of instructions', () => {
		const straight = build(LONG_PROGRAM)
		stepTo(straight.simulator, 200)
		const atTwoHundred = views(straight.tools)

		const long = build(LONG_PROGRAM)
		stepTo(long.simulator, 6000)
		expect(long.simulator.instructionCount).toBeGreaterThan(5000)
		while (long.simulator.instructionCount > 200) long.simulator.stepBack()

		expect(long.simulator.instructionCount).toBe(200)
		expect(views(long.tools)).toEqual(atTwoHundred)
	})

	it('keeps a cache hit rate that counts each access once', () => {
		const { simulator, tools } = build()
		stepTo(simulator, 60)
		const { accesses, hits } = tools.cache.snapshot()

		while (simulator.instructionCount > 30) simulator.stepBack()
		stepTo(simulator, 60)

		const after = tools.cache.snapshot()
		expect(after.accesses).toBe(accesses)
		expect(after.hits).toBe(hits)
	})
})
