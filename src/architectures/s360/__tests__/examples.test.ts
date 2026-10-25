import { describe, expect, it } from 'vitest'
import definition from '../index'
import { variantOf } from '../../contracts'
import { architectureVariants } from '../../__tests__/helpers'
import { pixelColor } from '../../../components/bitmapPixels'
import { RGB32_LE } from '../../../core/bitmapFormats'
import { load, MODEL_30, run } from './helpers'

const PALETTE = [
	0x000030, 0x00104a, 0x001f66, 0x003080, 0x0044a0, 0x0059bd, 0x1a72d4, 0x3d8ce0,
	0x62a6ea, 0x86bff2, 0xa8d5f7, 0xc6e6fb, 0xdef1fd, 0xeff8fe, 0xf8fcff, 0xffffff, 0x000000,
]

describe('System/360 examples', () => {
	const variants = architectureVariants(definition)

	it('offers six variants, with the floating-point examples only where the feature is installed', () => {
		expect(variants).toHaveLength(6)
		for (const settings of variants) {
			const examples = variantOf(definition, settings).examples
			const float = settings.cpuModel !== '360-30' || settings.floatingPoint !== false
			expect(examples.mandelbrot.code.split('\n')[2], JSON.stringify(settings)).toMatch(float ? /^\* FPU: floating-point feature/ : /^\* FPU: none/)
			expect(Object.keys(examples).includes('floatingpoint'), JSON.stringify(settings)).toBe(float)
		}
	})

	it('runs every example on every variant that offers it', async () => {
		for (const settings of variants) {
			for (const [id, example] of Object.entries(variantOf(definition, settings).examples)) {
				const machine = await load(example.code, settings)
				run(machine, 2_000_000)
				if (machine.pendingInput) { machine.provideInput('5'); run(machine) }
				expect(machine.halted, `${id} ${JSON.stringify(settings)}`).toBe(true)
				expect(machine.callStack, id).toEqual([])
				if (id === 'ackermann') expect(machine.console).toBe('61')
				if (id === 'floatingpoint') expect(machine.console).toBe('3142 0.1 + 0.2 = 0.3')
				if (id === 'factorial') expect(machine.console).toBe('120')
			}
		}
	}, 60_000)

	it('draws the floating-point Mandelbrot set like the double-precision reference', async () => {
		const machine = await load(variantOf(definition, { ...MODEL_30, floatingPoint: true }).examples.mandelbrot.code, { ...MODEL_30, floatingPoint: true })
		run(machine, 10_000_000)
		expect(machine.halted).toBe(true)
		const memory = machine.inspectMemory(), actual: (number | undefined)[] = [], expected: number[] = []
		for (let row = 0; row < 32; row++) for (let col = 0; col < 32; col++) {
			const cx = -2 + col * 2.5 / 32, cy = -1.25 + row * 2.5 / 32
			let x = 0, y = 0, iteration = 0
			for (; iteration < 16; iteration++) {
				const xx = x * x, yy = y * y
				if (xx + yy > 4) break
				y = 2 * x * y + cy
				x = xx - yy + cx
			}
			expected.push(PALETTE[iteration])
			actual.push(pixelColor(memory, 0x10000 + (row * 32 + col) * 4, RGB32_LE))
		}
		expect(actual).toEqual(expected)
	}, 30_000)

	it('follows the shared Mandelbrot header', () => {
		for (const floatingPoint of [false, true]) {
			const code = variantOf(definition, { ...MODEL_30, floatingPoint }).examples.mandelbrot.code.split('\n')
			expect(code[0]).toBe('* Mandelbrot Set')
			expect(code[1]).toMatch(/^\* CPU: /)
			expect(code[2]).toMatch(/^\* FPU: /)
			expect(code[3]).toBe('* 32 x 32 pixels, 16 iterations, x in [-2.0, 0.5), y in [-1.25, 1.25)')
		}
	})
})
