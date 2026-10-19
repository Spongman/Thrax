import { describe, expect, it } from 'vitest'
import { STEP_HALT, STEP_OK } from '../cpu'
import { EXAMPLES } from '../examples'
import { BetaMachine } from '../machine'
import { BetaSourceIndex } from '../sourceIndex'
import { assembleUasm } from '../uasm'

function load(code: string, historyLimit = 0) {
	const { image, diagnostics, directives } = assembleUasm({ name: 'main.uasm', code })
	expect(diagnostics).toEqual([])
	const m = new BetaMachine({ memoryBytes: 0x4000, tty: directives.options.tty, historyLimit })
	m.load(image!)
	const index = new BetaSourceIndex(image!)
	return { m, index, symbolAt: (address: number) => index.symbolAt(address) }
}

const FACTORIAL = `.include "beta.uasm"
	CMOVE(stack, SP)
	CMOVE(4, R1)
	PUSH(R1)
	CALL(fact, 1)
	HALT()

// fact(n) = n * fact(n - 1), fact(0) = 1
fact:
	PUSH(LP) PUSH(BP)
	MOVE(SP, BP)
	PUSH(R1)
	LD(BP, -12, R1)
	BNE(R1, recurse)
	CMOVE(1, R0)
	BR(fact_return)
recurse:
	SUBC(R1, 1, R0)
	PUSH(R0)
	CALL(fact, 1)
	MUL(R1, R0, R0)
fact_return:
	POP(R1)
	MOVE(BP, SP)
	POP(BP) POP(LP)
	RTN()

stack: STORAGE(64)
`

describe('Beta call stack', () => {
	it('tracks factorial recursion with return addresses and callee labels', () => {
		const { m, index, symbolAt } = load(FACTORIAL)
		const fact = index.addressOf('fact')!
		// CALL(fact, 1) is BR then DEALLOCATE, which is where RTN lands.
		const recursiveCall = index.addressesForLine('main.uasm', 20)
		expect(recursiveCall).toHaveLength(2)
		let deepest = 0
		let deepestFrames = m.callStack.frames(symbolAt)
		let status = STEP_OK
		while (status === STEP_OK) {
			status = m.step()
			if (m.callStack.depth > deepest) {
				deepest = m.callStack.depth
				deepestFrames = m.callStack.frames(symbolAt)
			}
		}
		expect(status).toBe(STEP_HALT)
		expect(m.cpu.registers[0]).toBe(24)
		expect(deepest).toBe(5)
		expect(m.callStack.depth).toBe(0)
		expect(deepestFrames.map((frame) => frame.label)).toEqual(['fact', 'fact', 'fact', 'fact', 'fact'])
		expect(deepestFrames.every((frame) => frame.callee === fact)).toBe(true)
		// The outer call returns into the main line; the rest to just after CALL in fact.
		expect(deepestFrames[0].returnAddress).toBe(index.addressesForLine('main.uasm', 5)[0] + 4)
		for (const frame of deepestFrames.slice(1)) {
			expect(frame.returnAddress).toBe(recursiveCall[1])
			expect(frame.callSite).toBe(recursiveCall[0])
		}
		// Each frame's argument sits at BP - 12, per the convention.
		expect(deepestFrames.map((frame) => m.cpu.readWord(frame.framePointer - 12))).toEqual([4, 3, 2, 1, 0])
	})

	it('reports the frames of ackermann mid-recursion, and is restored by rewind', () => {
		const { m, symbolAt } = load(EXAMPLES.ackermann.code, 1 << 20)
		const seen: string[][] = []
		let max = 0
		for (let step = 0; m.step() === STEP_OK; step++) {
			if (step === 5000) seen.push(m.callStack.frames(symbolAt).map((frame) => frame.label ?? '?'))
			max = Math.max(max, m.callStack.depth)
		}
		expect(m.console.output).toBe('A(3, 3) = 61')
		expect(m.callStack.depth).toBe(0)
		expect(max).toBeGreaterThan(10)
		expect(seen[0].length).toBeGreaterThan(1)
		expect(new Set(seen[0])).toEqual(new Set(['ackermann']))

		m.history!.rewindTo(5001)
		expect(m.callStack.frames(symbolAt).map((frame) => frame.label ?? '?')).toEqual(seen[0])
	})

	it('ignores a return that matches no frame', () => {
		const { m } = load('.include "beta.uasm"\nCMOVE(8, LP)\nRTN()\nHALT()')
		expect(m.run(10)).toBe(STEP_HALT)
		expect(m.callStack.depth).toBe(0)
	})
})
