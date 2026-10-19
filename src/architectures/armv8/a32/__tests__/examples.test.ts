import { describe, expect, it } from 'vitest'
import { DATA_BASE, TEXT_BASE } from '../../a64/layout'
import { STEP_HALT, STEP_WAIT } from '../cpu'
import { A32_EXAMPLES } from '../examples'
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

function load(key: string): A32Machine {
	const result = assembleA32({ name: fileName(key), code: A32_EXAMPLES[key].code })
	expect(result.diagnostics).toEqual([])
	const machine = new A32Machine({ memoryBytes: 4 << 20 })
	machine.load(result.image!)
	return machine
}

const pixel = (machine: A32Machine, index: number) => new DataView(machine.cpu.memory.buffer).getUint32(DATA_BASE - TEXT_BASE + index * 4, true)

describe('AArch32 examples', () => {
	it('all assemble without warnings', () => {
		for (const [key, example] of Object.entries(A32_EXAMPLES)) {
			expect(assembleA32({ name: fileName(key), code: example.code }).diagnostics, key).toEqual([])
		}
	})

	it('runs every example but the interactive ones', () => {
		expect(Object.keys(A32_EXAMPLES).sort()).toEqual([...Object.keys(A32_OUTPUT), 'input', 'mmio'].sort())
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
		expect(pixel(machine, 0)).toBe((1 << 19) | (1 << 3))
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
