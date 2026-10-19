import { describe, expect, it } from 'vitest'
import { EXAMPLES } from '../../examples'
import { build } from './helpers'

const FRAME = 0x10010000
const SIZE = 32
const INTERIOR = 0x000000

/** The colour word the example wrote for one pixel. */
function pixel(memory: Map<number, number>, column: number, row: number): number {
	return memory.get((FRAME + (row * SIZE + column) * 4) >>> 2) ?? -1
}

async function render() {
	const simulator = build(EXAMPLES.mandelbrot.code)
	await simulator.run()
	return simulator
}

describe('mandelbrot example', () => {
	it('fills the whole frame buffer and finishes', async () => {
		const simulator = await render()

		expect(simulator.console).toBe('')
		expect(simulator.halted).toBe(true)
		// Every pixel was visited: the cursor ends one word past the buffer.
		expect(simulator.registers.$s2 >>> 0).toBe(FRAME + SIZE * SIZE * 4)
	})

	it('leaves the interior of the set black and colours the outside', async () => {
		const simulator = await render()

		// c = -0.515625 + 0i is deep inside the set.
		expect(pixel(simulator.memory, 19, 16)).toBe(INTERIOR)
		// The corners are well outside it, and escape almost at once.
		expect(pixel(simulator.memory, 0, 0)).toBe(0x00104a)
		expect(pixel(simulator.memory, 0, 31)).toBe(0x00104a)
		expect(pixel(simulator.memory, 31, 0)).not.toBe(INTERIOR)
	})

	it('covers a plausible share of the view with the set', async () => {
		const simulator = await render()

		let interior = 0
		for (let row = 0; row < SIZE; row++) {
			for (let column = 0; column < SIZE; column++) {
				if (pixel(simulator.memory, column, row) === INTERIOR) interior++
			}
		}
		// The set fills roughly a quarter of this view at 16 iterations.
		expect(interior).toBeGreaterThan(SIZE * SIZE * 0.15)
		expect(interior).toBeLessThan(SIZE * SIZE * 0.4)
	})

	it('renders a shape symmetric about the real axis', async () => {
		const simulator = await render()

		// y runs from -1.25, so row 16 sits on y = 0 and row r mirrors row 32 - r.
		for (let row = 1; row < SIZE / 2; row++) {
			for (let column = 0; column < SIZE; column++) {
				expect(pixel(simulator.memory, column, row)).toBe(pixel(simulator.memory, column, SIZE - row))
			}
		}
	})
})
