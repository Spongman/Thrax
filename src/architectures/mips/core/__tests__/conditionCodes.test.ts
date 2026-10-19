import { describe, expect, it } from 'vitest'
import { decode } from '../decoder'
import { build, words } from './helpers'
import type { MipsSimulator } from '../simulator'

/** Steps under a budget, so a stuck branch fails rather than hangs. */
function runBounded(simulator: MipsSimulator, budget = 200) {
	let steps = 0
	while (!simulator.halted && steps < budget) {
		simulator.step()
		steps++
	}
	expect(simulator.halted).toBe(true)
}

function runProgram(body: string): MipsSimulator {
	const simulator = build(`${body}\nli $v0, 10\nsyscall\n`)
	runBounded(simulator)
	return simulator
}

/**
 * The FPU has eight condition flags, and every form that names one carries it
 * in the word: `c.cond.fmt` writes it, `bc1t`/`bc1f` and the conditional moves
 * read it (`InstructionSet.java:2054`, `:1986`, `:1117`).
 */
describe('FP condition codes', () => {
	it('keeps the flag out of the decoded word for no form', () => {
		expect(decode(words('here: c.eq.s 1, $f0, $f1')[0])?.cc).toBe(1)
		expect(decode(words('here: bc1t 5, here')[0])?.cc).toBe(5)
		expect(decode(words('movt $t1, $t2, 7')[0])?.cc).toBe(7)
		expect(decode(words('movf.d $f2, $f4, 3')[0])?.cc).toBe(3)
	})

	it('writes the flag the comparison names and leaves the others alone', () => {
		const simulator = runProgram(`
	.data
one:	.float 1.0
two:	.float 2.0
	.text
main:
	la $t0, one
	lwc1 $f0, 0($t0)
	lwc1 $f1, 4($t0)
	c.eq.s 1, $f0, $f1
	c.lt.s 1, $f0, $f1
`)
		expect(simulator.fpConditionFlags[1]).toBe(true)
		expect(simulator.fpConditionFlags[0]).toBe(false)
	})

	it('branches on the flag the branch names', () => {
		const simulator = runProgram(`
	.data
one:	.float 1.0
two:	.float 2.0
	.text
main:
	la $t0, one
	lwc1 $f0, 0($t0)
	lwc1 $f1, 4($t0)
	c.lt.s 1, $f0, $f1
	bc1t 1, taken
	li $t1, 1
	li $v0, 10
	syscall
taken:
	li $t2, 2
`)
		expect(simulator.fpConditionFlags[1]).toBe(true)
		expect(simulator.registers.$t2).toBe(2)
		expect(simulator.registers.$t1).toBe(0)
	})

	it('ignores flag 0 when the branch names another', () => {
		// Flag 1 stays false while flag 0 is set, so `bc1t 1` must not branch.
		const simulator = runProgram(`
	.data
one:	.float 1.0
two:	.float 2.0
	.text
main:
	la $t0, one
	lwc1 $f0, 0($t0)
	lwc1 $f1, 4($t0)
	c.lt.s $f0, $f1
	bc1t 1, taken
	li $t1, 1
	li $v0, 10
	syscall
taken:
	li $t2, 2
`)
		expect(simulator.fpConditionFlags[0]).toBe(true)
		expect(simulator.registers.$t1).toBe(1)
		expect(simulator.registers.$t2).toBe(0)
	})

	it('moves a general register on the flag the move names', () => {
		const simulator = runProgram(`
	.data
one:	.float 1.0
two:	.float 2.0
	.text
main:
	la $t0, one
	lwc1 $f0, 0($t0)
	lwc1 $f1, 4($t0)
	li $t3, 9
	c.lt.s 2, $f0, $f1
	movt $t4, $t3, 2
	movf $t5, $t3, 2
	movt $t6, $t3, 0
	movf $t7, $t3, 0
`)
		expect(simulator.registers.$t4).toBe(9)
		expect(simulator.registers.$t5).toBe(0)
		expect(simulator.registers.$t6).toBe(0)
		expect(simulator.registers.$t7).toBe(9)
	})

	it('moves an FP register on the flag the move names', () => {
		const simulator = runProgram(`
	.data
one:	.float 1.0
two:	.float 2.0
	.text
main:
	la $t0, one
	lwc1 $f0, 0($t0)
	lwc1 $f1, 4($t0)
	c.lt.s 4, $f0, $f1
	movt.s $f2, $f0, 4
	movf.s $f3, $f0, 4
`)
		expect(simulator.fpRegisters[2]).toBe(simulator.fpRegisters[0])
		expect(simulator.fpRegisters[3]).toBe(0)
	})
})
