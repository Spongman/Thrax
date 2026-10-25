import type { Example } from '../contracts'
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
import factorial186 from './examples/factorial-80186.asm?raw'
import floatingPoint from './examples/floating-point.asm?raw'
import trigonometry from './examples/trigonometry.asm?raw'
import mandelbrotFpu from './examples/mandelbrot-fpu.asm?raw'

/** Source programs are architecture-local text assets; this file holds metadata. */
export const examples: Readonly<Record<string, Example>> = {
	sum: {
		name: 'Sum of Numbers',
		description: 'Integer addition using native 8086 registers.',
		code: sumSource
	},
	factorial: {
		name: 'Factorial',
		description: 'Multiply 1 through 5 using the 8086 DX:AX multiplier.',
		code: factorialSource
	},
	fibonacci: {
		name: 'Fibonacci',
		description: 'Compute Fibonacci(10).',
		code: fibonacciSource
	},
	loop: {
		name: 'Loop Counter',
		description: 'Count from 1 to 5 with LOOP.',
		code: loopSource
	},
	bitwise: {
		name: 'Bitwise Operations',
		description: 'AND, OR and XOR on 12 and 10.',
		code: bitwiseSource
	},
	hello: {
		name: 'Hello, THRAX!',
		description: 'A zero-terminated string through the documented THRAX INT 80 monitor.',
		code: helloSource
	},
	input: {
		name: 'Interactive Input',
		description: 'Read a signed integer and echo it.',
		code: inputSource
	},
	ackermann: {
		name: 'Ackermann',
		description: 'Native recursive CALL/RET computes A(3, 3) = 61.',
		code: ackermannSource
	},
	bitmap: {
		name: 'Bitmap Display',
		description: '32 by 32 RGB gradient, stored as little-endian RGB32.',
		tools: ['bitmap'],
		bitmap: {
			kind: 'rgb32',
			littleEndian: true
		},
		code: bitmapSource
	},
	mandelbrot: {
		name: 'Mandelbrot Set',
		description: '32 by 32 fixed-point Mandelbrot, 16 iterations and the common example palette.',
		tools: ['bitmap'],
		bitmap: {
			kind: 'rgb32',
			littleEndian: true
		},
		code: mandelbrotSource
	}
}

/** Compatible sources remain shared; only native teaching ports are replaced. */
export const examples186 = { ...examples, factorial: { ...examples.factorial, description: 'Compute 5! with native 80186/80188 immediate IMUL.', code: factorial186 } }
export const fpuExamples = {
	floatingpoint: {
		name: 'Floating-point Arithmetic',
		description: 'Compute sqrt(81) * 5 = 45 with native extended-precision instructions.',
		requirements: ['Intel 8087'],
		code: floatingPoint
	},
	mandelbrot: {
		...examples.mandelbrot,
		description: '32 by 32 Mandelbrot in binary32-precision coprocessor arithmetic, 16 iterations and the common example palette.',
		code: mandelbrotFpu
	}
}
export const fpu187Examples = {
	trigonometry: {
		name: 'Trigonometry',
		description: 'Reduce 100 radians with FPREM1 and print 10000 * sin and cos from FSINCOS: -5064 8623.',
		requirements: ['Intel 80187'],
		code: trigonometry
	}
}
