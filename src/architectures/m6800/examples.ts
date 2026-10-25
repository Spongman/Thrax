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
		description: 'Add 3 and 5 using the B accumulator.',
		code: sumSource
	},
	factorial: {
		name: 'Factorial',
		description: 'Calculate 5! by repeated addition with native 8-bit instructions.',
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
		description: 'Print a zero-terminated string using indexed addressing.',
		code: helloSource
	},
	input: {
		name: 'Interactive Input',
		description: 'Read and echo a signed 8-bit integer.',
		code: inputSource
	},
	ackermann: {
		name: 'Ackermann',
		description: 'Compute A(3, 3) = 61 with recursive JSR/RTS and a real hardware stack.',
		code: ackermannSource
	},
	bitmap: {
		name: 'Bitmap Display',
		description: 'Draw a 32 by 32 RGB gradient with explicit little-endian pixel bytes.',
		tools: ['bitmap'],
		bitmap: {
			kind: 'rgb32',
			littleEndian: true
		},
		code: bitmapSource
	}
}
