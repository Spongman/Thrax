import { describe, expect, it } from 'vitest'
import { JavaRandom } from '../random'
import { BLOCK_SIZE } from '../effectStore'
import { DEFAULT_BACKSTEP_LIMIT } from '../../../../core/settings'
import { build, withExit } from './helpers'
import type { MipsSimulator } from '../simulator'

/**
 * Bug 14: a snapshot restored registers, memory and the console but left the
 * file table, the random streams, the exit code and a pending sleep as the
 * instruction had made them, so replaying a syscall did not reproduce the run.
 */

/** Runs up to the labelled instruction without executing it. */
async function runToLabel(simulator: MipsSimulator, label: string) {
	const address = simulator.program.labels.get(label)
	expect(address, `no label ${label}`).toBeDefined()
	await simulator.runTo(address!)
	expect(simulator.pc).toBe(address)
}

/** The `count` bytes at `address`, read past the observers a load would notify. */
function bytesAt(simulator: MipsSimulator, address: number, count: number): number[] {
	return Array.from({ length: count }, (_unused, index) => simulator.readMemory(address + index, 1))
}

describe('backstepping a file syscall', () => {
	const source = withExit(`
.data
name:	.asciiz "notes.txt"
text:	.asciiz "hello"
buffer:	.space 16
.text
	la $a0, name
	li $a1, 1
	li $v0, 13
	syscall
	move $s0, $v0

	move $a0, $s0
	la $a1, text
	li $a2, 5
	li $v0, 15
	syscall

	move $a0, $s0
	li $v0, 16
	syscall

	la $a0, name
	li $a1, 0
	li $v0, 13
	syscall
	move $s0, $v0

	move $a0, $s0
	la $a1, buffer
	li $a2, 16
	li $v0, 14
readCall:
	syscall
	move $s1, $v0
`)

	it('reads the same bytes again after a step back', async () => {
		const simulator = build(source)
		await runToLabel(simulator, 'readCall')
		const buffer = simulator.program.labels.get('buffer')!

		simulator.step()
		expect(simulator.registers.$v0).toBe(5)
		expect(bytesAt(simulator, buffer, 5)).toEqual([104, 101, 108, 108, 111])

		// Without the file table in the snapshot the descriptor stays at offset
		// 5 and the replayed read comes back empty.
		expect(simulator.stepBack()).toBe(true)
		simulator.step()
		expect(simulator.registers.$v0).toBe(5)
		expect(bytesAt(simulator, buffer, 5)).toEqual([104, 101, 108, 108, 111])
	})

	it('reopens on the same descriptor after a step back over an open', async () => {
		const openOnly = withExit(`
.data
name:	.asciiz "one.txt"
.text
	la $a0, name
	li $a1, 1
	li $v0, 13
openCall:
	syscall
`)
		const simulator = build(openOnly)
		await runToLabel(simulator, 'openCall')

		simulator.step()
		const first = simulator.registers.$v0
		expect(first).toBeGreaterThanOrEqual(3)

		expect(simulator.stepBack()).toBe(true)
		simulator.step()
		expect(simulator.registers.$v0).toBe(first)
	})
})

describe('backstepping a random syscall', () => {
	const source = withExit(`
li $a0, 0
li $a1, 42
li $v0, 40
syscall
li $a0, 0
li $v0, 41
drawCall:
syscall
`)

	it('draws the same value again, so the stream does not advance twice', async () => {
		const expected = new JavaRandom(42).nextInt()
		const simulator = build(source)
		await runToLabel(simulator, 'drawCall')

		simulator.step()
		expect(simulator.registers.$a0).toBe(expected)

		expect(simulator.stepBack()).toBe(true)
		simulator.step()
		expect(simulator.registers.$a0).toBe(expected)
	})

	it('drops a stream created by the instruction being undone', async () => {
		const simulator = build(source)
		await runToLabel(simulator, 'drawCall')
		const before = simulator.random.snapshot()

		simulator.step()
		expect(simulator.stepBack()).toBe(true)
		expect(simulator.random.snapshot()).toEqual(before)
	})
})

describe('backstepping the exit code and a pending sleep', () => {
	it('puts back the exit code syscall 17 set', async () => {
		const simulator = build('li $a0, 3\nli $v0, 17\nexitCall:\nsyscall\n')
		await runToLabel(simulator, 'exitCall')
		expect(simulator.exitCode).toBeNull()

		simulator.step()
		expect(simulator.exitCode).toBe(3)
		expect(simulator.halted).toBe(true)

		expect(simulator.stepBack()).toBe(true)
		expect(simulator.exitCode).toBeNull()
		expect(simulator.halted).toBe(false)
	})

	it('puts back the sleep syscall 32 asked for', async () => {
		const simulator = build(withExit('li $a0, 250\nli $v0, 32\nsleepCall:\nsyscall'))
		await runToLabel(simulator, 'sleepCall')

		simulator.step()
		expect(simulator.pendingSleepMs).toBe(250)

		expect(simulator.stepBack()).toBe(true)
		expect(simulator.pendingSleepMs).toBe(0)
	})
})

describe('history length', () => {
	// `backstepLimit` is 2000 (`Config.properties:7`), where THRAX kept 100.
	const source = withExit('li $t0, 0\nli $t1, 60\nloop:\naddi $t0, $t0, 1\nbne $t0, $t1, loop')

	it('keeps every instruction of a run longer than the old 100-entry limit', async () => {
		const simulator = build(source)
		await simulator.run()
		expect(simulator.halted).toBe(true)
		expect(simulator.instructionCount).toBeGreaterThan(100)
		expect(simulator.getExecutionHistory().length).toBe(simulator.instructionCount)
	})

	it('steps all the way back to the start of such a run', async () => {
		const simulator = build(source)
		await simulator.run()
		expect(simulator.halted).toBe(true)

		let steps = 0
		while (simulator.stepBack()) {
			steps++
			expect(steps).toBeLessThan(1000)
		}
		expect(simulator.instructionCount).toBe(0)
		expect(simulator.registers.$t0).toBe(0)
		expect(simulator.pc).toBe(simulator.entryAddress())
	})

	it('keeps a deep history by default and takes the workspace setting', () => {
		const simulator = build(source)
		expect(simulator.maxHistorySize).toBe(DEFAULT_BACKSTEP_LIMIT)

		// Blocks are given up whole, so the log holds the limit and at most one
		// block more, never less.  It takes a program that does not halt to fill.
		const spinning = build('main:\tli $t0, 0\nloop:\taddi $t0, $t0, 1\n\tj loop\n')
		spinning.maxHistorySize = BLOCK_SIZE
		for (let index = 0; index < BLOCK_SIZE * 3; index++) spinning.step()
		const held = spinning.getExecutionHistory().length
		expect(held).toBeGreaterThanOrEqual(BLOCK_SIZE)
		expect(held).toBeLessThan(BLOCK_SIZE * 2)
	})
})
