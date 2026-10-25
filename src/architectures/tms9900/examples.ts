import type { Example } from '../contracts'
import helloSource from './examples/hello.asm?raw'
import inputSource from './examples/input.asm?raw'
import sumSource from './examples/sum.asm?raw'
import factorialSource from './examples/factorial.asm?raw'
import fibonacciSource from './examples/fibonacci.asm?raw'
import loopSource from './examples/loop.asm?raw'
import bitwiseSource from './examples/bitwise.asm?raw'
import ackermannSource from './examples/ackermann.asm?raw'
import bitmapSource from './examples/bitmap.asm?raw'
import mandelbrotSource from './examples/mandelbrot.asm?raw'

/** Source programs are architecture-local text assets; this file holds metadata. */
export const examples: Readonly<Record<string, Example>> = {
	hello: {
		name: 'Hello, THRAX!',
		description: 'The educational XOP 15 monitor prints a zero-terminated string.',
		code: helloSource
	},
	input: {
		name: 'Interactive Input',
		description: 'Read and echo a signed 16-bit integer.',
		code: inputSource
	},
	sum: {
		name: 'Sum of Numbers',
		description: 'Native workspace registers add 3 and 5; prints 8.',
		code: sumSource
	},
	factorial: {
		name: 'Factorial',
		description: 'A BL/RT subroutine uses native MPY register pairs to compute 5! = 120.',
		code: factorialSource
	},
	fibonacci: {
		name: 'Fibonacci',
		description: 'Ten iterations compute F(10) = 55.',
		code: fibonacciSource
	},
	loop: {
		name: 'Loop Counter',
		description: 'Print 1 through 5 using native status-based jumps.',
		code: loopSource
	},
	bitwise: {
		name: 'Bitwise Operations',
		description: 'ANDI, SOC and XOR of 12 and 10 produce 8, 14 and 6.',
		code: bitwiseSource
	},
	ackermann: {
		name: 'Ackermann',
		description: 'Recursive BL calls explicitly save R11 and arguments on a software stack; A(3, 3) = 61.',
		code: ackermannSource
	},
	bitmap: {
		name: 'Bitmap Display',
		description: 'A 32 by 32 RGB gradient; byte transfers handle native big-endian workspace registers.',
		tools: ['bitmap'],
		code: bitmapSource
	},
	mandelbrot: {
		name: 'Mandelbrot Set',
		description: 'The common 32 by 32, 16-iteration fixed-point view using unsigned native MPY/DIV plus explicit signed arithmetic.',
		tools: ['bitmap'],
		code: mandelbrotSource
	}
}
