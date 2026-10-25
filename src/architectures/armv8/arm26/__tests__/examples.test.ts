import { describe, expect, it } from 'vitest'
import { DIALECT_ARMASM, DIALECT_GNU } from '../../shared/assembler/dialect'
import { assembleArm26 } from '../assemble'
import { STEP_HALT, STEP_WAIT } from '../cpu'
import { EXAMPLES } from '../examples'
import { Arm26Machine } from '../machine'

const LIMIT = 1_000_000

/** Assembles `code` as an untitled file and runs it until it halts or waits. */
function run(code: string, input = '', keys = '') {
	const { image, diagnostics, dialect } = assembleArm26({ name: 'untitled.asm', code })
	expect(diagnostics).toEqual([])
	const machine = new Arm26Machine({ memoryBytes: 1 << 20 })
	machine.load(image!)
	machine.keyboard.queue(keys)
	let status = machine.run(LIMIT)
	if (status === STEP_WAIT && input) {
		machine.os.feed(input)
		status = machine.run(LIMIT)
	}
	return { machine, status, dialect }
}

const OUTPUT: Record<string, string> = {
	prefetch: '12',
	input: 'hello, arm\n',
	hello: 'Hello, THRAX!\n',
	sum: '8\n',
	factorial: '120',
	fibonacci: '55',
	ackermann: 'A(3, 3) = 61',
	loop: '1 2 3 4 5 \n',
	bitwise: '8 14 6',
	bitmap: '',
	mandelbrot: '',
	mmio: 'hi.',
	macros: 'counting: 12345\n123\n',
	keyboard: 'hi.',
	helloArmasm: 'Hello, THRAX!\n',
	factorialArmasm: '120',
}

describe('ARM26 example programs', () => {
	it('includes the common programs, dialect examples and prefetch demonstration', () => {
		expect(Object.keys(EXAMPLES).sort()).toEqual(Object.keys(OUTPUT).sort())
	})

	it.each(Object.keys(OUTPUT))('runs %s to OS_Exit with the expected output', (key) => {
		const { machine, status } = run(EXAMPLES[key].code, key === 'input' ? 'hello, arm\n' : '', key === 'keyboard' || key === 'mmio' ? 'hi.' : '')
		expect(status).toBe(STEP_HALT)
		expect(machine.os.output).toBe(OUTPUT[key])
	})

	it('reads the armasm examples as armasm and the rest as GNU, whatever the file name', () => {
		for (const [key, example] of Object.entries(EXAMPLES)) {
			expect(run(example.code, 'x\n', '.').dialect).toBe(key.endsWith('Armasm') ? DIALECT_ARMASM : DIALECT_GNU)
		}
	})

	it('waits in OS_ReadC until input arrives, and stops at a full buffer', () => {
		const waiting = run(EXAMPLES.input.code)
		expect(waiting.status).toBe(STEP_WAIT)
		expect(waiting.machine.os.waiting).toBe(true)
		expect(run(EXAMPLES.input.code, 'x'.repeat(100)).machine.os.output).toBe('x'.repeat(63))
	})

	it('draws the gradient, row << 19 | column << 3', () => {
		const { machine } = run(EXAMPLES.bitmap.code)
		const pixel = (row: number, column: number) => machine.cpu.readWord(0x10000 + 4 * (32 * row + column))
		for (const [row, column] of [[0, 0], [0, 31], [31, 0], [31, 31], [7, 12]]) {
			expect(pixel(row, column)).toBe((row << 19) | (column << 3))
		}
	})

	it('echoes keys to the display from the IRQ handler, in IRQ mode', () => {
		const { machine } = run(EXAMPLES.keyboard.code, '', 'ok.')
		expect(machine.keyboard.display).toBe('ok.')
		expect(machine.cpu.mode).toBe(2)
	})
})
