import type { Example } from '../../contracts'
import inputSource from './examples/input.asm?raw'
import helloSource from './examples/hello.asm?raw'
import sumSource from './examples/sum.asm?raw'
import factorialSource from './examples/factorial.asm?raw'
import fibonacciSource from './examples/fibonacci.asm?raw'
import ackermannSource from './examples/ackermann.asm?raw'
import loopSource from './examples/loop.asm?raw'
import bitwiseSource from './examples/bitwise.asm?raw'
import bitfieldsSource from './examples/bitfields.asm?raw'
import bitmapSource from './examples/bitmap.asm?raw'
import mmioSource from './examples/mmio.asm?raw'
import macrosSource from './examples/macros.asm?raw'
import mandelbrotSource from './examples/mandelbrot.asm?raw'
import mandelbrotFpSource from './examples/mandelbrot-fp.asm?raw'
import floatingPointSource from './examples/floatingpoint.asm?raw'
import helloArmasmSource from './examples/hello-armasm.asm?raw'
import factorialArmasmSource from './examples/factorial-armasm.asm?raw'

/** Source programs are architecture-local text assets; this file holds metadata. With floating point off. */
export const A32_FIXED_EXAMPLES: Readonly<Record<string, Example>> = {
	input: {
		name: 'Interactive Input',
		description: 'Read a line with the read system call, then write it back',
		code: inputSource
	},
	hello: {
		name: 'Hello, THRAX!',
		description: 'Print a string from the data section with the write system call',
		code: helloSource
	},
	sum: {
		name: 'Sum of Numbers',
		description: 'Add 5 + 3 and print the result',
		code: sumSource
	},
	factorial: {
		name: 'Factorial',
		description: 'Compute 5! (5 factorial) = 120 by recursion',
		code: factorialSource
	},
	fibonacci: {
		name: 'Fibonacci',
		description: 'Compute the 10th Fibonacci number',
		code: fibonacciSource
	},
	ackermann: {
		name: 'Ackermann',
		description: 'Deep recursion: compute A(3, 3) = 61',
		code: ackermannSource
	},
	loop: {
		name: 'Loop Counter',
		description: 'Print numbers from 1 to 5',
		code: loopSource
	},
	bitwise: {
		name: 'Bitwise Operations',
		description: 'Demonstrate AND, OR, XOR operations',
		code: bitwiseSource
	},
	bitfields: {
		name: 'Bit Fields',
		description: 'ARMv8 bit manipulation: UBFX, CLZ, REV, BFI and SXTB',
		code: bitfieldsSource
	},
	bitmap: {
		tools: ['bitmap'],
		name: 'Bitmap Display',
		description: 'Draw a colour gradient for the Bitmap Display tool',
		code: bitmapSource
	},
	mmio: {
		tools: ['keyboardDisplay'],
		name: 'Keyboard and Display',
		description: 'Echo queued keystrokes through the MMIO tool',
		code: mmioSource
	},
	macros: {
		name: 'Macros',
		description: 'Define once, use many times with .macro and .equ',
		code: macrosSource
	},
	mandelbrot: {
		tools: ['bitmap'],
		name: 'Mandelbrot Set',
		description: 'Escape-time fractal in 16.16 fixed point, drawn to the Bitmap Display',
		code: mandelbrotSource
	},
	helloArmasm: {
		name: 'Hello, THRAX! (armasm)',
		description: 'The greeting in armasm syntax: AREA, ENTRY, DCB and labels in column 1',
		code: helloArmasmSource
	},
	factorialArmasm: {
		name: 'Factorial (armasm)',
		description: 'Compute 5! = 120 in armasm syntax, with EQU and a literal pool',
		code: factorialArmasmSource
	}
}

/** With VFP on: the Mandelbrot set in single precision, and a floating-point tour. */
export const A32_EXAMPLES: Readonly<Record<string, Example>> = {
	...A32_FIXED_EXAMPLES,
	floatingpoint: {
		name: 'Floating-point Arithmetic',
		description: 'VFP square root, multiply, divide and rounding, printed to three places',
		code: floatingPointSource
	},
	mandelbrot: {
		tools: ['bitmap'],
		name: 'Mandelbrot Set',
		description: 'Escape-time fractal in single-precision VFP, drawn to the Bitmap Display',
		code: mandelbrotFpSource
	},
}
