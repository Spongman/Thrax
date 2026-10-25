import type { Example } from '../contracts'
import inputSource from './examples/input.asm?raw'
import helloSource from './examples/hello.asm?raw'
import sumSource from './examples/sum.asm?raw'
import factorialSource from './examples/factorial.asm?raw'
import fibonacciSource from './examples/fibonacci.asm?raw'
import ackermannSource from './examples/ackermann.asm?raw'
import loopSource from './examples/loop.asm?raw'
import coprocessorSource from './examples/coprocessor.asm?raw'
import bitwiseSource from './examples/bitwise.asm?raw'
import bitmapSource from './examples/bitmap.asm?raw'
import mmioSource from './examples/mmio.asm?raw'
import macrosSource from './examples/macros.asm?raw'
import mandelbrotSource from './examples/mandelbrot.asm?raw'

/** Source programs are architecture-local text assets; this file holds metadata. */
export const EXAMPLES: Readonly<Record<string, Example>> = {
	input: {
		name: 'Interactive Input',
		description: 'Read and echo a string using syscall 8',
		code: inputSource
	},
	hello: {
		name: 'Hello, THRAX!',
		description: 'Print a string stored in the data segment',
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
	coprocessors: {
		name: 'Coprocessors',
		description: 'Floating-point math on CP1 and a CP0 register read',
		code: coprocessorSource
	},
	bitwise: {
		name: 'Bitwise Operations',
		description: 'Demonstrate AND, OR, XOR operations',
		code: bitwiseSource
	},
	bitmap: {
		tools: ['bitmap'],
		name: 'Bitmap Display',
		description: 'Draw a colour gradient for the Bitmap Display tool',
		code: bitmapSource
	},
	mmio: {
		tools: ['keyboardDisplay'],
		name: 'Keyboard and Display',
		description: 'Echo queued keystrokes through the MMIO tool',
		code: mmioSource
	},
	macros: {
		name: 'Macros',
		description: 'Define once, use many times with .macro and .eqv',
		code: macrosSource
	},
	mandelbrot: {
		tools: ['bitmap'],
		name: 'Mandelbrot Set',
		description: 'Escape-time fractal on coprocessor 1, drawn to the Bitmap Display',
		code: mandelbrotSource
	}
}
