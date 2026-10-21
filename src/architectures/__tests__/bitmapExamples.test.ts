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
	it('applies an explicit example layout and resets it on the next example or CPU', async () => {
		await state().switchArchitecture('mips')
		const example = state().target!.definition.examples.bitmap
		const bitmap = { kind: 'indexed8' as const, palette: [0, 0xffffff] }
		state().loadExample({ ...example, bitmap })
		expect(state().bitmapFormat).toEqual(bitmap)
		state().loadExample(example)
		expect(state().bitmapFormat).toBeNull()
		state().loadExample({ ...example, bitmap })
		await state().switchArchitecture('beta')
		expect(state().bitmapFormat).toBeNull()
	})
	it('loads example palettes before opening the tool and clears them for another example or CPU', async () => {
		await state().switchArchitecture('mos6502')
		const examples = state().target!.definition.examples
		state().loadExample(examples.mandelbrot)
		expect(state().bitmapPalette).toEqual([
			0x000030, 0x00104a, 0x001f66, 0x003080,
			0x0044a0, 0x0059bd, 0x1a72d4, 0x3d8ce0,
			0x62a6ea, 0x86bff2, 0xa8d5f7, 0xc6e6fb,
			0xdef1fd, 0xeff8fe, 0xf8fcff, 0xffffff,
			0x000000
		])
		state().setDocumentCode(state().activeDocumentId, state().code + '\n; edited')
		expect(state().bitmapPalette).toEqual([
			0x000030, 0x00104a, 0x001f66, 0x003080,
			0x0044a0, 0x0059bd, 0x1a72d4, 0x3d8ce0,
			0x62a6ea, 0x86bff2, 0xa8d5f7, 0xc6e6fb,
			0xdef1fd, 0xeff8fe, 0xf8fcff, 0xffffff,
			0x000000
		])
		state().loadExample(examples.bitmap)
		expect(state().bitmapPalette).toBeNull()
		state().loadExample(examples.mandelbrot)
		await state().switchArchitecture('mips')
		expect(state().bitmapPalette).toBeNull()
	})

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
