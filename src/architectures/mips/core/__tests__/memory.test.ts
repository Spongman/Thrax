import { describe, expect, it } from 'vitest'
import { build, withExit } from './helpers'
import type { MipsSimulator } from '../simulator'

const CAUSE = 13
const VADDR = 8

/** Cause register bits 2-6 (`Exceptions.java:78`). */
function causeCode(simulator: MipsSimulator): number {
	return (simulator.cp0Registers[CAUSE] >> 2) & 0x1f
}

/** The faulting address MARS records in vaddr, CP0 register 8 (`Exceptions.java:96`). */
function badAddress(simulator: MipsSimulator): number {
	return simulator.cp0Registers[VADDR] >>> 0
}

/**
 * Steps until the program stops or the budget runs out, returning the message
 * of the fault that ended it and the empty string when none did.  The budget
 * turns a program that never stops into a failed assertion, not a hung run.
 */
function runToFault(simulator: MipsSimulator, budget = 200): string {
	for (let steps = 0; steps < budget && !simulator.halted; steps++) {
		try {
			simulator.step()
		} catch (error) {
			return error instanceof Error ? error.message : String(error)
		}
	}
	expect(simulator.halted).toBe(true)
	return ''
}

/** A `.ktext` handler that marks itself, steps EPC past the fault, and returns. */
const HANDLER_SOURCE = `
	.ktext 0x80000180
	li $t1, 7
	mfc0 $k0, $epc
	addi $k0, $k0, 4
	mtc0 $k0, $epc
	eret
`

/** Stores over the word the label sits on, which is inside `.text`. */
const TEXT_WRITE = 'la $t1, here\nhere:\nsw $zero, 0($t1)'

const BUFFER = `.data
buffer: .word 0x03020100, 0x07060504
.text
`

describe('alignment (Memory.java:497-502, :519-523, :823-827, :858-862)', () => {
	it('raises a store address exception for an unaligned sw', () => {
		const simulator = build(withExit('li $t0, 0x11223344\nsw $t0, 1($zero)'))

		expect(runToFault(simulator)).toContain('store address not aligned on word boundary')
		expect(causeCode(simulator)).toBe(5)
		expect(badAddress(simulator)).toBe(1)
	})

	it('raises a load address exception for an unaligned lw', () => {
		const simulator = build(withExit('lw $t0, 1($zero)'))

		expect(runToFault(simulator)).toContain('fetch address not aligned on word boundary')
		expect(causeCode(simulator)).toBe(4)
		expect(badAddress(simulator)).toBe(1)
	})

	it('raises a store address exception for an unaligned sh', () => {
		const simulator = build(withExit(`${BUFFER}la $t3, buffer\nsh $t3, 1($t3)`))

		expect(runToFault(simulator)).toContain('store address not aligned on halfword boundary')
		expect(causeCode(simulator)).toBe(5)
		expect(badAddress(simulator)).toBe(0x10010001)
	})

	it('raises a load address exception for an unaligned lh', () => {
		const simulator = build(withExit(`${BUFFER}la $t3, buffer\nlh $t0, 1($t3)`))

		expect(runToFault(simulator)).toContain('fetch address not aligned on halfword boundary')
		expect(causeCode(simulator)).toBe(4)
		expect(badAddress(simulator)).toBe(0x10010001)
	})

	// Byte accesses have no boundary to be off, so `lwl`, `lwr`, `swl` and `swr`
	// are exempt by construction: MARS checks only the word and halfword forms.
	it('leaves lwl, lwr, swl and swr working at unaligned addresses', () => {
		const simulator = build(withExit(`${BUFFER}la $t3, buffer
lwl $t0, 4($t3)
lwr $t0, 1($t3)
li $t1, 0x11223344
swl $t1, 4($t3)
swr $t1, 1($t3)
lw $t2, 0($t3)`))

		expect(runToFault(simulator)).toBe('')
		expect(simulator.registers.$t0 >>> 0).toBe(0x04030201)
		expect(simulator.registers.$t2 >>> 0).toBe(0x22334400)
	})

	it('leaves single-byte accesses unchecked', () => {
		const simulator = build(withExit(`${BUFFER}la $t3, buffer\nlb $t0, 1($t3)\nsb $t0, 3($t3)`))

		expect(runToFault(simulator)).toBe('')
		expect(simulator.registers.$t0).toBe(1)
	})
})

describe('self-modifying code (Memory.java:377-388, :939-944)', () => {
	it('raises a store address exception on a write into text when it is off', () => {
		const simulator = build(withExit(TEXT_WRITE))
		const here = simulator.program.labels.get('here') ?? 0

		expect(runToFault(simulator)).toContain('Cannot write directly to text segment!')
		expect(causeCode(simulator)).toBe(5)
		expect(badAddress(simulator)).toBe(here)
	})

	it('allows the same write when it is on', () => {
		const simulator = build(withExit(TEXT_WRITE))
		const here = simulator.program.labels.get('here') ?? 0
		simulator.selfModifyingCode = true

		expect(runToFault(simulator)).toBe('')
		expect(simulator.memory.get(here >>> 2)).toBe(0)
	})

	it('raises a load address exception on a fetch outside text when it is off', () => {
		const simulator = build(withExit(`.data
generated: .word 0x03e00008, 0
.text
la $t1, generated
jr $t1`))

		expect(runToFault(simulator)).toContain('fetch address for text segment out of range')
		expect(causeCode(simulator)).toBe(4)
		expect(badAddress(simulator)).toBe(0x10010000)
	})

	it('executes a word in .data when it is on', () => {
		const simulator = build(withExit(`.data
generated: .word 0x03e00008, 0
.text
li $t0, 5
la $t1, generated
jalr $t1
addi $t0, $t0, 1`))
		simulator.selfModifyingCode = true

		expect(runToFault(simulator)).toBe('')
		expect(simulator.registers.$t0).toBe(6)
	})

	// The fetch check is on the address, so an unaligned pc faults even inside
	// text (`Memory.java:930-937`).
	it('raises a load address exception on an unaligned fetch', () => {
		const simulator = build(withExit('la $t1, here\nhere:\naddi $t1, $t1, 1\njr $t1'))
		const here = simulator.program.labels.get('here') ?? 0

		expect(runToFault(simulator)).toContain('fetch address for text segment not aligned to word boundary')
		expect(causeCode(simulator)).toBe(4)
		expect(badAddress(simulator)).toBe(here + 1)
	})
})

describe('address exception dispatch', () => {
	it('enters a .ktext handler and resumes after the faulting store', () => {
		const simulator = build(`
	.text
main:
	li $t0, 1
	sw $t0, 1($zero)
	li $t0, 2
	li $v0, 10
	syscall
${HANDLER_SOURCE}`)

		expect(runToFault(simulator)).toBe('')
		expect(causeCode(simulator)).toBe(5)
		expect(badAddress(simulator)).toBe(1)
		// The handler ran and `eret` returned past the store, not into it.
		expect(simulator.registers.$t1).toBe(7)
		expect(simulator.registers.$t0).toBe(2)
	})

	it('halts with the fault message when the program defines no handler', async () => {
		const simulator = build(withExit('li $t0, 1\nsw $t0, 1($zero)\nli $t0, 2'))
		await simulator.run()

		expect(simulator.halted).toBe(true)
		expect(simulator.console).toContain('store address not aligned on word boundary: 0x00000001')
		// The store aborted, so nothing after it ran.
		expect(simulator.registers.$t0).toBe(1)
	})

	it('does not write the destination of a faulting load', () => {
		const simulator = build(`
	.text
main:
	li $t0, 5
	lw $t0, 1($zero)
	li $v0, 10
	syscall
${HANDLER_SOURCE}`)

		expect(runToFault(simulator)).toBe('')
		expect(simulator.registers.$t0).toBe(5)
		expect(simulator.registers.$t1).toBe(7)
	})
})
