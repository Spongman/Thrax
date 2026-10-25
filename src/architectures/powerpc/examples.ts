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
import floatingPointSource from './examples/floating-point.asm?raw'

/** Source programs are architecture-local text assets; this file holds metadata. */
export const examples: Readonly<Record<string, Example>> = {
	hello: {
		name: 'Hello, THRAX!',
		description: 'The educational SC console uses r0 for the service and r3 for its argument.',
		code: helloSource
	},
	input: {
		name: 'Interactive Input',
		description: 'Read a signed integer and print it.',
		code: inputSource
	},
	sum: {
		name: 'Sum of Numbers',
		description: 'Add 3 and 5; prints 8.',
		code: sumSource
	},
	factorial: {
		name: 'Factorial',
		description: 'A native branch-and-link call computes 5!; prints 120.',
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
		description: 'AND, OR and XOR of 12 and 10 produce 8, 14 and 6.',
		code: bitwiseSource
	},
	ackermann: {
		name: 'Ackermann',
		description: 'Native recursive calls save LR and arguments on the stack; A(3, 3) = 61.',
		code: ackermannSource
	},
	bitmap: {
		name: 'Bitmap Display',
		description: 'Draw a 32 by 32 gradient. Native big-endian registers are stored as explicit little-endian RGB bytes.',
		tools: ['bitmap'],
		code: bitmapSource
	},
	mandelbrot: {
		name: 'Mandelbrot Set',
		description: '32 by 32 single-precision FPU Mandelbrot, 16 iterations and the common palette.',
		tools: ['bitmap'],
		code: mandelbrotSource
	},
	floatingpoint: {
		name: 'Floating-point Arithmetic',
		description: 'Compute sqrt(3*3 + 4*4) * 9 = 45 with FMADD, FSQRT and FCTIWZ, then compare 1/3 in single and double; prints 45 1.',
		code: floatingPointSource
	}
}
