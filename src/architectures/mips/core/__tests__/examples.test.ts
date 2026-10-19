import { describe, expect, it } from 'vitest'
import { EXAMPLES } from '../../examples'
import { build } from './helpers'

/** Every shipped example must assemble and run without reporting an error. */
describe('example programs', () => {
	it.each(Object.values(EXAMPLES).map((example) => [example.name, example.code] as const))('runs %s', async (_name, code) => {
		const simulator = build(code)
		// A run has no limit of its own, and an example that polls a device for a
		// keypress that never comes would run forever here, so the test bounds it.
		await simulator.runUntil(() => simulator.instructionCount >= 1_000_000)
		expect(simulator.console).not.toContain('Error:')
		// The program either finished, is waiting for the user, or is a polling
		// loop that the bound stopped.
		expect(simulator.halted || simulator.pendingInput !== null || simulator.paused).toBe(true)
	})
})

describe('coprocessor example', () => {
	it('prints the values its floating-point maths produces', async () => {
		const simulator = build(EXAMPLES.coprocessor.code)
		await simulator.runUntil(() => simulator.instructionCount >= 1_000_000)
		expect(simulator.console).toBe('hypotenuse = 5\narea = 6\na < b\ncp0 status = 0x0000ff11\n')
	})
})
