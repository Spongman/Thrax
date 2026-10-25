import type { Example } from '../../contracts'
import sumSource from './examples/sum.asm?raw'
import factorialSource from './examples/factorial.asm?raw'
import fibonacciSource from './examples/fibonacci.asm?raw'
import loopSource from './examples/loop.asm?raw'
import bitwiseSource from './examples/bitwise.asm?raw'
import helloSource from './examples/hello.asm?raw'
import inputSource from './examples/input.asm?raw'
import ackermannSource from './examples/ackermann.asm?raw'
import bitmapSource from './examples/bitmap.asm?raw'
import mandelbrotSource from './examples/mandelbrot.asm?raw'

/** Source programs are architecture-local text assets; this file holds metadata. */
export const examples: Readonly<Record<string, Example>> = {
	sum: {
		name: 'Sum of Numbers',
		description: 'Native 16-bit addition.',
		code: sumSource
	},
	factorial: {
		name: 'Factorial',
		description: 'Compute 5! with native repeated-addition multiplication.',
		code: factorialSource
	},
	fibonacci: {
		name: 'Fibonacci',
		description: 'Compute Fibonacci(10) with 16-bit registers.',
		code: fibonacciSource
	},
	loop: {
		name: 'Loop Counter',
		description: 'Print integers 1 through 5.',
		code: loopSource
	},
	bitwise: {
		name: 'Bitwise Operations',
		description: 'AND, OR and XOR on 12 and 10.',
		code: bitwiseSource
	},
	hello: {
		name: 'Hello, THRAX!',
		description: 'Print a zero-terminated string through the COP monitor.',
		code: helloSource
	},
	input: {
		name: 'Interactive Input',
		description: 'Read and echo a signed integer.',
		code: inputSource
	},
	ackermann: {
		name: 'Ackermann',
		description: 'Recursive JSR/RTS computes A(3, 3) = 61.',
		code: ackermannSource
	},
	bitmap: {
		name: 'Bitmap Display',
		description: '32 by 32 RGB gradient in RGB32 little-endian format.',
		tools: ['bitmap'],
		bitmap: {
			kind: 'rgb32',
			littleEndian: true
		},
		code: bitmapSource
	},
	mandelbrot: {
		name: 'Mandelbrot Set',
		description: 'Native fixed-point multiplication renders 32 by 32 pixels with 16 iterations.',
		tools: ['bitmap'],
		bitmap: {
			kind: 'rgb32',
			littleEndian: true
		},
		code: mandelbrotSource
	}
}
