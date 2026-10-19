import { describe, expect, it } from 'vitest'
import definition from '../index'
import type { BetaRuntime } from '../runtime'
import { DEFAULT_BETA_SETTINGS } from '../settings'

describe('an unlimited run', () => {
	it('lets the host run tasks between batches', async () => {
		const services = definition.createServices()
		const code = '.include "beta.uasm"\nloop: BR(loop)\n'
		const program = services.assemble({ files: [{ name: 'main.uasm', code }], entries: ['main.uasm'] }, DEFAULT_BETA_SETTINGS)
		expect(program.diagnostics).toEqual([])
		const machine = services.createMachine(program, DEFAULT_BETA_SETTINGS, { speed: null, historyLimit: 1000 }) as BetaRuntime
		let ticked = false
		setTimeout(() => { ticked = true }, 0)
		// runUntil is private; a bound keeps a loop that never yields from hanging the suite.
		const bounded = machine as unknown as { runUntil(stop: () => boolean): Promise<void> }
		await bounded.runUntil(() => ticked || machine.instructionCount >= 2_000_000)
		expect(ticked).toBe(true)
		expect(machine.instructionCount).toBeLessThan(2_000_000)
	})
})
