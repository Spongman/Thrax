import { describe, expect, it } from 'vitest'
import { build } from './helpers'
import type { MipsSimulator } from '../simulator'

/** The `.ktext` entry point MARS dispatches to (`Memory.exceptionHandlerAddress`). */
const HANDLER = 0x80000180

const CAUSE = 13
const EPC = 14
const STATUS = 12

/**
 * A handler that marks itself in `$t1`, steps EPC past the faulting instruction
 * and returns.  Without the bump `eret` would re-run the fault forever, since
 * MARS records the faulting instruction itself (`Exceptions.java:80`).
 */
const HANDLER_SOURCE = `
	.ktext 0x80000180
	li $t1, 7
	mfc0 $k0, $epc
	addi $k0, $k0, 4
	mtc0 $k0, $epc
	eret
`

/** Cause register bits 2-6 (`Exceptions.java:78`). */
function causeCode(simulator: MipsSimulator): number {
	return (simulator.cp0Registers[CAUSE] >> 2) & 0x1f
}

/**
 * Steps to completion under an instruction budget, so a handler that fails to
 * return shows up as a failed assertion rather than a hung test run.
 */
function runBounded(simulator: MipsSimulator, budget = 200) {
	let steps = 0
	while (!simulator.halted && steps < budget) {
		simulator.step()
		steps++
	}
	expect(simulator.halted).toBe(true)
}

describe('exception dispatch', () => {
	it('enters a .ktext handler for an unsupported syscall and returns to .text', () => {
		const simulator = build(`
	.text
main:
	li $v0, 99
fault:
	syscall
	li $t0, 1
	li $v0, 10
	syscall
${HANDLER_SOURCE}`)
		const faultAddress = simulator.program.labels.get('fault')

		simulator.step()
		simulator.step()

		expect(simulator.pc).toBe(HANDLER)
		expect(simulator.cp0Registers[EPC]).toBe(faultAddress)
		expect(causeCode(simulator)).toBe(8)
		expect(simulator.cp0Registers[STATUS] & 0x2).toBe(0x2)

		runBounded(simulator)
		// The handler ran, EPC moved past the syscall, and .text carried on.
		expect(simulator.registers.$t1).toBe(7)
		expect(simulator.registers.$t0).toBe(1)
		expect(simulator.cp0Registers[EPC]).toBe((faultAddress ?? 0) + 4)
		expect(simulator.cp0Registers[STATUS] & 0x2).toBe(0)
	})

	it('enters the handler for an undecodable instruction', () => {
		const simulator = build(`
	.text
main:
	li $t0, 0
bad:
	nop
	li $t0, 1
	li $v0, 10
	syscall
${HANDLER_SOURCE}`)
		const badAddress = simulator.program.labels.get('bad') ?? 0
		simulator.writeMemoryRaw(badAddress, 0xffffffff, 4)

		runBounded(simulator)
		expect(simulator.registers.$t1).toBe(7)
		expect(simulator.registers.$t0).toBe(1)
		expect(causeCode(simulator)).toBe(10)
		expect(simulator.console).not.toContain('Undecodable instruction')
	})

	it('enters the handler for break', () => {
		const simulator = build(`
	.text
main:
	break
	li $t0, 1
	li $v0, 10
	syscall
${HANDLER_SOURCE}`)

		runBounded(simulator)
		expect(simulator.registers.$t1).toBe(7)
		expect(simulator.registers.$t0).toBe(1)
		expect(causeCode(simulator)).toBe(9)
		expect(simulator.console).not.toContain('break instruction executed')
	})

	it('does not write the destination of the aborted instruction', () => {
		const simulator = build(`
	.text
main:
	li $v0, 99
	li $t0, 5
	syscall
	li $v0, 10
	syscall
${HANDLER_SOURCE}`)

		runBounded(simulator)
		// `syscall` writes nothing, so $t0 keeps the value set before the fault
		// and $t1 proves the handler, not the fall-through, produced it.
		expect(simulator.registers.$t0).toBe(5)
		expect(simulator.registers.$t1).toBe(7)
	})

	it('halts with the fault message when the program defines no handler', async () => {
		const simulator = build(`
	.text
main:
	li $v0, 99
	syscall
	li $t0, 1
	li $v0, 10
	syscall
`)
		await simulator.run()

		expect(simulator.halted).toBe(true)
		expect(simulator.console).toContain('Unsupported syscall: 99')
		// The fault was still recorded, even with nowhere to dispatch it.
		expect(causeCode(simulator)).toBe(8)
		expect(simulator.registers.$t0).toBe(0)
	})
})
