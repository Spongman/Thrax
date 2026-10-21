import { RGB32_LE } from '../../core/bitmapFormats'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MemoryInspector } from '../../architectures/contracts'
import BitmapDisplay from '../BitmapDisplay'

const storage = new Map<string, string>()

Object.defineProperty(globalThis, 'window', {
	value: {
		localStorage: {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => { storage.set(key, value) },
		},
	},
	writable: true,
})

const memory: MemoryInspector = { wordBytes: 1, byte: () => 0, word: () => 0 } as unknown as MemoryInspector

const baseShown = (html: string) => {
	const input = /<input[^>]*aria-label="Bitmap base address"[^>]*>/.exec(html)?.[0] ?? ''
	return /value="([^"]*)"/.exec(input)?.[1]
}

describe('Bitmap Display base address', () => {
	it('is remembered per architecture, so another target starts at its own data base', () => {
		storage.set('thrax-web.settings.bitmap.base', JSON.stringify('0x10010000'))
		storage.set('thrax-web.settings.bitmap.base.mips', JSON.stringify('0x10010000'))
		const html = renderToStaticMarkup(<BitmapDisplay format={RGB32_LE} memory={memory} defaultBase={0xC000} architecture="z80" />)
		expect(baseShown(html)).toBe('0x0000C000')
	})

	it('keeps the base chosen for that architecture', () => {
		storage.set('thrax-web.settings.bitmap.base.z80', JSON.stringify('0x00008000'))
		const html = renderToStaticMarkup(<BitmapDisplay format={RGB32_LE} memory={memory} defaultBase={0xC000} architecture="z80" />)
		expect(baseShown(html)).toBe('0x00008000')
	})
})
