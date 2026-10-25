import type { Example } from '../contracts'
import mandelbrotSource from './examples/mandelbrot.asm?raw'
import mmioSource from './examples/mmio.asm?raw'
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
import timerSource from './examples/timer.asm?raw'

/** Source programs are architecture-local text assets; this file holds metadata. */
export const EXAMPLES: Readonly<Record<string, Example>> = {
	mandelbrot: {
		name: 'Mandelbrot Set',
		description: 'Software multiplication draws the 32 by 32 fractal in signed 8.8 fixed point.',
		tools: ['bitmap'],
		bitmapPalette: [48, 4170, 8038, 12416, 17568, 22973, 1733332, 4033760, 6465258, 8830962, 11064823, 13035259, 14610941, 15726846, 16317695, 16777215, 0],
		code: mandelbrotSource
	},
	mmio: {
		name: 'Keyboard and Display',
		description: 'Poll the keyboard status, echo each character to the display and stop at a period.',
		tools: ['keyboardDisplay'],
		code: mmioSource
	},
	input: {
		name: 'Interactive Input',
		description: 'Read a line into a buffer, waiting for each character, then print it',
		code: inputSource
	},
	hello: {
		name: 'Hello, THRAX!',
		description: 'Print a string stored after the code',
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
		description: 'Draw colour bands for the Bitmap Display tool',
		code: bitmapSource
	},
	macros: {
		name: 'Macros',
		description: 'Define once, use many times with MACRO and EQU',
		code: macrosSource
	},
	keyboard: {
		tools: ['keyboardDisplay'],
		name: 'Keyboard Interrupts',
		description: 'Echo typed characters from an IM 1 interrupt handler until a full stop',
		code: keyboardSource
	},
	timer: {
		name: 'Timer Interrupts',
		description: 'Count timer ticks in an IM 2 handler found through a vector table',
		code: timerSource
	}
}
