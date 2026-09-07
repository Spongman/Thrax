import { describe, expect, it } from 'vitest'
import { rowAt, rowForScroll, scrollStep } from '../historyDrag'

/**
 * The two ways of moving the marker: dragging it, and dragging the scrollbar
 * with shift held.  Both are arithmetic over the panel's geometry, so they are
 * checked here rather than through a browser.
 */

const ROW = 20
// A panel 200px tall showing ten of a hundred rows, its top at y=100.
const TOP = 100
const BOTTOM = 300
const COUNT = 100

describe('the row under the pointer', () => {
	it('is the one it is over', () => {
		expect(rowAt(TOP + 5, TOP, BOTTOM, 0, ROW, COUNT)).toBe(0)
		expect(rowAt(TOP + 25, TOP, BOTTOM, 0, ROW, COUNT)).toBe(1)
		expect(rowAt(TOP + 195, TOP, BOTTOM, 0, ROW, COUNT)).toBe(9)
	})

	it('counts from what is scrolled to, not from the top of the list', () => {
		expect(rowAt(TOP + 5, TOP, BOTTOM, 40 * ROW, ROW, COUNT)).toBe(40)
	})

	// Dragged out of the panel the marker stays at the edge, and the list
	// scrolling under it is what brings new rows to it.
	it('stays with the rows on screen when the pointer leaves', () => {
		expect(rowAt(TOP - 500, TOP, BOTTOM, 40 * ROW, ROW, COUNT)).toBe(40)
		expect(rowAt(BOTTOM + 500, TOP, BOTTOM, 40 * ROW, ROW, COUNT)).toBe(49)
	})

	it('never leaves the list, however far it is dragged', () => {
		expect(rowAt(TOP - 5000, TOP, BOTTOM, 0, ROW, COUNT)).toBe(0)
		expect(rowAt(BOTTOM + 5000, TOP, BOTTOM, 90 * ROW, ROW, COUNT)).toBe(COUNT - 1)
		expect(rowAt(TOP + 5, TOP, BOTTOM, 0, ROW, 0)).toBe(0)
	})
})

describe('scrolling while the marker is held past the edge', () => {
	it('does not scroll while the pointer is over the panel', () => {
		expect(scrollStep(TOP, TOP, BOTTOM)).toBe(0)
		expect(scrollStep((TOP + BOTTOM) / 2, TOP, BOTTOM)).toBe(0)
		expect(scrollStep(BOTTOM, TOP, BOTTOM)).toBe(0)
	})

	it('goes the way the pointer left', () => {
		expect(scrollStep(TOP - 20, TOP, BOTTOM)).toBeLessThan(0)
		expect(scrollStep(BOTTOM + 20, TOP, BOTTOM)).toBeGreaterThan(0)
	})

	it('accelerates the further out the pointer is', () => {
		const near = scrollStep(BOTTOM + 10, TOP, BOTTOM)
		const far = scrollStep(BOTTOM + 20, TOP, BOTTOM)
		const further = scrollStep(BOTTOM + 40, TOP, BOTTOM)
		expect(far).toBeGreaterThan(near)
		expect(further).toBeGreaterThan(far)
		// More than twice as fast for twice as far, which is what makes a long
		// run crossable without the pointer leaving the screen.
		expect(far / near).toBeGreaterThan(2)
	})

	it('is capped, so a pointer at the edge of the screen is not a jump', () => {
		expect(scrollStep(BOTTOM + 10000, TOP, BOTTOM)).toBe(48)
		expect(scrollStep(TOP - 10000, TOP, BOTTOM)).toBe(-48)
	})
})

describe('the row the scrollbar points at with shift held', () => {
	// A hundred 20px rows in a 200px panel: 2000px of content, 1800px of track.
	const HEIGHT = 2000
	const CLIENT = 200

	it('puts the first instruction at the top of the track', () => {
		expect(rowForScroll(0, HEIGHT, CLIENT, COUNT)).toBe(0)
	})

	it('puts the last instruction at the bottom of the track', () => {
		expect(rowForScroll(HEIGHT - CLIENT, HEIGHT, CLIENT, COUNT)).toBe(COUNT - 1)
	})

	it('runs evenly between the two', () => {
		expect(rowForScroll((HEIGHT - CLIENT) / 2, HEIGHT, CLIENT, COUNT)).toBe(50)
		expect(rowForScroll((HEIGHT - CLIENT) / 4, HEIGHT, CLIENT, COUNT)).toBe(25)
	})

	/**
	 * The marker lands the same fraction down the rows on screen as the thumb is
	 * down its track, which is what makes it look attached to the thumb.
	 */
	it('sits that same fraction through the rows on screen', () => {
		const visible = CLIENT / ROW
		for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
			const scrollTop = fraction * (HEIGHT - CLIENT)
			const firstOnScreen = scrollTop / ROW
			expect(rowForScroll(scrollTop, HEIGHT, CLIENT, COUNT)).toBe(Math.round(firstOnScreen + fraction * (visible - 1)))
		}
	})

	it('says nothing about an empty history or a list that does not scroll', () => {
		expect(rowForScroll(0, HEIGHT, CLIENT, 0)).toBe(0)
		expect(rowForScroll(0, CLIENT, CLIENT, COUNT)).toBe(0)
	})
})
