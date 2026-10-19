import { describe, expect, it } from 'vitest'
import { EXAMPLES } from '../examples'
import { STEP_HALT } from '../machine'
import { machineFor, runToEnd } from './helpers'

/** What each example prints, given the input in INPUT. */
const OUTPUT: Record<string, string> = {
	input: 'hello, z80\n',
	hello: 'Hello, THRAX!\n',
	sum: '8\n',
	factorial: '120',
	fibonacci: '55',
	ackermann: 'A(3, 3) = 61',
	loop: '1 2 3 4 5 \n',
	bitwise: '8 14 6',
	bitmap: '',
	macros: 'counting: 12345\n123\n',
	keyboard: 'hi.',
	timer: '12345\n',
}

const INPUT: Record<string, string> = {
	input: 'hello, z80\n',
	keyboard: 'hi.',
}

describe('Z80 example programs', () => {
	it('ports the expected set', () => {
		expect(Object.keys(EXAMPLES).sort()).toEqual(Object.keys(OUTPUT).sort())
	})

	it.each(Object.keys(OUTPUT))('runs %s to its end', (key) => {
		const { machine } = machineFor(EXAMPLES[key].code)
		expect(runToEnd(machine, INPUT[key])).toBe(STEP_HALT)
		expect(machine.console.output).toBe(OUTPUT[key])
	})

	it('draws colour bands into the framebuffer, a byte a pixel', () => {
		const { machine } = machineFor(EXAMPLES.bitmap.code)
		runToEnd(machine)
		const pixel = (row: number, column: number) => machine.cpu.memory[0xC000 + row * 32 + column]
		expect(pixel(0, 0)).toBe(0)
		expect(pixel(0, 31)).toBe(15)
		expect(pixel(5, 7)).toBe(12)
		expect(pixel(31, 31)).toBe(14)
	})
})
