import type { Example } from '../contracts'
import mandelbrotSource from './examples/mandelbrot.asm?raw'
import ackermannSource from './examples/ackermann.asm?raw'
import bitmapSource from './examples/bitmap.asm?raw'
import helloSource from './examples/hello.asm?raw'
import factorialSource from './examples/factorial.asm?raw'
import sumSource from './examples/sum.asm?raw'
import fibonacciSource from './examples/fibonacci.asm?raw'
import loopSource from './examples/loop.asm?raw'
import bitwiseSource from './examples/bitwise.asm?raw'
import inputSource from './examples/input.asm?raw'
import memorySource from './examples/memory.asm?raw'
import compressedSource from './examples/compressed.asm?raw'
import floatMandelbrotSource from './examples/mandelbrot-float.asm?raw'
import floatingPointSource from './examples/floatingpoint.asm?raw'
import floatingPointDoubleSource from './examples/floatingpoint-double.asm?raw'

/** Source programs are architecture-local text assets; this file holds metadata. */
export const EXAMPLES: Readonly<Record<string, Example>> = {
	mandelbrot: {
		name: 'Mandelbrot Set',
		description: 'The M extension draws the 32 by 32 Mandelbrot view in signed 8.8 fixed point.',
		tools: ['bitmap'],
		code: mandelbrotSource
	},
	ackermann: {
		name: 'Ackermann',
		description: 'Nested recursive calls with stack frames compute and print A(3, 3) = 61.',
		code: ackermannSource
	},
	bitmap: {
		name: 'Bitmap Display',
		description: 'Draw the common 32 by 32 red/blue gradient at the default data base.',
		tools: ['bitmap'],
		code: bitmapSource
	},
	hello: {
		name: 'Hello, THRAX!',
		description: 'RV32IM educational ECALL console: a7 selects the service, a0 the argument.',
		code: helloSource
	},
	factorial: {
		name: 'Factorial',
		description: 'A function call and the M extension compute 5!; prints 120.',
		code: factorialSource
	},
	sum: {
		name: 'Sum of Numbers',
		description: 'Add 5 and 3; prints 8.',
		code: sumSource
	},
	fibonacci: {
		name: 'Fibonacci',
		description: 'Compute Fibonacci(10); prints 55.',
		code: fibonacciSource
	},
	loop: {
		name: 'Loop Counter',
		description: 'Print the numbers 1 through 5 on separate lines.',
		code: loopSource
	},
	bitwise: {
		name: 'Bitwise Operations',
		description: 'Combine 12 and 10; print AND = 8, OR = 14 and XOR = 6 on separate lines.',
		code: bitwiseSource
	},
	input: {
		name: 'Interactive Input',
		description: 'Read a signed integer using educational ECALL 5, then print it unchanged.',
		code: inputSource
	},
	memory: {
		name: 'Memory and Rewind',
		description: 'Word stores, signed loads and an EBREAK stop.',
		code: memorySource
	}
}

export const COMPRESSED_EXAMPLES: Readonly<Record<string, Example>> = {
	mandelbrot: {
		name: 'Mandelbrot Set',
		description: 'The M extension draws the 32 by 32 Mandelbrot view in signed 8.8 fixed point.',
		tools: ['bitmap'],
		code: mandelbrotSource
	},
	ackermann: {
		name: 'Ackermann',
		description: 'Nested recursive calls with stack frames compute and print A(3, 3) = 61.',
		code: ackermannSource
	},
	bitmap: {
		name: 'Bitmap Display',
		description: 'Draw the common 32 by 32 red/blue gradient at the default data base.',
		tools: ['bitmap'],
		code: bitmapSource
	},
	hello: {
		name: 'Hello, THRAX!',
		description: 'RV32IM educational ECALL console: a7 selects the service, a0 the argument.',
		code: helloSource
	},
	factorial: {
		name: 'Factorial',
		description: 'A function call and the M extension compute 5!; prints 120.',
		code: factorialSource
	},
	sum: {
		name: 'Sum of Numbers',
		description: 'Add 5 and 3; prints 8.',
		code: sumSource
	},
	fibonacci: {
		name: 'Fibonacci',
		description: 'Compute Fibonacci(10); prints 55.',
		code: fibonacciSource
	},
	loop: {
		name: 'Loop Counter',
		description: 'Print the numbers 1 through 5 on separate lines.',
		code: loopSource
	},
	bitwise: {
		name: 'Bitwise Operations',
		description: 'Combine 12 and 10; print AND = 8, OR = 14 and XOR = 6 on separate lines.',
		code: bitwiseSource
	},
	input: {
		name: 'Interactive Input',
		description: 'Read a signed integer using educational ECALL 5, then print it unchanged.',
		code: inputSource
	},
	memory: {
		name: 'Memory and Rewind',
		description: 'Word stores, signed loads and an EBREAK stop.',
		code: memorySource
	},
	compressed: {
		name: 'Compressed Instructions',
		description: 'Mixed 16-bit and 32-bit instructions, a compressed call and a stack word; prints 42.',
		code: compressedSource
	}
}

const floatMandelbrot: Example = {
	name: 'Mandelbrot Set',
	description: 'Single-precision F arithmetic draws the 32 by 32 Mandelbrot view.',
	tools: ['bitmap'],
	code: floatMandelbrotSource
}

/** F replaces the fixed-point Mandelbrot and adds floating point. */
export const FLOAT_EXAMPLES: Readonly<Record<string, Example>> = {
	mandelbrot: floatMandelbrot,
	floatingpoint: {
		name: 'Floating-point Arithmetic',
		description: 'Single precision: a fused hypotenuse, rounding modes, exception flags and fclass.',
		code: floatingPointSource
	}
}

export const DOUBLE_EXAMPLES: Readonly<Record<string, Example>> = {
	mandelbrot: floatMandelbrot,
	floatingpoint: {
		name: 'Floating-point Arithmetic',
		description: 'Single and double precision: rounding modes, exception flags, fclass and one third at both widths.',
		code: floatingPointDoubleSource
	}
}
