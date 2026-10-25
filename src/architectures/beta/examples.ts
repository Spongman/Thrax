import type { Example } from '../contracts'
import mandelbrotSource from './examples/mandelbrot.uasm?raw'
import inputSource from './examples/input.uasm?raw'
import helloSource from './examples/hello.uasm?raw'
import sumSource from './examples/sum.uasm?raw'
import factorialSource from './examples/factorial.uasm?raw'
import fibonacciSource from './examples/fibonacci.uasm?raw'
import ackermannSource from './examples/ackermann.uasm?raw'
import loopSource from './examples/loop.uasm?raw'
import bitwiseSource from './examples/bitwise.uasm?raw'
import bitmapSource from './examples/bitmap.uasm?raw'
import macrosSource from './examples/macros.uasm?raw'
import tinyosSource from './examples/tinyos.uasm?raw'
import tinyosSolvedSource from './examples/tinyos-solved.uasm?raw'
import tinyosStubSource from './examples/tinyos-stub.uasm?raw'
import tinyosSolutionSource from './examples/tinyos-solution.uasm?raw'

/** Source programs are architecture-local text assets; this file holds metadata. */
export function solveTinyOs(source: string) {
	// A CRLF checkout must still match the stub.
	const code = source.replace(/\r\n?/g, '\n')
	if (!code.includes(tinyosStubSource)) throw new Error('TinyOS MapUserAddress stub not found')
	return code.replace(tinyosStubSource, tinyosSolutionSource)
}

export const EXAMPLES: Readonly<Record<string, Example>> = {
	mandelbrot: {
		name: 'Mandelbrot Set',
		description: 'Escape-time fractal in signed 8.8 fixed point, drawn to the Bitmap Display.',
		tools: ['bitmap'],
		code: mandelbrotSource
	},
	input: {
		name: 'Interactive Input',
		description: 'Read a line with RDCHAR into a buffer, then print it',
		code: inputSource
	},
	hello: {
		name: 'Hello, THRAX!',
		description: 'Print a string stored after the code with a WRCHAR loop',
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
		description: 'Demonstrate AND, OR, XOR operations',
		code: bitwiseSource
	},
	bitmap: {
		tools: ['bitmap'],
		name: 'Bitmap Display',
		description: 'Draw a colour gradient for the Bitmap Display tool',
		code: bitmapSource
	},
	macros: {
		name: 'Macros',
		description: 'Define once, use many times with .macro and symbols',
		code: macrosSource
	},
	tinyos: {
		name: 'TinyOS',
		description: 'The 6.004 lab kernel, as handed out: implement MapUserAddress (Design Problem 1) to run its processes (CC BY 4.0)',
		code: tinyosSource
	},
	tinyosSolved: {
		name: 'TinyOS (solved)',
		description: 'The 6.004 lab kernel with MapUserAddress filled in: clock and keyboard interrupts, segmentation and two processes (CC BY 4.0)',
		code: tinyosSolvedSource
	}
}
