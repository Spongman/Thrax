/** Every target's Bitmap Display example draws where the display looks first. */

import { beforeAll, describe, expect, it } from 'vitest'

const storage = new Map<string, string>()

// The store reads its settings while it is being created.
Object.defineProperty(globalThis, 'window', {
	value: {
		localStorage: {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => { storage.set(key, value) },
		},
	},
	writable: true,
})

const { initializeArchitecture, knownArchitectures } = await import('../registry')
const { useTHRAXStore } = await import('../../store/thraxStore')

const state = () => useTHRAXStore.getState()

beforeAll(async () => {
	await initializeArchitecture('mips')
})

describe('Bitmap Display examples', () => {
	it.each(knownArchitectures())('%s draws at its data base', async (id) => {
		expect(await state().switchArchitecture(id)).toBe(true)
		const bitmap = state().target!.definition.examples.bitmap
		expect(bitmap).toBeDefined()
		state().setCode(bitmap.code)
		const base = state().targetProfile!.dataBase!
		const pixels = () => Array.from({ length: 256 }, (_, index) => state().memory.byte(base + index) ?? 0)
		await state().run()
		expect(state().halted).toBe(true)
		const drawn = pixels()
		state().reset()
		// The program drew there, rather than the display showing what was loaded.
		expect(drawn.some((byte) => byte !== 0)).toBe(true)
		expect(drawn).not.toEqual(pixels())
	})
})
