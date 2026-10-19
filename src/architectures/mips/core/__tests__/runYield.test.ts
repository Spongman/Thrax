import { describe, expect, it } from 'vitest'
import { build } from './helpers'

describe('an unlimited run', () => {
	it('lets the host run tasks between batches', async () => {
		const simulator = build('main: j main')
		let ticked = false
		setTimeout(() => { ticked = true }, 0)
		await simulator.runUntil(() => ticked || simulator.instructionCount >= 2_000_000)
		expect(ticked).toBe(true)
		expect(simulator.instructionCount).toBeLessThan(2_000_000)
	})
})
