import type { Example } from '../contracts'
import mandelbrotSource from './examples/mandelbrot.asm?raw'
import ackermannSource from './examples/ackermann.asm?raw'
import bitmapSource from './examples/bitmap.asm?raw'
import sumSource from './examples/sum.asm?raw'
import factorialSource from './examples/factorial.asm?raw'
import fibonacciSource from './examples/fibonacci.asm?raw'
import loopSource from './examples/loop.asm?raw'
import bitwiseSource from './examples/bitwise.asm?raw'
import callSource from './examples/call.asm?raw'

/** Source programs are architecture-local text assets; this file holds metadata. */
export const examples: Readonly<Record<string, Example>> = {
	mandelbrot: {
		name: 'Mandelbrot Set',
		description: 'Four byte multiplies form each signed 8.8 product; a 32 by 32 RGB fractal fills SRAM.',
		tools: ['bitmap'],
		code: mandelbrotSource
	},
	ackermann: {
		name: 'Ackermann',
		description: 'Nested recursive calls compute A(3, 3) = 61 in r16 and SRAM at debugger 0x10100.',
		code: ackermannSource
	},
	bitmap: {
		tools: ['bitmap'],
		name: 'Bitmap Display',
		description: 'Draw the common 32 by 32 red/blue gradient in SRAM at debugger address 0x10100.',
		code: bitmapSource
	},
	sum: {
		name: 'Sum of Numbers',
		description: 'Add 5 and 3; the result 8 remains in r17.',
		code: sumSource
	},
	factorial: {
		name: 'Factorial',
		description: 'Compute 5! using MUL; the result 120 remains in r16.',
		code: factorialSource
	},
	fibonacci: {
		name: 'Fibonacci',
		description: 'Compute Fibonacci(10); the result 55 remains in r16.',
		code: fibonacciSource
	},
	loop: {
		name: 'Loop Counter',
		description: 'Store 1 through 5 in SRAM at hardware 0x100 (debugger 0x10100).',
		code: loopSource
	},
	bitwise: {
		name: 'Bitwise Operations',
		description: 'Combine 12 and 10; AND = 8 in r18, OR = 14 in r19, XOR = 6 in r20.',
		code: bitwiseSource
	},
	call: {
		name: 'Subroutine and SRAM',
		description: 'Harvard data, pointer addressing, stack and a subroutine.',
		code: callSource
	}
}
