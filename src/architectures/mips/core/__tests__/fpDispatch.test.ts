import { describe, expect, it } from 'vitest'
import { build } from './helpers'
import type { MipsSimulator } from '../simulator'

/** Steps under a budget, so a stuck branch fails rather than hangs. */
function runBounded(simulator: MipsSimulator, budget = 400) {
	let steps = 0
	while (!simulator.halted && steps < budget) {
		simulator.step()
		steps++
	}
	expect(simulator.halted).toBe(true)
}

/** Every shape of dotted CP1 mnemonic, so each arm of the dispatch is taken. */
const EVERY_FORM = `
	li $t0, 1
	mtc1 $t0, $f4
	cvt.s.w $f4, $f4
	add.s $f6, $f4, $f4
	sub.s $f6, $f6, $f4
	mul.s $f6, $f6, $f4
	div.s $f6, $f6, $f4
	abs.s $f6, $f6
	neg.s $f6, $f6
	sqrt.s $f6, $f4
	mov.s $f8, $f6
	c.eq.s $f4, $f4
	movt.s $f8, $f4
	movn.s $f8, $f4, $t0
	cvt.d.s $f10, $f4
	round.w.s $f12, $f4
	trunc.w.s $f12, $f4
	ceil.w.s $f12, $f4
	floor.w.s $f12, $f4
`

describe('the CP1 dispatch', () => {
	it('does not take a mnemonic apart while executing it', () => {
		// The form of `mul.d` is a property of the op, not of the moment it runs:
		// it belongs in a table built once. Splitting the name per execution cost
		// an array and two strings every FP instruction, measured at 48ns against
		// 2.6ns for the table, so the fix is what this pins rather than the speed.
		const simulator = build(`${EVERY_FORM}\nli $v0, 10\nsyscall\n`)
		const realSplit = String.prototype.split
		let splits = 0
		// The overloads do not survive being wrapped, and what is counted is the
		// call rather than its arguments.
		String.prototype.split = function (this: string, ...args: unknown[]) {
			splits += 1
			return (realSplit as (...rest: unknown[]) => string[]).apply(this, args)
		} as typeof String.prototype.split
		try {
			runBounded(simulator)
		} finally {
			String.prototype.split = realSplit
		}
		expect(splits).toBe(0)
	})

	it('still reaches every form it dispatches to', () => {
		// A table that quietly matched nothing would pass the test above, so the
		// arms have to be shown to run: each of these lands in a different one.
		const simulator = build(`${EVERY_FORM}\nli $v0, 10\nsyscall\n`)
		runBounded(simulator)
		expect(simulator.halted).toBe(true)
		// sqrt.s of 1.0, and the conditional moves that copied it.
		expect(simulator.readFpSingle(6)).toBe(1)
		expect(simulator.readFpSingle(8)).toBe(1)
		// round/trunc/ceil/floor of 1.0 all land on the same integer word.
		expect(simulator.readFpWord(12)).toBe(1)
		// cvt.d.s of 1.0.
		expect(simulator.readFpDouble(10)).toBe(1)
		expect(simulator.fpConditionFlags[0]).toBe(true)
	})

	it('refuses an op that is not a dotted CP1 mnemonic', () => {
		const simulator = build('add $t0, $t0, $t0\nli $v0, 10\nsyscall\n')
		runBounded(simulator)
		expect(simulator.halted).toBe(true)
	})
})
