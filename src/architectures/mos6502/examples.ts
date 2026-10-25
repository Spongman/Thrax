import type { Example } from '../contracts'
import cmosPrimerSource from './examples/cmos-primer.asm?raw'
import inputSource from './examples/input.asm?raw'
import helloSource from './examples/hello.asm?raw'
import sumSource from './examples/sum.asm?raw'
import factorialSource from './examples/factorial.asm?raw'
import fibonacciSource from './examples/fibonacci.asm?raw'
import ackermannSource from './examples/ackermann.asm?raw'
import loopSource from './examples/loop.asm?raw'
import bitwiseSource from './examples/bitwise.asm?raw'
import bitmapSource from './examples/bitmap.asm?raw'
import mmioSource from './examples/mmio.asm?raw'
import macrosSource from './examples/macros.asm?raw'
import interruptsSource from './examples/interrupts.asm?raw'
import mandelbrotSource from './examples/mandelbrot.asm?raw'
import undocumentedSource from './examples/undocumented.asm?raw'

/** Source programs are architecture-local text assets; this file holds metadata. */
export const cmosPrimer: Example = {
	name: 'W65C02S Instructions',
	description: 'CMOS zero store, memory bits, stack registers and accumulator increment.',
	code: cmosPrimerSource
}

export const EXAMPLES: Readonly<Record<string, Example>> = {
	input: {
		name: 'Interactive Input',
		description: 'Read a line from $F001 into a buffer, then print it',
		code: inputSource
	},
	hello: {
		name: 'Hello, THRAX!',
		description: 'Print a string stored after the code, a byte at a time',
		code: helloSource
	},
	sum: {
		name: 'Sum of Numbers',
		description: 'Add 5 + 3 and print the result',
		code: sumSource
	},
	factorial: {
		name: 'Factorial',
		description: 'Compute 5! (5 factorial) = 120',
		code: factorialSource
	},
	fibonacci: {
		name: 'Fibonacci',
		description: 'Compute the 10th Fibonacci number',
		code: fibonacciSource
	},
	ackermann: {
		name: 'Ackermann',
		description: 'Deep recursion: compute A(3, 3) = 61',
		code: ackermannSource
	},
	loop: {
		name: 'Loop Counter',
		description: 'Print numbers from 1 to 5',
		code: loopSource
	},
	bitwise: {
		name: 'Bitwise Operations',
		description: 'Demonstrate AND, ORA and EOR',
		code: bitwiseSource
	},
	bitmap: {
		tools: ['bitmap'],
		name: 'Bitmap Display',
		description: 'Draw colour bands for the Bitmap Display tool',
		code: bitmapSource
	},
	mmio: {
		tools: ['keyboardDisplay'],
		name: 'Keyboard and Display',
		description: 'Echo queued keystrokes through the I/O page',
		code: mmioSource
	},
	macros: {
		name: 'Macros',
		description: 'Define once, use many times with .macro and symbols',
		code: macrosSource
	},
	interrupts: {
		tools: ['keyboardDisplay'],
		name: 'Interrupts',
		description: 'Timer and keyboard IRQs: a dot per tick, typed keys echoed, five ticks then exit',
		code: interruptsSource
	},
	mandelbrot: {
		tools: ['bitmap'],
		bitmapPalette: [48, 4170, 8038, 12416, 17568, 22973, 1733332, 4033760, 6465258, 8830962, 11064823, 13035259, 14610941, 15726846, 16317695, 16777215, 0],
		name: 'Mandelbrot Set',
		description: 'Escape-time fractal in 8.8 fixed point, drawn to the Bitmap Display',
		code: mandelbrotSource
	},
	undocumented: {
		name: 'NMOS Undocumented Instructions',
		description: 'Compound loads, stores and arithmetic produce 42; JAM stops until reset or rewind.',
		code: undocumentedSource
	}
}

export const CMOS_EXAMPLES: Readonly<Record<string, Example>> = {
	input: {
		name: 'Interactive Input',
		description: 'Read a line from $F001 into a buffer, then print it',
		code: inputSource
	},
	hello: {
		name: 'Hello, THRAX!',
		description: 'Print a string stored after the code, a byte at a time',
		code: helloSource
	},
	sum: {
		name: 'Sum of Numbers',
		description: 'Add 5 + 3 and print the result',
		code: sumSource
	},
	factorial: {
		name: 'Factorial',
		description: 'Compute 5! (5 factorial) = 120',
		code: factorialSource
	},
	fibonacci: {
		name: 'Fibonacci',
		description: 'Compute the 10th Fibonacci number',
		code: fibonacciSource
	},
	ackermann: {
		name: 'Ackermann',
		description: 'Deep recursion: compute A(3, 3) = 61',
		code: ackermannSource
	},
	loop: {
		name: 'Loop Counter',
		description: 'Print numbers from 1 to 5',
		code: loopSource
	},
	bitwise: {
		name: 'Bitwise Operations',
		description: 'Demonstrate AND, ORA and EOR',
		code: bitwiseSource
	},
	bitmap: {
		tools: ['bitmap'],
		name: 'Bitmap Display',
		description: 'Draw colour bands for the Bitmap Display tool',
		code: bitmapSource
	},
	mmio: {
		tools: ['keyboardDisplay'],
		name: 'Keyboard and Display',
		description: 'Echo queued keystrokes through the I/O page',
		code: mmioSource
	},
	macros: {
		name: 'Macros',
		description: 'Define once, use many times with .macro and symbols',
		code: macrosSource
	},
	interrupts: {
		tools: ['keyboardDisplay'],
		name: 'Interrupts',
		description: 'Timer and keyboard IRQs: a dot per tick, typed keys echoed, five ticks then exit',
		code: interruptsSource
	},
	mandelbrot: {
		tools: ['bitmap'],
		bitmapPalette: [48, 4170, 8038, 12416, 17568, 22973, 1733332, 4033760, 6465258, 8830962, 11064823, 13035259, 14610941, 15726846, 16317695, 16777215, 0],
		name: 'Mandelbrot Set',
		description: 'Escape-time fractal in 8.8 fixed point, drawn to the Bitmap Display',
		code: mandelbrotSource
	},
	cmos: {
		name: 'W65C02S Instructions',
		description: 'CMOS zero store, memory bits, stack registers and accumulator increment.',
		code: cmosPrimerSource
	}
}
