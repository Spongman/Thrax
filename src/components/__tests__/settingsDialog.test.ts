import { describe, expect, it } from 'vitest'
import { scrollDelta } from '../SettingsDialog'
import { clampFrame, fitOnScreen, resizeFrame } from '../Modal'

describe('revealing a whole settings section', () => {
	const view = { top: 100, bottom: 300 }

	it('leaves a section already in view alone', () => {
		expect(scrollDelta({ top: 150, bottom: 250 }, view)).toBe(0)
	})

	it('pulls up a section hanging off the bottom, and no further', () => {
		expect(scrollDelta({ top: 250, bottom: 340 }, view)).toBe(40)
	})

	it('aligns a section that starts above the view', () => {
		expect(scrollDelta({ top: 60, bottom: 180 }, view)).toBe(-40)
	})

	it('aligns the top of a section too tall to fit, rather than its bottom', () => {
		expect(scrollDelta({ top: 140, bottom: 500 }, view)).toBe(40)
	})

	// The frame is the scroll box less the title stacks: those at or above this
	// section sit over the rows, those below sit under them.
	it('measures against the room the stacked titles leave', () => {
		const box = { top: 0, bottom: 240 }
		const headerHeight = 24
		const frameFor = (index: number, count: number) => ({
			top: box.top + (index + 1) * headerHeight,
			bottom: box.bottom - (count - 1 - index) * headerHeight,
		})

		// Third of five: three titles above, two below, so rows live in 72..192.
		const frame = frameFor(2, 5)
		expect(frame).toEqual({ top: 72, bottom: 192 })
		// Content already inside that band does not move.
		expect(scrollDelta({ top: 80, bottom: 180 }, frame)).toBe(0)
		// Content hidden behind the bottom stack is pulled up to clear it.
		expect(scrollDelta({ top: 100, bottom: 220 }, frame)).toBe(28)
		// Content taller than the band starts at the top of it.
		expect(scrollDelta({ top: 90, bottom: 400 }, frame)).toBe(18)
	})
})

describe('moving and resizing a dialog', () => {
	const viewport = { width: 1000, height: 800 }

	it('leaves a dialog inside the viewport where it is', () => {
		const frame = { left: 100, top: 100, width: 400, height: 300 }
		expect(clampFrame(frame, viewport)).toEqual(frame)
	})

	it('keeps a grabbable strip on screen when dragged off an edge', () => {
		expect(clampFrame({ left: -900, top: 100, width: 400, height: 300 }, viewport).left).toBe(-352)
		expect(clampFrame({ left: 5000, top: 100, width: 400, height: 300 }, viewport).left).toBe(952)
	})

	it('never lets the header be dragged above the top', () => {
		expect(clampFrame({ left: 100, top: -50, width: 400, height: 300 }, viewport).top).toBe(0)
	})

	it('grows and shrinks, but not below a usable size', () => {
		const frame = { left: 0, top: 0, width: 400, height: 300 }
		expect(resizeFrame(frame, 100, 50)).toMatchObject({ width: 500, height: 350 })
		expect(resizeFrame(frame, -1000, -1000)).toMatchObject({ width: 320, height: 160 })
	})
})

describe('reopening a dialog where it was left', () => {
	const viewport = { width: 1000, height: 800 }

	it('leaves a frame that still fits exactly where it was', () => {
		const frame = { left: 120, top: 90, width: 560, height: 560 }
		expect(fitOnScreen(frame, viewport)).toEqual(frame)
	})

	it('pulls a frame back on screen after the window moved or shrank', () => {
		// Left on a wider display, reopened on this one.
		expect(fitOnScreen({ left: 1800, top: 90, width: 560, height: 400 }, viewport))
			.toMatchObject({ left: 432, top: 90 })
		expect(fitOnScreen({ left: -300, top: -80, width: 560, height: 400 }, viewport))
			.toMatchObject({ left: 8, top: 8 })
	})

	it('shrinks a frame too big for the window, down to a usable size', () => {
		expect(fitOnScreen({ left: 0, top: 0, width: 5000, height: 5000 }, viewport))
			.toEqual({ left: 8, top: 8, width: 984, height: 784 })
		// Never below what the dialog needs, even on a tiny window.
		expect(fitOnScreen({ left: 0, top: 0, width: 400, height: 300 }, { width: 120, height: 100 }))
			.toMatchObject({ width: 320, height: 160 })
	})
})
