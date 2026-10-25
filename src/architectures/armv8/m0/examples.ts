import type { Example } from '../../contracts'
import mandelbrotSource from './examples/mandelbrot.asm?raw'
import ackermannSource from './examples/ackermann.asm?raw'
import helloSource from './examples/hello.asm?raw'
import sumSource from './examples/sum.asm?raw'
import factorialSource from './examples/factorial.asm?raw'
import fibonacciSource from './examples/fibonacci.asm?raw'
import loopSource from './examples/loop.asm?raw'
import bitwiseSource from './examples/bitwise.asm?raw'
import inputSource from './examples/input.asm?raw'
import bitmapSource from './examples/bitmap.asm?raw'

/** Source programs are architecture-local text assets; this file holds metadata. */
export const EXAMPLES: Readonly<Record<string, Example>> = {
	mandelbrot: {
		name: 'Mandelbrot Set',
		description: 'Thumb multiplication draws the 32 by 32 Mandelbrot view in signed 8.8 fixed point.',
		tools: ['bitmap'],
		code: mandelbrotSource
	},
	ackermann: {
		name: 'Ackermann',
		description: 'Nested Thumb calls and stack frames compute and print A(3, 3) = 61.',
		code: ackermannSource
	},
	hello: {
		name: 'Hello, THRAX!',
		description: 'Print a message with the Cortex-M0 teaching console.',
		code: helloSource
	},
	sum: {
		name: 'Sum of Numbers',
		description: 'Add 5 and 3 using Thumb integer arithmetic.',
		code: sumSource
	},
	factorial: {
		name: 'Factorial',
		description: 'Calculate 5! using multiplication and a conditional loop.',
		code: factorialSource
	},
	fibonacci: {
		name: 'Fibonacci',
		description: 'Find Fibonacci number 10 by keeping the previous two values.',
		code: fibonacciSource
	},
	loop: {
		name: 'Loop Counter',
		description: 'Print the integers from 1 through 5 with a conditional branch.',
		code: loopSource
	},
	bitwise: {
		name: 'Bitwise Operations',
		description: 'Compare the AND, OR and XOR of 12 and 10.',
		code: bitwiseSource
	},
	input: {
		name: 'Interactive Input',
		description: 'Read and echo a signed integer with the teaching console.',
		code: inputSource
	},
	bitmap: {
		name: 'Bitmap Display',
		description: 'Draw the common 32 by 32 red/blue gradient using Thumb stores and shifts.',
		tools: ['bitmap'],
		code: bitmapSource
	}
}
