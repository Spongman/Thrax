import { describe, expect, it } from 'vitest'
import { DATA_BASE, TEXT_BASE } from '../../a64/layout'
import { STEP_HALT, STEP_WAIT } from '../cpu'
import { A32_EXAMPLES, A32_FIXED_EXAMPLES } from '../examples'
import { MANDELBROT_PALETTE, mipsMandelbrotCounts, modelMandelbrotCounts } from '../../__tests__/mandelbrotReference'
import { A32Machine } from '../machine'
import { assembleA32 } from '../state'

/** Console output of each example that runs to its exit by itself. */
const A32_OUTPUT: Record<string, string> = {
	hello: 'Hello, THRAX!\n',
	sum: '8\n',
	factorial: '120',
	fibonacci: '55',
	ackermann: 'A(3, 3) = 61',
	loop: '1 2 3 4 5 \n',
	bitwise: '8 14 6',
	bitfields: '86 3 2018915346 1920 16\n',
	bitmap: '',
	macros: 'counting: 12345\n123\n',
	mandelbrot: '',
	helloArmasm: 'Hello, THRAX!\n',
	factorialArmasm: '120',
}

const fileName = (key: string) => `${key}${key.endsWith('Armasm') ? '.armasm' : '.s'}`

/** Output of the examples only the floating-point set has. */
const FP_OUTPUT: Record<string, string> = {
	floatingpoint: 'sqrt(2) = 1.414\npi * 2.5^2 = 19.635\n1 / 3 = 0.333\nround(2.5) = 2, round(3.5) = 4\n',
}

function load(key: string, examples = A32_FIXED_EXAMPLES): A32Machine {
	const result = assembleA32({ name: fileName(key), code: examples[key].code })
	expect(result.diagnostics).toEqual([])
	const machine = new A32Machine({ memoryBytes: 4 << 20 })
	machine.load(result.image!)
	return machine
}

const pixel = (machine: A32Machine, index: number) => new DataView(machine.cpu.memory.buffer).getUint32(DATA_BASE - TEXT_BASE + index * 4, true)

describe('AArch32 examples', () => {
	it('all assemble without warnings, fixed-point ones with floating point off', () => {
		for (const [key, example] of Object.entries(A32_EXAMPLES)) {
			expect(assembleA32({ name: fileName(key), code: example.code }).diagnostics, key).toEqual([])
		}
		for (const [key, example] of Object.entries(A32_FIXED_EXAMPLES)) {
			expect(assembleA32({ name: fileName(key), code: example.code }, [], 4 << 20, false).diagnostics, key).toEqual([])
		}
	})

	it('runs every example but the interactive ones', () => {
		expect(Object.keys(A32_FIXED_EXAMPLES).sort()).toEqual([...Object.keys(A32_OUTPUT), 'input', 'mmio'].sort())
		expect(Object.keys(A32_EXAMPLES).sort()).toEqual([...Object.keys(A32_FIXED_EXAMPLES), ...Object.keys(FP_OUTPUT)].sort())
	})

	it.each(Object.keys(FP_OUTPUT))('runs %s to its exit with floating point', (key) => {
		const machine = load(key, A32_EXAMPLES)
		expect(machine.run(2_000_000)).toBe(STEP_HALT)
		expect(machine.linux.exitCode).toBe(0)
		expect(machine.linux.output).toBe(FP_OUTPUT[key])
	})

	it('draws the floating-point Mandelbrot set exactly as the MIPS example does', () => {
		expect(A32_EXAMPLES.mandelbrot.code).not.toBe(A32_FIXED_EXAMPLES.mandelbrot.code)
		const machine = load('mandelbrot', A32_EXAMPLES)
		expect(machine.run(2_000_000)).toBe(STEP_HALT)
		expect(machine.linux.exitCode).toBe(0)
		const counts = mipsMandelbrotCounts()
		// The recorded MIPS picture is what single-precision arithmetic gives.
		expect(modelMandelbrotCounts()).toEqual(counts)
		const drawn = counts.map((_, index) => MANDELBROT_PALETTE.indexOf(pixel(machine, index)))
		expect(drawn).toEqual(counts)
	})

	it.each(Object.keys(A32_OUTPUT))('runs %s to its exit', (key) => {
		const machine = load(key)
		expect(machine.run(2_000_000)).toBe(STEP_HALT)
		expect(machine.linux.exitCode).toBe(0)
		expect(machine.linux.output).toBe(A32_OUTPUT[key])
	})

	it('draws the gradient', () => {
		const machine = load('bitmap')
		machine.run(100_000)
		expect(pixel(machine, 2 * 32 + 3)).toBe((2 << 19) | (3 << 3))
	})

	it('draws the Mandelbrot set as the AArch64 version does', () => {
		const machine = load('mandelbrot')
		machine.run(2_000_000)
		expect(pixel(machine, 16 * 32 + 16)).toBe(0)
		expect(pixel(machine, 0)).toBe(0x00104a)
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
