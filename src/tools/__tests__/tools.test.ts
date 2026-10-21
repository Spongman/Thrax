import { Op, opFor } from '../../architectures/mips/core/ops'
import { describe, expect, it } from 'vitest'
import { BranchHistoryTable } from '../branchHistory'
import { CacheSimulator } from '../cache'
import { DEFAULT_PIPELINE_SETTINGS, PipelineModel } from '../pipeline'
import { ExecutionProfile, HEAT_LEVELS, heatLevel } from '../profile'
import { InstructionStatistics } from '../statistics'
import { InstructionCategory } from '../../architectures/contracts'
import { categoryOf as mipsCategoryOf } from '../../architectures/mips/instructions'
import { build, toolMachine, withExit } from '../../architectures/mips/core/__tests__/helpers'

/** The snapshot key a category is counted under. */
const KEYS = Object.fromEntries(Object.entries(InstructionCategory).map(([name, category]) => [category, name.toLowerCase()]))
const categoryOf = (op: number) => KEYS[mipsCategoryOf(op)]

describe('instruction statistics', () => {
	it('sorts every executed instruction into one category', async () => {
		const simulator = build(withExit('li $t0, 1\nlw $t1, 0($sp)\nsw $t1, 4($sp)\nj next\nnext:\nbeq $t0, $t0, done\ndone:'))
		const statistics = new InstructionStatistics()
		statistics.onConfigure(toolMachine())
		simulator.observers.push(statistics)
		await simulator.run()

		const snapshot = statistics.snapshot()
		const summed = Object.values(snapshot.byCategory).reduce((total, count) => total + count, 0)
		expect(summed).toBe(snapshot.total)
		expect(snapshot.total).toBe(simulator.instructionCount)
		expect(snapshot.byCategory.memory).toBe(2)
		expect(snapshot.byCategory.jump).toBe(1)
		expect(snapshot.byCategory.branch).toBe(1)
	})

	it('counts each mnemonic and ranks the commonest first', async () => {
		const simulator = build(withExit('li $t0, 3\nloop:\naddi $t0, $t0, -1\nbne $t0, $zero, loop'))
		const statistics = new InstructionStatistics()
		statistics.onConfigure(toolMachine())
		simulator.observers.push(statistics)
		await simulator.run()

		const counts = new Map(statistics.snapshot().byMnemonic.map((entry) => [entry.op, entry.count]))
		expect(counts.get('addi')).toBe(3)
		expect(counts.get('bne')).toBe(3)
		expect(statistics.snapshot().byMnemonic[0].count).toBeGreaterThanOrEqual(3)
	})

	it('files coprocessor work under its own category', () => {
		expect(categoryOf(Op.ADD_S)).toBe('coprocessor')
		expect(categoryOf(Op.MFC1)).toBe('coprocessor')
		expect(categoryOf(Op.ADD)).toBe('alu')
		expect(categoryOf(Op.SYSCALL)).toBe('other')
	})

	it('files the unaligned and atomic accesses under memory', () => {
		for (const op of ['LWL', 'LWR', 'SWL', 'SWR', 'LL', 'SC']) {
			expect(categoryOf(opFor(op)!)).toBe('memory')
		}
	})

	// P1: the 30 instructions added by A5/A6 were unknown to categoryOf and all fell
	// through to 'other' (or, for the MOV family, were accidentally swept into
	// 'coprocessor' by the 'MOV' prefix check).
	it('files branch-and-link with the other branches', () => {
		expect(categoryOf(Op.BGEZAL)).toBe('branch')
		expect(categoryOf(Op.BLTZAL)).toBe('branch')
	})

	it('files bit-counting and multiply-accumulate as ALU work', () => {
		for (const op of ['CLO', 'CLZ', 'MADD', 'MADDU', 'MSUB', 'MSUBU']) {
			expect(categoryOf(opFor(op)!)).toBe('alu')
		}
	})

	it('splits conditional moves by which register file they write', () => {
		// GPR-to-GPR: no FPU or CP0 involved, so ALU, not coprocessor.
		expect(categoryOf(Op.MOVN)).toBe('alu')
		expect(categoryOf(Op.MOVZ)).toBe('alu')
		// FP-register moves, gated on either a GPR or an FP condition code.
		for (const op of ['MOVN.S', 'MOVN.D', 'MOVZ.S', 'MOVZ.D', 'MOVF.S', 'MOVF.D', 'MOVT.S', 'MOVT.D']) {
			expect(categoryOf(opFor(op)!)).toBe('coprocessor')
		}
	})

	it('gives the twelve traps their own category', () => {
		const traps = ['TEQ', 'TEQI', 'TGE', 'TGEU', 'TGEI', 'TGEIU', 'TLT', 'TLTU', 'TLTI', 'TLTIU', 'TNE', 'TNEI']
		for (const op of traps) expect(categoryOf(opFor(op)!)).toBe('trap')
	})
})

describe('cache simulator', () => {
	it('misses once per block, then hits within it', () => {
		const cache = new CacheSimulator({ blockCount: 4, blockSizeBytes: 16, associativity: 1, replacement: 'lru' })
		for (let offset = 0; offset < 16; offset += 4) cache.access(0x10010000 + offset)

		const snapshot = cache.snapshot()
		expect(snapshot.accesses).toBe(4)
		expect(snapshot.misses).toBe(1)
		expect(snapshot.hits).toBe(3)
		expect(snapshot.hitRate).toBeCloseTo(0.75)
	})

	it('thrashes when two addresses collide in a direct-mapped set', () => {
		const cache = new CacheSimulator({ blockCount: 2, blockSizeBytes: 16, associativity: 1, replacement: 'lru' })
		// 0x000 and 0x020 are two blocks apart, so both land in set 0.
		for (let round = 0; round < 4; round++) {
			cache.access(0x10010000)
			cache.access(0x10010020)
		}
		expect(cache.snapshot().hits).toBe(0)
	})

	it('holds both lines once the same set is two-way associative', () => {
		const cache = new CacheSimulator({ blockCount: 2, blockSizeBytes: 16, associativity: 2, replacement: 'lru' })
		for (let round = 0; round < 4; round++) {
			cache.access(0x10010000)
			cache.access(0x10010020)
		}
		expect(cache.snapshot().hits).toBe(6)
	})

	it('counts the accesses a running program makes', async () => {
		const simulator = build(withExit('li $t0, 1\nsw $t0, 0($sp)\nlw $t1, 0($sp)\nlw $t2, 0($sp)'))
		const cache = new CacheSimulator()
		simulator.observers.push(cache)
		await simulator.run()

		const snapshot = cache.snapshot()
		expect(snapshot.accesses).toBe(3)
		expect(snapshot.misses).toBe(1)
	})
})

describe('branch history table', () => {
	it('predicts a loop correctly except at its edges', async () => {
		const simulator = build(withExit('li $t0, 10\nloop:\naddi $t0, $t0, -1\nbne $t0, $zero, loop'))
		const table = new BranchHistoryTable({ entryCount: 8, historyBits: 2, initiallyTaken: false })
		table.onConfigure(toolMachine())
		simulator.observers.push(table)
		await simulator.run()

		const snapshot = table.snapshot()
		expect(snapshot.predictions).toBe(10)
		// Two-bit counter: wrong for the first two, right until the exit misses.
		expect(snapshot.correct).toBe(7)
		expect(snapshot.accuracy).toBeCloseTo(0.7)
	})

	it('changes its mind at once with a one-bit counter', async () => {
		const simulator = build(withExit('li $t0, 10\nloop:\naddi $t0, $t0, -1\nbne $t0, $zero, loop'))
		const table = new BranchHistoryTable({ entryCount: 8, historyBits: 1, initiallyTaken: false })
		table.onConfigure(toolMachine())
		simulator.observers.push(table)
		await simulator.run()

		// One bit is wrong only on the first taken branch and the final exit.
		expect(table.snapshot().correct).toBe(8)
	})

	it('starts from the configured prediction', async () => {
		const simulator = build(withExit('li $t0, 10\nloop:\naddi $t0, $t0, -1\nbne $t0, $zero, loop'))
		const table = new BranchHistoryTable({ entryCount: 8, historyBits: 2, initiallyTaken: true })
		table.onConfigure(toolMachine())
		simulator.observers.push(table)
		await simulator.run()

		// Predicting taken from the start costs only the loop exit.
		expect(table.snapshot().correct).toBe(9)
	})

	it('records which branches share an entry', async () => {
		const simulator = build(withExit('li $t0, 1\nbeq $t0, $t0, next\nnext:\nbne $t0, $zero, done\ndone:'))
		const table = new BranchHistoryTable({ entryCount: 4, historyBits: 2, initiallyTaken: false })
		table.onConfigure(toolMachine())
		simulator.observers.push(table)
		await simulator.run()

		const used = table.snapshot().entries.filter((entry) => entry.predictions > 0)
		expect(used).toHaveLength(2)
		expect(used.every((entry) => entry.addresses.length === 1)).toBe(true)
	})
})

describe('execution profile', () => {
	it('counts every execution of each address and finds the hottest', async () => {
		const simulator = build(withExit('li $t0, 3\nloop:\naddi $t0, $t0, -1\nbne $t0, $zero, loop'))
		const profile = new ExecutionProfile()
		simulator.observers.push(profile)
		await simulator.run()

		const snapshot = profile.snapshot()
		expect(snapshot.total).toBe(simulator.instructionCount)
		const counts = [...snapshot.byAddress.values()].map((entry) => entry.count)
		expect(counts.reduce((total, count) => total + count, 0)).toBe(snapshot.total)
		expect(snapshot.max).toBe(3)

		// The branch runs three times and falls through only on the last.
		const branch = [...snapshot.byAddress.values()].find((entry) => entry.taken + entry.notTaken > 0)
		expect(branch).toEqual({ count: 3, taken: 2, notTaken: 1 })
	})

	it('scales heat logarithmically, with the hottest instruction at the top', () => {
		expect(heatLevel(0, 1000)).toBe(-1)
		expect(heatLevel(1000, 1000)).toBe(HEAT_LEVELS - 1)
		expect(heatLevel(1, 1000)).toBe(0)
		// A tenth of the peak still reads warm, which a linear scale would not.
		expect(heatLevel(100, 1000)).toBe(4)
	})
})

describe('pipeline profile', () => {
	it('attributes stalls and mispredictions to the instruction that caused them', async () => {
		const simulator = build(withExit('li $t0, 2\nloop:\naddi $t0, $t0, -1\nbne $t0, $zero, loop'))
		const pipeline = new PipelineModel({ ...DEFAULT_PIPELINE_SETTINGS, dataHazards: 'none' })
		pipeline.onConfigure(toolMachine())
		simulator.observers.push(pipeline)
		await simulator.run()

		const snapshot = pipeline.snapshot()
		const addi = snapshot.rows.find((row) => row.op === 'addi' && row.stalls > 0)
		expect(addi).toBeDefined()
		const stats = snapshot.byAddress.get(addi!.address)
		expect(stats?.stalls).toBeGreaterThan(0)

		const branch = snapshot.rows.find((row) => row.op === 'bne')
		const branchStats = snapshot.byAddress.get(branch!.address)
		expect(branchStats?.branches).toBe(2)
		// With no predictor the front end falls through, so a taken branch is a miss.
		expect(branchStats?.mispredictions).toBe(1)
	})
})
