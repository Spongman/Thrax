import { describe, expect, it } from 'vitest'
import { assembleA64 } from '../a64/assembler'
import { STEP_HALT, STEP_WAIT } from '../a64/cpu'
import { DATA_BASE, TEXT_BASE } from '../a64/layout'
import { A64Machine } from '../a64/machine'
import { EXAMPLES, FIXED_EXAMPLES } from '../examples'
import { MANDELBROT_PALETTE, mipsMandelbrotCounts, modelMandelbrotCounts } from './mandelbrotReference'

/** Console output of each example that runs to its exit by itself. */
const OUTPUT: Record<string, string> = {
	hello: 'Hello, THRAX!\n',
	sum: '8\n',
	factorial: '120',
	bigFactorial: '20! = 2432902008176640000\n',
	fibonacci: '55',
	ackermann: 'A(3, 3) = 61',
	loop: '1 2 3 4 5 \n',
	bitwise: '8 14 6',
	bitmap: '',
	macros: 'counting: 12345\n123\n',
	mandelbrot: '',
	floatingpoint: 'sqrt(2) = 1.414\npi * 2.5^2 = 19.635\n1 / 3 = 0.333\nfrintn(-7.5) = -8.000\n',
}

function load(key: string, examples = EXAMPLES): A64Machine {
	const floatingPoint = examples === EXAMPLES
	const result = assembleA64({ name: `${key}.s`, code: examples[key].code }, { floatingPoint })
	expect(result.diagnostics).toEqual([])
	const machine = new A64Machine({ memoryBytes: 4 << 20, floatingPoint })
	machine.load(result.image!)
	return machine
}

const pixel = (machine: A64Machine, index: number) => new DataView(machine.cpu.memory.buffer).getUint32(DATA_BASE - TEXT_BASE + index * 4, true)

describe('ARMv8 examples', () => {
	it('all assemble', () => {
		for (const [key, example] of Object.entries(EXAMPLES)) {
			expect(assembleA64({ name: `${key}.s`, code: example.code }).diagnostics, key).toEqual([])
		}
		// Without floating point, the fixed-point set still assembles.
		for (const [key, example] of Object.entries(FIXED_EXAMPLES)) {
			expect(assembleA64({ name: `${key}.s`, code: example.code }, { floatingPoint: false }).diagnostics, key).toEqual([])
		}
	})

	it('offers the FP examples only with floating point on', () => {
		expect(Object.keys(EXAMPLES).sort()).toEqual([...Object.keys(FIXED_EXAMPLES), 'floatingpoint'].sort())
		expect(FIXED_EXAMPLES.mandelbrot.code).toMatch(/16\.16 fixed point/)
		expect(EXAMPLES.mandelbrot.code).toMatch(/single precision/)
		expect(assembleA64({ name: 'm.s', code: EXAMPLES.mandelbrot.code }, { floatingPoint: false }).diagnostics.length).toBeGreaterThan(0)
	})

	it.each(Object.keys(OUTPUT))('runs %s to its exit', (key) => {
		const machine = load(key)
		expect(machine.run(2_000_000)).toBe(STEP_HALT)
		expect(machine.linux.exitCode).toBe(0)
		expect(machine.linux.output).toBe(OUTPUT[key])
	})

	it('draws the gradient', () => {
		const machine = load('bitmap')
		machine.run(100_000)
		// Row 2, column 3: red 2 << 19, blue 3 << 3.
		expect(pixel(machine, 2 * 32 + 3)).toBe((2 << 19) | (3 << 3))
	})

	it('draws the fixed-point Mandelbrot set with floating point off', () => {
		const machine = load('mandelbrot', FIXED_EXAMPLES)
		expect(machine.run(2_000_000)).toBe(STEP_HALT)
		// The middle row at -0.5 is in the set: black.
		expect(pixel(machine, 16 * 32 + 16)).toBe(0)
		// The top-left corner, -2 - 1.5i, escapes at once.
		expect(pixel(machine, 0)).toBe(0x00104a)
	})

	it('draws the floating-point Mandelbrot set exactly as the MIPS example does', () => {
		const machine = load('mandelbrot')
		expect(machine.run(2_000_000)).toBe(STEP_HALT)
		expect(machine.linux.exitCode).toBe(0)
		const counts = mipsMandelbrotCounts()
		// The recorded MIPS picture is what single-precision arithmetic gives.
		expect(modelMandelbrotCounts()).toEqual(counts)
		const drawn = counts.map((_, index) => MANDELBROT_PALETTE.indexOf(pixel(machine, index)))
		expect(drawn).toEqual(counts)
	})

	it('echoes a typed line', () => {
		const machine = load('input')
		expect(machine.run(100)).toBe(STEP_WAIT)
		machine.linux.feed('hello, arm\n')
		expect(machine.run(100)).toBe(STEP_HALT)
		expect(machine.linux.output).toBe('hello, arm\n')
	})

	it('echoes queued keys to the display', () => {
		const machine = load('mmio')
		machine.keyboard.queued = 'hi.'
		expect(machine.run(1000)).toBe(STEP_HALT)
		expect(machine.keyboard.display).toBe('hi.')
	})
})
