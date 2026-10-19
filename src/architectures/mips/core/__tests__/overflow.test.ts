import { describe, expect, it } from 'vitest'
import { build, run, withExit } from './helpers'
import type { MipsSimulator } from '../simulator'

/** Cause register bits 2-6 (`Exceptions.java:78`). */
function causeCode(simulator: MipsSimulator): number {
	return (simulator.cp0Registers[13] >> 2) & 0x1f
}

/**
 * The handler from S1's fixture: marks itself, steps EPC past the faulting
 * instruction and returns (`Exceptions.java:80` records the fault itself).
 */
const HANDLER_SOURCE = `
	.ktext 0x80000180
	li $t9, 7
	mfc0 $k0, $epc
	addi $k0, $k0, 4
	mtc0 $k0, $epc
	eret
`

/** Steps to completion under a budget, so a runaway shows up as a failure. */
function runBounded(simulator: MipsSimulator, budget = 200) {
	let steps = 0
	while (!simulator.halted && steps < budget) {
		simulator.step()
		steps++
	}
	expect(simulator.halted).toBe(true)
}

describe('arithmetic overflow (InstructionSet.java:106-113, :129-136, :152-158)', () => {
	it('raises on add and leaves the destination alone', async () => {
		const simulator = await run(withExit(`li $t0, 0x7fffffff
li $t1, 1
li $t2, 55
add $t2, $t0, $t1`))
		expect(simulator.console).toContain('arithmetic overflow')
		expect(simulator.registers.$t2).toBe(55)
		expect(causeCode(simulator)).toBe(12)
	})

	it('raises on addi and leaves the destination alone', async () => {
		const simulator = await run(withExit(`li $t0, 0x7fffffff
li $t2, 55
addi $t2, $t0, 1`))
		expect(simulator.console).toContain('arithmetic overflow')
		expect(simulator.registers.$t2).toBe(55)
		expect(causeCode(simulator)).toBe(12)
	})

	it('raises on sub and leaves the destination alone', async () => {
		const simulator = await run(withExit(`li $t0, 0x80000000
li $t1, 1
li $t2, 55
sub $t2, $t0, $t1`))
		expect(simulator.console).toContain('arithmetic overflow')
		expect(simulator.registers.$t2).toBe(55)
		expect(causeCode(simulator)).toBe(12)
	})

	it('dispatches an add overflow to a .ktext handler and carries on', () => {
		const simulator = build(`
	.text
main:
	li $t0, 0x7fffffff
	li $t1, 1
	li $t2, 55
	add $t2, $t0, $t1
	li $t3, 1
	li $v0, 10
	syscall
${HANDLER_SOURCE}`)
		runBounded(simulator)
		expect(simulator.registers.$t9).toBe(7)
		expect(simulator.registers.$t2).toBe(55)
		expect(simulator.registers.$t3).toBe(1)
		expect(causeCode(simulator)).toBe(12)
	})

	it('keeps addu, addiu and subu wrapping silently', async () => {
		const simulator = await run(withExit(`li $t0, 0x7fffffff
li $t1, 1
addu $t2, $t0, $t1
addiu $t3, $t0, 1
li $t4, 0x80000000
subu $t5, $t4, $t1`))
		expect(simulator.console).not.toContain('overflow')
		expect(simulator.registers.$t2 | 0).toBe(-2147483648)
		expect(simulator.registers.$t3 | 0).toBe(-2147483648)
		expect(simulator.registers.$t5 | 0).toBe(0x7fffffff)
	})

	it('raises nothing on divide by zero (InstructionSet.java:350-356)', async () => {
		const simulator = await run(withExit(`li $t0, 5
div $t0, $zero
divu $t0, $zero`))
		expect(simulator.console).not.toContain('Error')
		expect(causeCode(simulator)).toBe(0)
		expect(simulator.halted).toBe(true)
	})
})
