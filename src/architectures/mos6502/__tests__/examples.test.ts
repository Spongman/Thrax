import { describe, expect, it } from 'vitest'
import { assembleMos6502 } from '../assembler'
import { STEP_HALT, STEP_WAIT } from '../cpu'
import { EXAMPLES } from '../examples'
import { Mos6502Machine } from '../machine'

const LIMIT = 20_000_000

/**
 * Assembles and runs `code` until it halts or waits, feeding `input` the first
 * time it waits; `queued` is typed before it starts.
 */
function run(code: string, input = '', queued = '') {
	const { image, diagnostics } = assembleMos6502({ name: 'example.s', code })
	expect(diagnostics).toEqual([])
	const machine = new Mos6502Machine()
	machine.load(image!)
	machine.device.feed(queued)
	let status = machine.run(LIMIT)
	if (status === STEP_WAIT && input) {
		machine.device.feed(input)
		status = machine.run(LIMIT)
	}
	return { machine, status, output: machine.device.output }
}

const OUTPUT: Record<string, string> = {
	input: 'hello, 6502\n',
	hello: 'Hello, THRAX!\n',
	sum: '8\n',
	factorial: '120',
	fibonacci: '55',
	ackermann: 'A(3, 3) = 61',
	loop: '1 2 3 4 5 \n',
	bitwise: '8 14 6',
	bitmap: '',
	mmio: 'hi.',
	macros: 'counting: 12345\n123\n',
	interrupts: '.....\n',
	mandelbrot: '',
}

describe('6502 example programs', () => {
	it('ports the expected set', () => {
		expect(Object.keys(EXAMPLES).sort()).toEqual(Object.keys(OUTPUT).sort())
	})

	it.each(Object.keys(OUTPUT))('runs %s to a halt with the original\'s output', (key) => {
		const { status, output, machine } = run(EXAMPLES[key].code, key === 'input' ? 'hello, 6502\r' : '', key === 'mmio' ? 'hi.' : '')
		expect(status).toBe(STEP_HALT)
		expect(machine.halted).toBe(true)
		expect(output).toBe(OUTPUT[key])
	})

	it('waits at $F001 until input arrives', () => {
		const { status, machine, output } = run(EXAMPLES.input.code)
		expect(status).toBe(STEP_WAIT)
		expect(machine.device.waiting).toBe(true)
		expect(output).toBe('')
	})

	it('stops reading input when the buffer is full', () => {
		expect(run(EXAMPLES.input.code, 'x'.repeat(100)).output).toBe('x'.repeat(63))
	})

	it('draws bands of (row + column) / 4', () => {
		const { machine } = run(EXAMPLES.bitmap.code)
		const pixel = (row: number, column: number) => machine.cpu.memory[0x0200 + 32 * row + column]
		for (const [row, column] of [[0, 0], [0, 31], [31, 0], [31, 31], [7, 12]]) expect(pixel(row, column)).toBe(((row + column) >> 2) & 15)
	})

	it('draws the Mandelbrot set: black inside, the corner escaping at once', () => {
		const { machine } = run(EXAMPLES.mandelbrot.code)
		const pixels = machine.cpu.memory.subarray(0x0200, 0x0600)
		// c = -0.52 + 0i is inside; c = -2 - 1.25i escapes after one iteration.
		expect(pixels[32 * 16 + 19]).toBe(0)
		expect(pixels[0]).toBe(1)
		const inside = pixels.filter((pixel) => pixel === 0).length
		expect(inside).toBeGreaterThan(150)
		expect(inside).toBeLessThan(400)
		// The set is symmetric about the real axis, row 16; the fixed point keeps most of that.
		let mirrored = 0
		for (let row = 1; row < 16; row++) for (let column = 0; column < 32; column++) if (pixels[32 * (16 - row) + column] === pixels[32 * (16 + row) + column]) mirrored++
		expect(mirrored).toBeGreaterThan(15 * 32 * 0.9)
	})

	it('takes five timer interrupts in the interrupts example', () => {
		const { machine } = run(EXAMPLES.interrupts.code)
		expect(machine.cpu.memory[0x10]).toBe(5)
		expect(machine.exitCode).toBe(0)
	})
})
