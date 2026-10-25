import type { Example } from '../../contracts'
import mandelbrotSource from './examples/mandelbrot.asm?raw'
import mmioSource from './examples/mmio.asm?raw'
import prefetchSource from './examples/prefetch.asm?raw'
import inputSource from './examples/input.asm?raw'
import helloSource from './examples/hello.asm?raw'
import sumSource from './examples/sum.asm?raw'
import factorialSource from './examples/factorial.asm?raw'
import fibonacciSource from './examples/fibonacci.asm?raw'
import ackermannSource from './examples/ackermann.asm?raw'
import loopSource from './examples/loop.asm?raw'
import bitwiseSource from './examples/bitwise.asm?raw'
import bitmapSource from './examples/bitmap.asm?raw'
import macrosSource from './examples/macros.asm?raw'
import keyboardSource from './examples/keyboard.asm?raw'
import helloArmasmSource from './examples/hello-armasm.asm?raw'
import factorialArmasmSource from './examples/factorial-armasm.asm?raw'
import cacheSource from './examples/cache.asm?raw'

/** Source programs are architecture-local text assets; this file holds metadata. */
export const EXAMPLES: Readonly<Record<string, Example>> = {
	mandelbrot: {
		name: 'Mandelbrot Set',
		description: 'ARM2/ARM3 integer multiplication draws a fractal in signed 8.8 fixed point.',
		tools: ['bitmap'],
		code: mandelbrotSource
	},
	mmio: {
		name: 'Keyboard and Display',
		description: 'Poll the keyboard status, echo each character to the display and stop at a period.',
		tools: ['keyboardDisplay'],
		code: mmioSource
	},
	prefetch: {
		name: 'Instruction Prefetch',
		description: 'Self-modifying code: a queued instruction stays stale until a branch refills the pipeline',
		code: prefetchSource
	},
	input: {
		name: 'Interactive Input',
		description: 'Read a line with OS_ReadC into a buffer, then print it with OS_Write0',
		code: inputSource
	},
	hello: {
		name: 'Hello, THRAX!',
		description: 'Print a string stored after the code with OS_Write0',
		code: helloSource
	},
	sum: {
		name: 'Sum of Numbers',
		description: 'Add 5 + 3 and print the result',
		code: sumSource
	},
	factorial: {
		name: 'Factorial',
		description: 'Compute 5! (5 factorial) = 120',
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
	bitmap: {
		tools: ['bitmap'],
		name: 'Bitmap Display',
		description: 'Draw a colour gradient for the Bitmap Display tool',
		code: bitmapSource
	},
	macros: {
		name: 'Macros',
		description: 'Define once, use many times with .macro and .equ',
		code: macrosSource
	},
	keyboard: {
		tools: ['keyboardDisplay'],
		name: 'Keyboard Interrupts',
		description: 'Own the vectors: echo keys typed in the Keyboard / Display tool from an IRQ handler, until a full stop',
		code: keyboardSource
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

export const ARM3_EXAMPLES: Readonly<Record<string, Example>> = {
	mandelbrot: {
		name: 'Mandelbrot Set',
		description: 'ARM2/ARM3 integer multiplication draws a fractal in signed 8.8 fixed point.',
		tools: ['bitmap'],
		code: mandelbrotSource
	},
	mmio: {
		name: 'Keyboard and Display',
		description: 'Poll the keyboard status, echo each character to the display and stop at a period.',
		tools: ['keyboardDisplay'],
		code: mmioSource
	},
	prefetch: {
		name: 'Instruction Prefetch',
		description: 'Self-modifying code: a queued instruction stays stale until a branch refills the pipeline',
		code: prefetchSource
	},
	input: {
		name: 'Interactive Input',
		description: 'Read a line with OS_ReadC into a buffer, then print it with OS_Write0',
		code: inputSource
	},
	hello: {
		name: 'Hello, THRAX!',
		description: 'Print a string stored after the code with OS_Write0',
		code: helloSource
	},
	sum: {
		name: 'Sum of Numbers',
		description: 'Add 5 + 3 and print the result',
		code: sumSource
	},
	factorial: {
		name: 'Factorial',
		description: 'Compute 5! (5 factorial) = 120',
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
	bitmap: {
		tools: ['bitmap'],
		name: 'Bitmap Display',
		description: 'Draw a colour gradient for the Bitmap Display tool',
		code: bitmapSource
	},
	macros: {
		name: 'Macros',
		description: 'Define once, use many times with .macro and .equ',
		code: macrosSource
	},
	keyboard: {
		tools: ['keyboardDisplay'],
		name: 'Keyboard Interrupts',
		description: 'Own the vectors: echo keys typed in the Keyboard / Display tool from an IRQ handler, until a full stop',
		code: keyboardSource
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
	},
	cache: {
		name: 'ARM3 Cache Controls',
		description: 'Read the CPU ID, enable the unified cache, multiply and flush through CP15.',
		code: cacheSource
	}
}
