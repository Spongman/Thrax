import { describe, expect, it } from 'vitest'
import { build, buildDelayed } from './helpers'
import type { MipsSimulator } from '../simulator'

/** Steps to completion under a budget, so a runaway shows up as a failure. */
function runBounded(simulator: MipsSimulator, budget = 200) {
	let steps = 0
	while (!simulator.halted && steps < budget) {
		simulator.step()
		steps++
	}
	expect(simulator.halted).toBe(true)
}

describe('input in a delay slot (Simulator.java:388-394)', () => {
	const source = `
	.text
main:
	li $v0, 5
	b target
	syscall
	li $t3, 99
target:
	li $t2, 7
	li $v0, 10
	syscall
`

	it('resumes at the branch target, not the sequential instruction', () => {
		const simulator = buildDelayed(source)
		simulator.step()
		simulator.step()
		simulator.step()
		expect(simulator.pendingInput).not.toBe(null)

		expect(simulator.provideInput('42')).toBe(true)
		expect(simulator.pc).toBe(simulator.program.labels.get('target'))

		runBounded(simulator)
		// The word after the delay slot belongs to the not-taken path.
		expect(simulator.registers.$t3).toBe(0)
		expect(simulator.registers.$t2).toBe(7)
	})
})

describe('step over a call (Simulator.java:388-394)', () => {
	const source = `
	.text
main:
	li $t0, 0
call:
	jal fn
	li $t1, 5
after:
	li $t2, 9
	li $v0, 10
	syscall
fn:
	li $t0, 3
	jr $ra
	nop
`

	it('returns past the delay slot when delayed branching is on', async () => {
		const simulator = buildDelayed(source)
		simulator.step()
		await simulator.stepOver()

		expect(simulator.pc).toBe(simulator.program.labels.get('after'))
		expect(simulator.registers.$t0).toBe(3)
		expect(simulator.registers.$t1).toBe(5)
	})

	it('still stops at PC + 4 with delayed branching off', async () => {
		const simulator = build(source)
		simulator.step()
		const callAddress = simulator.pc
		await simulator.stepOver()

		expect(simulator.pc).toBe(callAddress + 4)
		expect(simulator.registers.$t0).toBe(3)
	})
})
