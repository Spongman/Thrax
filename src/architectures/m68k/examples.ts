import type { Example } from '../contracts'
import mandelbrotSource from './examples/mandelbrot.asm?raw'
import ackermannSource from './examples/ackermann.asm?raw'
import helloSource from './examples/hello.asm?raw'
import factorialSource from './examples/factorial.asm?raw'
import bitmapSource from './examples/bitmap.asm?raw'
import stackSource from './examples/stack.asm?raw'
import sumSource from './examples/sum.asm?raw'
import fibonacciSource from './examples/fibonacci.asm?raw'
import loopSource from './examples/loop.asm?raw'
import bitwiseSource from './examples/bitwise.asm?raw'
import inputSource from './examples/input.asm?raw'
import returnArgumentsSource from './examples/return-arguments.asm?raw'
import scaledTableSource from './examples/scaled-table.asm?raw'
import mandelbrotFpuSource from './examples/mandelbrot-fpu.asm?raw'
import floatingPointSource from './examples/floating-point.asm?raw'

/** Source programs are architecture-local text assets; this file holds metadata. */
export const EXAMPLES: Readonly<Record<string, Example>> = {
	mandelbrot: {
		name: 'Mandelbrot Set',
		description: 'Signed word multiplication draws the 32 by 32 Mandelbrot view in 8.8 fixed point.',
		tools: ['bitmap'],
		code: mandelbrotSource
	},
	ackermann: {
		name: 'Ackermann',
		description: 'Nested BSR/RTS calls compute A(3, 3) = 61, printed with TRAP #15.',
		code: ackermannSource
	},
	hello: {
		name: 'Hello, THRAX!',
		description: 'Educational TRAP #15 task 14 prints a zero-terminated string from A1.',
		code: helloSource
	},
	factorial: {
		name: 'Factorial',
		description: 'Word multiplication, BSR/RTS and a DBRA loop; prints 120.',
		code: factorialSource
	},
	bitmap: {
		tools: ['bitmap'],
		name: 'Bitmap Display',
		description: 'Draw the common 32 by 32 red/blue gradient using long stores and postincrement.',
		code: bitmapSource
	},
	stack: {
		name: 'Stack and Registers',
		description: 'Save registers, change values, restore them and rewind the stack.',
		code: stackSource
	},
	sum: {
		name: 'Sum of Numbers',
		description: 'Add 5 and 3, store the result, then print 8.',
		code: sumSource
	},
	fibonacci: {
		name: 'Fibonacci',
		description: 'Compute the tenth Fibonacci number with a DBRA loop; prints 55.',
		code: fibonacciSource
	},
	loop: {
		name: 'Loop Counter',
		description: 'Print one through five, one number per line, and retain the last counter in RAM.',
		code: loopSource
	},
	bitwise: {
		name: 'Bitwise Operations',
		description: 'Compare AND, OR and XOR using 12 and 10; prints 8, 14 and 6.',
		code: bitwiseSource
	},
	input: {
		name: 'Interactive Input',
		description: 'Read a signed integer into D1, store it, and echo it through educational TRAP #15.',
		code: inputSource
	}
}

export const EXAMPLES_68010: Readonly<Record<string, Example>> = {
	mandelbrot: {
		name: 'Mandelbrot Set',
		description: 'Signed word multiplication draws the 32 by 32 Mandelbrot view in 8.8 fixed point.',
		tools: ['bitmap'],
		code: mandelbrotSource
	},
	ackermann: {
		name: 'Ackermann',
		description: 'Nested BSR/RTS calls compute A(3, 3) = 61, printed with TRAP #15.',
		code: ackermannSource
	},
	hello: {
		name: 'Hello, THRAX!',
		description: 'Educational TRAP #15 task 14 prints a zero-terminated string from A1.',
		code: helloSource
	},
	factorial: {
		name: 'Factorial',
		description: 'Word multiplication, BSR/RTS and a DBRA loop; prints 120.',
		code: factorialSource
	},
	bitmap: {
		tools: ['bitmap'],
		name: 'Bitmap Display',
		description: 'Draw the common 32 by 32 red/blue gradient using long stores and postincrement.',
		code: bitmapSource
	},
	stack: {
		name: 'Stack and Registers',
		description: 'Save registers, change values, restore them and rewind the stack.',
		code: stackSource
	},
	sum: {
		name: 'Sum of Numbers',
		description: 'Add 5 and 3, store the result, then print 8.',
		code: sumSource
	},
	fibonacci: {
		name: 'Fibonacci',
		description: 'Compute the tenth Fibonacci number with a DBRA loop; prints 55.',
		code: fibonacciSource
	},
	loop: {
		name: 'Loop Counter',
		description: 'Print one through five, one number per line, and retain the last counter in RAM.',
		code: loopSource
	},
	bitwise: {
		name: 'Bitwise Operations',
		description: 'Compare AND, OR and XOR using 12 and 10; prints 8, 14 and 6.',
		code: bitwiseSource
	},
	input: {
		name: 'Interactive Input',
		description: 'Read a signed integer into D1, store it, and echo it through educational TRAP #15.',
		code: inputSource
	},
	returnArguments: {
		name: '68010: RTD and Arguments',
		description: 'RTD restores the caller PC and removes one long stack argument.',
		code: returnArgumentsSource
	}
}

export const EXAMPLES_68020: Readonly<Record<string, Example>> = {
	mandelbrot: {
		name: 'Mandelbrot Set',
		description: 'Signed word multiplication draws the 32 by 32 Mandelbrot view in 8.8 fixed point.',
		tools: ['bitmap'],
		code: mandelbrotSource
	},
	ackermann: {
		name: 'Ackermann',
		description: 'Nested BSR/RTS calls compute A(3, 3) = 61, printed with TRAP #15.',
		code: ackermannSource
	},
	hello: {
		name: 'Hello, THRAX!',
		description: 'Educational TRAP #15 task 14 prints a zero-terminated string from A1.',
		code: helloSource
	},
	factorial: {
		name: 'Factorial',
		description: 'Word multiplication, BSR/RTS and a DBRA loop; prints 120.',
		code: factorialSource
	},
	bitmap: {
		tools: ['bitmap'],
		name: 'Bitmap Display',
		description: 'Draw the common 32 by 32 red/blue gradient using long stores and postincrement.',
		code: bitmapSource
	},
	stack: {
		name: 'Stack and Registers',
		description: 'Save registers, change values, restore them and rewind the stack.',
		code: stackSource
	},
	sum: {
		name: 'Sum of Numbers',
		description: 'Add 5 and 3, store the result, then print 8.',
		code: sumSource
	},
	fibonacci: {
		name: 'Fibonacci',
		description: 'Compute the tenth Fibonacci number with a DBRA loop; prints 55.',
		code: fibonacciSource
	},
	loop: {
		name: 'Loop Counter',
		description: 'Print one through five, one number per line, and retain the last counter in RAM.',
		code: loopSource
	},
	bitwise: {
		name: 'Bitwise Operations',
		description: 'Compare AND, OR and XOR using 12 and 10; prints 8, 14 and 6.',
		code: bitwiseSource
	},
	input: {
		name: 'Interactive Input',
		description: 'Read a signed integer into D1, store it, and echo it through educational TRAP #15.',
		code: inputSource
	},
	returnArguments: {
		name: '68010: RTD and Arguments',
		description: 'RTD restores the caller PC and removes one long stack argument.',
		code: returnArgumentsSource
	},
	scaledTable: {
		name: '68020: Scaled Table Index',
		description: 'Brief scaled indexing selects a long table entry; EXTB sign-extends a byte.',
		code: scaledTableSource
	}
}

/** MC68020 with an MC68881/MC68882: Mandelbrot uses the FPU and a floating-point example is added. */
export const EXAMPLES_68020_FPU: Readonly<Record<string, Example>> = {
	...EXAMPLES_68020,
	mandelbrot: {
		name: 'Mandelbrot Set',
		description: 'Single-precision FPU arithmetic draws the 32 by 32 Mandelbrot view, matching the MIPS port.',
		tools: ['bitmap'],
		code: mandelbrotFpuSource
	},
	floatingpoint: {
		name: 'Floating-point Arithmetic',
		description: 'FMOVECR, FSQRT, FSIN and an FPU compare print 45, 1414 and 500 with TRAP #15.',
		code: floatingPointSource
	}
}
