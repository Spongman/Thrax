import { describe, expect, it } from 'vitest'
import { BetaCpu, STEP_HALT, STEP_OK, STEP_WAIT } from '../cpu'
import { EXAMPLES } from '../examples'
import { BetaConsole, loadProgram } from '../machine'
import { assembleUasm } from '../uasm'

const LIMIT = 1_000_000

/** Assembles and runs `code` until HALT, feeding `input` when RDCHAR waits. */
function run(code: string, input = '') {
	const { image, diagnostics, directives } = assembleUasm({ name: 'example.uasm', code })
	expect(diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([])
	const cpu = new BetaCpu()
	const tty = new BetaConsole({ tty: directives.options.tty })
	cpu.privileged = tty
	loadProgram(cpu, image!)
	let status = STEP_OK
	let steps = 0
	for (; steps < LIMIT; steps++) {
		status = cpu.step()
		if (status === STEP_WAIT && input) {
			tty.feed(input)
			input = ''
			continue
		}
		if (status !== STEP_OK) break
	}
	return { cpu, tty, status, steps }
}

const OUTPUT: Record<string, string> = {
	input: 'hello, beta\n',
	hello: 'Hello, THRAX!\n',
	sum: '8\n',
	factorial: '120',
	fibonacci: '55',
	ackermann: 'A(3, 3) = 61',
	loop: '1 2 3 4 5 \n',
	bitwise: '8 14 6',
	bitmap: '',
	mandelbrot: '',
	macros: 'counting: 12345\n123\n',
}

/** TinyOS never halts; interrupts.test.ts runs it. */
const HALTING = Object.keys(EXAMPLES).filter((key) => !key.startsWith('tinyos'))

describe('Beta example programs', () => {
	it('ports the expected set', () => {
		expect(HALTING.sort()).toEqual(Object.keys(OUTPUT).sort())
	})

	it.each(HALTING)('runs %s to HALT with the MIPS original\'s output', (key) => {
		const { tty, status } = run(EXAMPLES[key].code, key === 'input' ? 'hello, beta\r' : '')
		expect(status).toBe(STEP_HALT)
		expect(tty.output).toBe(OUTPUT[key])
	})

	it('waits in RDCHAR until input arrives', () => {
		const { status, tty } = run(EXAMPLES.input.code)
		expect(status).toBe(STEP_WAIT)
		expect(tty.waiting).toBe(true)
		expect(tty.output).toBe('')
	})

	it('stops reading input when the buffer is full', () => {
		const { tty } = run(EXAMPLES.input.code, 'x'.repeat(100))
		expect(tty.output).toBe('x'.repeat(63))
	})

	it('draws the MIPS gradient, row << 19 | column << 3', () => {
		const { cpu } = run(EXAMPLES.bitmap.code)
		const pixel = (row: number, column: number) => cpu.readWord(0x1000 + 4 * (32 * row + column))
		for (const [row, column] of [[0, 0], [0, 31], [31, 0], [31, 31], [7, 12]]) {
			expect(pixel(row, column)).toBe((row << 19) | (column << 3))
		}
	})
})
