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
import floatingPointSource from './examples/floatingpoint.asm?raw'

/** Source programs are architecture-local text assets; this file holds metadata. */
export const examples: Readonly<Record<string, Example>> = {
	hello: {
		name: 'Hello, THRAX!',
		description: 'Educational CALL_PAL callsys console: v0 selects the service, a0 its argument.',
		code: helloSource
	},
	input: {
		name: 'Interactive Input',
		description: 'Read a signed integer and echo it with the educational callsys console.',
		code: inputSource
	},
	sum: {
		name: 'Sum of Numbers',
		description: 'Add 3 and 5; prints 8.',
		code: sumSource
	},
	factorial: {
		name: 'Factorial',
		description: 'A native BSR/RET call computes 5!; prints 120.',
		code: factorialSource
	},
	fibonacci: {
		name: 'Fibonacci',
		description: 'Ten iterations compute F(10) = 55.',
		code: fibonacciSource
	},
	loop: {
		name: 'Loop Counter',
		description: 'Print the integers 1 through 5.',
		code: loopSource
	},
	bitwise: {
		name: 'Bitwise Operations',
		description: 'AND, BIS and XOR of 12 and 10 produce 8, 14 and 6.',
		code: bitwiseSource
	},
	ackermann: {
		name: 'Ackermann',
		description: 'Recursive BSR/RET calls save the 64-bit return address and argument; A(3, 3) = 61.',
		code: ackermannSource
	},
	bitmap: {
		name: 'Bitmap Display',
		description: 'Draw the common 32 by 32 RGB gradient with native little-endian longword stores.',
		tools: ['bitmap'],
		code: bitmapSource
	},
	mandelbrot: {
		name: 'Mandelbrot Set',
		description: 'IEEE S_floating arithmetic renders the common 32 by 32, 16-iteration view.',
		tools: ['bitmap'],
		code: mandelbrotSource
	},
	floatingpoint: {
		name: 'Floating-point Arithmetic',
		description: 'Compute sqrt(81) * 5 = 45 with IEEE T_floating instructions.',
		requirements: ['Alpha FIX extension (SQRTT)'],
		code: floatingPointSource
	}
}
