import { describe, expect, it } from 'vitest'
import { HISTORY_BLOCK_SIZE } from '../../../core/historyBuffers'
import { STEP_HALT, STEP_OK, STEP_WAIT } from '../cpu'
import { EXAMPLES } from '../examples'
import { BetaMachine } from '../machine'
import { assembleUasm } from '../uasm'

const MEMORY = 0x4000

function machine(code: string, historyLimit = 1 << 22) {
	const { image, diagnostics, directives } = assembleUasm({ name: 'main.uasm', code })
	expect(diagnostics).toEqual([])
	const result = new BetaMachine({ memoryBytes: MEMORY, tty: directives.options.tty, historyLimit })
	result.load(image!)
	return result
}

function snapshot(m: BetaMachine) {
	return {
		registers: [...m.cpu.registers],
		pc: m.cpu.pc,
		memory: Buffer.from(m.cpu.memory).toString('base64'),
		output: m.console.output,
		inputIndex: m.console.inputIndex,
		waiting: m.console.waiting,
		halted: m.halted,
		frames: m.callStack.frames(),
	}
}

/** A fresh machine after `steps` steps. */
function freshAfter(code: string, steps: number) {
	const m = machine(code, 0)
	for (let step = 0; step < steps; step++) expect(m.step()).toBe(STEP_OK)
	return m
}

/** Deterministic points in [0, count), largest first. */
function points(count: number, how: number, seed: number) {
	const out = new Set<number>([0, count - 1])
	while (out.size < how) {
		seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
		out.add(seed % count)
	}
	return [...out].sort((a, b) => b - a)
}

describe('Beta history', () => {
	it.each(['ackermann', 'fibonacci', 'factorial'])('rewinds %s to random entries, matching a fresh run', (key) => {
		const { code } = EXAMPLES[key]
		const m = machine(code)
		expect(m.run(1_000_000)).toBe(STEP_HALT)
		const history = m.history!
		const total = history.length
		// Every step to HALT changed state, HALT included.
		expect(history.firstId).toBe(0)
		const final = snapshot(m)
		for (const point of points(total, 8, key.length)) {
			history.rewindTo(point)
			expect(history.timeline.index).toBe(point)
			expect(history.length).toBe(total)
			expect(snapshot(m)).toEqual(snapshot(freshAfter(code, point)))
		}
		// Forward again from the earliest point reproduces the end.
		expect(m.run(1_000_000)).toBe(STEP_HALT)
		expect(history.length).toBe(total)
		expect(snapshot(m)).toEqual(final)
	})

	it('steps back N then forward N to the same state', () => {
		const m = machine(EXAMPLES.ackermann.code)
		m.run(5000)
		const before = snapshot(m)
		const middle = snapshot(freshAfter(EXAMPLES.ackermann.code, 5000 - 1234))
		for (let step = 0; step < 1234; step++) expect(m.history!.stepBack()).toBe(true)
		expect(snapshot(m)).toEqual(middle)
		for (let step = 0; step < 1234; step++) m.step()
		expect(snapshot(m)).toEqual(before)
	})

	it('un-halts on stepping back over HALT', () => {
		const m = machine('.include "beta.uasm"\nCMOVE(1, R1)\nHALT()')
		expect(m.run(10)).toBe(STEP_HALT)
		expect(m.halted).toBe(true)
		expect(m.history!.length).toBe(2)
		m.history!.stepBack()
		expect([m.halted, m.cpu.pc]).toEqual([false, 0x80000004])
		expect(m.history!.stepBack()).toBe(true)
		expect(m.history!.stepBack()).toBe(false)
		expect(m.cpu.registers[1]).toBe(0)
	})

	it('restores console output, input position and waiting', () => {
		const { code } = EXAMPLES.input
		const m = machine(code)
		expect(m.run(100_000)).toBe(STEP_WAIT)
		const waitingAt = m.history!.length
		// Waiting again changes nothing, so records nothing.
		expect(m.step()).toBe(STEP_WAIT)
		expect(m.history!.length).toBe(waitingAt)
		const waiting = snapshot(m)
		expect(waiting.waiting).toBe(true)
		m.console.feed('hi\r')
		expect(m.run(100_000)).toBe(STEP_HALT)
		const final = snapshot(m)
		expect(final.output).toBe('hi\n')

		m.history!.rewindTo(waitingAt)
		expect(snapshot(m)).toEqual(waiting)
		// Typed input is kept, so the replay reads it again without waiting.
		expect(m.run(100_000)).toBe(STEP_HALT)
		expect(snapshot(m)).toEqual(final)

		m.history!.rewindTo(waitingAt - 1)
		expect(m.console.waiting).toBe(false)
		expect(m.console.inputIndex).toBe(0)
		expect(m.console.output).toBe('')
	})

	it('keeps at least the limit and at most a block more, and rewinds to the oldest held', () => {
		const { code } = EXAMPLES.ackermann
		const limit = 3000
		const m = machine(code, limit)
		m.run(20_000)
		const history = m.history!
		expect(history.length).toBeGreaterThanOrEqual(limit)
		expect(history.length).toBeLessThan(limit + HISTORY_BLOCK_SIZE)
		expect(history.firstId + history.length).toBe(20_000)
		expect(history.idAt(0)).toBe(history.firstId)
		// Blocks are reused: a run ten times longer needs at most a few more.
		const bytes = history.allocatedBufferBytes
		m.run(200_000)
		expect(history.allocatedBufferBytes).toBeLessThan(bytes * 1.5)
		const oldest = history.firstId
		history.rewindTo(0)
		expect(snapshot(m)).toEqual(snapshot(freshAfter(code, oldest)))
		expect(history.stepBack()).toBe(false)
	})

	it('records the instruction address and word of each entry', () => {
		const m = machine('.include "beta.uasm"\nCMOVE(5, R1)\nPUSH(R1)\nHALT()')
		m.cpu.setRegister(29, 0x100)
		m.run(10)
		const history = m.history!
		expect([0, 1, 2, 3].map((index) => history.pcAt(index))).toEqual([0x80000000, 0x80000004, 0x80000008, 0x8000000C])
		expect(history.wordAt(0) >>> 26).toBe(0x30)
		expect(history.wordAt(3)).toBe(0)
		// ST: memory then PC.
		const start = history.effectStartAt(2)
		expect(history.effectCountAt(2)).toBe(2)
		expect([history.effectKind(start), history.effectA(start), history.effectB(start)]).toEqual([1, 0x100, 0])
	})
})
