import type { Example } from '../contracts'
import mandelbrotSource from './examples/mandelbrot.asm?raw'
import sumSource from './examples/sum.asm?raw'
import factorialSource from './examples/factorial.asm?raw'
import fibonacciSource from './examples/fibonacci.asm?raw'
import loopSource from './examples/loop.asm?raw'
import bitwiseSource from './examples/bitwise.asm?raw'
import helloSource from './examples/hello.asm?raw'
import inputSource from './examples/input.asm?raw'
import ackermannSource from './examples/ackermann.asm?raw'
import bitmapSource from './examples/bitmap.asm?raw'

/** Source programs are architecture-local text assets; this file holds metadata. */
export const EXAMPLES: Readonly<Record<string, Example>> = {
	mandelbrot: {
		name: 'Mandelbrot Set',
		description: '32 by 32 Mandelbrot, signed Q8 arithmetic, 16 iterations and the MIPS palette.',
		tools: ['bitmap'],
		bitmap: {
			kind: 'rgb32',
			littleEndian: true
		},
		code: mandelbrotSource
	},
	sum: {
		name: 'Sum of Numbers',
		description: 'Add 3 and 5 with the accumulator.',
		code: sumSource
	},
	factorial: {
		name: 'Factorial',
		description: 'Compute 5! with the native MUL AB instruction.',
		code: factorialSource
	},
	fibonacci: {
		name: 'Fibonacci',
		description: 'Calculate the tenth Fibonacci number.',
		code: fibonacciSource
	},
	loop: {
		name: 'Loop Counter',
		description: 'Print the integers 1 through 5.',
		code: loopSource
	},
	bitwise: {
		name: 'Bitwise Operations',
		description: 'AND, OR and XOR on 12 and 10.',
		code: bitwiseSource
	},
	hello: {
		name: 'Hello, THRAX!',
		description: 'Read a zero-terminated string from code space with MOVC.',
		code: helloSource
	},
	input: {
		name: 'Interactive Input',
		description: 'Read and echo a signed 16-bit integer.',
		code: inputSource
	},
	ackermann: {
		name: 'Ackermann',
		description: 'Compute A(3, 3) = 61 recursively, using A(1, n) = n + 2 to keep the native 128-byte stack in range.',
		code: ackermannSource
	},
	bitmap: {
		name: 'Bitmap Display',
		description: 'Draw a 32 by 32 RGB gradient through native MOVX writes to XDATA.',
		tools: ['bitmap'],
		bitmap: {
			kind: 'rgb32',
			littleEndian: true
		},
		code: bitmapSource
	}
}
