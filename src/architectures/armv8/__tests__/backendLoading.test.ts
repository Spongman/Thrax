import { describe, expect, it, vi } from 'vitest'

const events = vi.hoisted(() => [] as string[])
vi.mock('../a64/state', () => {
	events.push('import a64')
	return { createA64State: () => { events.push('create a64'); return { id: 'aarch64' } } }
})
vi.mock('../a32/state', () => {
	events.push('import a32')
	return { createA32State: () => { events.push('create a32'); return { id: 'aarch32' } } }
})
vi.mock('../m0/state', () => {
	events.push('import m0')
	return { createM0State: () => { events.push('create m0'); return { id: 'cortex-m0' } } }
})

import definition from '../index'
import { DEFAULT_ARMV8_SETTINGS } from '../settings'

describe('ARM backend preparation', () => {
	it('loads no execution backend just to read variant metadata', () => {
		expect(definition.variant!({ executionState: 'cortex-m0' }).registers.length).toBeGreaterThan(0)
		expect(events).toEqual([])
	})

	it('loads only the requested variant and shares concurrent preparations', async () => {
		const services = definition.createServices()
		const settings = { ...DEFAULT_ARMV8_SETTINGS, executionState: 'cortex-m0' }
		try {
			expect(services.isPrepared?.(settings)).toBe(false)
			expect(() => services.assemble({ files: [], entries: [] }, settings)).toThrow('not prepared')
			await Promise.all([services.prepare!(settings), services.prepare!(settings)])
			expect(services.isPrepared?.(settings)).toBe(true)
			expect(events).toEqual(['import m0', 'create m0'])
			await services.prepare!(settings)
			expect(events).toEqual(['import m0', 'create m0'])
		} finally { services.dispose() }
	})

	it('prevents backend creation when its activation was disposed during import', async () => {
		const services = definition.createServices()
		const pending = services.prepare!({ ...DEFAULT_ARMV8_SETTINGS, executionState: 'aarch64' })
		services.dispose()
		await expect(pending).rejects.toThrow('disposed')
		expect(events).not.toContain('create a64')
	})
})
