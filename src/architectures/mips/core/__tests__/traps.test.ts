import { describe, expect, it } from 'vitest'
import { build, run } from './helpers'
import type { MipsSimulator } from '../simulator'

/** `Exceptions.java:61`. */
const TRAP = 13

const CAUSE = 13

/**
 * The handler from `exceptions.test.ts`: it marks itself in `$t1`, steps EPC
 * past the faulting instruction and returns, since MARS records the faulting
 * instruction itself (`Exceptions.java:80`).
 */
const HANDLER_SOURCE = `
	.ktext 0x80000180
	li $t1, 7
	mfc0 $k0, $epc
	addi $k0, $k0, 4
	mtc0 $k0, $epc
	eret
`

function causeCode(simulator: MipsSimulator): number {
	return (simulator.cp0Registers[CAUSE] >> 2) & 0x1f
}

/** Steps under a budget, so a trap that never returns fails rather than hangs. */
function runBounded(simulator: MipsSimulator, budget = 200) {
	let steps = 0
	while (!simulator.halted && steps < budget) {
		simulator.step()
		steps++
	}
	expect(simulator.halted).toBe(true)
}

/**
 * `$t0` and `$t1` hold the operands, so one program shape covers all twelve
 * traps (`InstructionSet.java:2829-3045`).
 */
function trapProgram(trap: string): string {
	return `
	.text
main:
	li $t0, 5
	li $t1, 5
	${trap}
	li $v0, 10
	syscall
`
}

describe('the twelve traps', () => {
	// Each entry traps on `$t0` = 5 against `$t1` = 5 or the immediate 5, and
	// its partner does not.
	it.each([
		['teq $t0, $t1', 'tne $t0, $t1'],
		['tge $t0, $t1', 'tlt $t0, $t1'],
		['tgeu $t0, $t1', 'tltu $t0, $t1'],
		['teqi $t0, 5', 'tnei $t0, 5'],
		['tgei $t0, 5', 'tlti $t0, 5'],
		['tgeiu $t0, 5', 'tltiu $t0, 5'],
	])('raises TRAP on %s and not on %s', async (fires, quiet) => {
		// Without a handler the fault ends the run, which `run` reports rather
		// than throwing out of `step`.
		const trapped = await run(trapProgram(fires))
		expect(trapped.halted).toBe(true)
		expect(causeCode(trapped)).toBe(TRAP)
		expect(trapped.console).toContain('trap')

		const passed = await run(trapProgram(quiet))
		expect(passed.halted).toBe(true)
		expect(passed.console).not.toContain('trap')
		expect(passed.cp0Registers[CAUSE]).toBe(0)
	})

	it('compares unsigned where the mnemonic says so', async () => {
		// -1 is below 5 signed and above it unsigned, so only `tltu` stays quiet.
		const source = (trap: string) => `
	.text
main:
	li $t0, -1
	li $t1, 5
	${trap}
	li $v0, 10
	syscall
`
		const signed = await run(source('tlt $t0, $t1'))
		expect(signed.halted).toBe(true)
		expect(causeCode(signed)).toBe(TRAP)

		const unsigned = await run(source('tltu $t0, $t1'))
		expect(unsigned.halted).toBe(true)
		expect(unsigned.cp0Registers[CAUSE]).toBe(0)
	})

	it('enters a .ktext handler and resumes after the trap', () => {
		const simulator = build(`
	.text
main:
	li $t0, 5
	li $t1, 5
	teq $t0, $t1
	li $t2, 3
	li $v0, 10
	syscall
${HANDLER_SOURCE}`)
		runBounded(simulator)
		expect(simulator.registers.$t1).toBe(7)
		expect(simulator.registers.$t2).toBe(3)
		expect(causeCode(simulator)).toBe(TRAP)
		expect(simulator.console).not.toContain('Error')
	})

	it('falls through a trap that does not fire, handler or not', () => {
		const simulator = build(`
	.text
main:
	li $t0, 5
	li $t1, 6
	teq $t0, $t1
	li $t2, 3
	li $v0, 10
	syscall
${HANDLER_SOURCE}`)
		runBounded(simulator)
		expect(simulator.registers.$t1).toBe(6)
		expect(simulator.registers.$t2).toBe(3)
		expect(simulator.cp0Registers[CAUSE]).toBe(0)
	})
})
