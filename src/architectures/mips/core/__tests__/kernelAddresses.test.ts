import { describe, expect, it } from 'vitest'
import { build } from './helpers'

/**
 * Addresses stay unsigned, all the way up the address space.
 *
 * A kernel handler sits at 0x80000180, past the point where a signed 32-bit
 * increment wraps negative.  Every panel keys on an address: the memory window
 * publishes one unsigned, the source gutter compares one against the pc, and
 * the history stores one per entry.  One negative address among them is not an
 * error anywhere, it is simply a value nothing else ever matches, so the
 * feature that depends on it quietly does nothing.
 */

const TRAPPING = `
	.ktext 0x80000180
	addiu $k0, $zero, 1
	addiu $k0, $zero, 2
	eret
	.text
	teq $zero, $zero
	li $v0, 10
	syscall
`

describe('an address in the kernel segment', () => {
	it('is recorded unsigned for every instruction of a handler, not just the first', () => {
		const simulator = build(TRAPPING)
		for (let step = 0; step < 4; step++) simulator.step()

		const entries = simulator.getExecutionHistory()
		const addresses = Array.from({ length: entries.length }, (unused, index) => entries.at(index)!.address)
		// The trap, then the handler.  Only the entry the handler is jumped to was
		// unsigned: the ones after it came from `pc + 4` and wrapped.
		expect(addresses).toContain(0x80000180)
		expect(addresses).toContain(0x80000184)
		expect(addresses.every((address) => address >= 0)).toBe(true)
	})

	it('leaves the program counter unsigned as the handler runs', () => {
		const simulator = build(TRAPPING)
		// The trap, then the handler's first instruction.
		for (let step = 0; step < 2; step++) simulator.step()
		expect(simulator.pc).toBe(0x80000184)
	})
})
