import type { Example } from '../contracts'
import hello from './examples/hello.asm?raw'
import input from './examples/input.asm?raw'
import sum from './examples/sum.asm?raw'
import factorial from './examples/factorial.asm?raw'
import factorialEis from './examples/factorial-eis.asm?raw'
import fibonacci from './examples/fibonacci.asm?raw'
import loop from './examples/loop.asm?raw'
import loopSob from './examples/loop-sob.asm?raw'
import bitwise from './examples/bitwise.asm?raw'
import bitwiseXor from './examples/bitwise-xor.asm?raw'
import ackermann from './examples/ackermann.asm?raw'
import bitmap from './examples/bitmap.asm?raw'
import mandelbrot from './examples/mandelbrot.asm?raw'
import mandelbrotEis from './examples/mandelbrot-eis.asm?raw'
import mandelbrotFpu from './examples/mandelbrot-fpu.asm?raw'
import mandelbrotFis from './examples/mandelbrot-fis.asm?raw'
import floatingPoint from './examples/floatingpoint.asm?raw'
import floatingPointFis from './examples/floatingpoint-fis.asm?raw'

/** The PDP-11/20 base set; later models replace what their extra instructions improve. */
export const examples: Readonly<Record<string, Example>> = {
	hello: { name: 'Hello, THRAX!', description: 'Print a string through the console DL11 transmitter, polling its ready bit.', code: hello },
	input: { name: 'Interactive Input', description: 'Read and print a signed integer through the THRAX EMT monitor.', code: input },
	sum: { name: 'Sum of Numbers', description: 'Add 3 and 5; prints 8.', code: sum },
	factorial: { name: 'Factorial', description: 'Recursive JSR PC calls and a shift-and-add multiply compute 5! = 120.', code: factorial },
	fibonacci: { name: 'Fibonacci', description: 'Ten iterations compute F(10) = 55.', code: fibonacci },
	loop: { name: 'Loop Counter', description: 'Print 1 through 5.', code: loop },
	bitwise: { name: 'Bitwise Operations', description: 'BIC, BIS and an XOR built from them give 8, 14 and 6.', code: bitwise },
	ackermann: { name: 'Ackermann', description: 'Recursive JSR PC calls on the hardware stack compute A(3, 3) = 61.', code: ackermann },
	bitmap: { name: 'Bitmap Display', description: 'A 32 by 32 RGB gradient written a word at a time with autoincrement.', tools: ['bitmap'], code: bitmap },
	mandelbrot: { name: 'Mandelbrot Set', description: 'The common 32 by 32, 16-iteration view in 8.8 fixed point with a software multiply.', tools: ['bitmap'], code: mandelbrot },
}

export const eisExamples: Readonly<Record<string, Example>> = {
	factorial: { ...examples.factorial, description: 'Recursive JSR PC calls and the EIS MUL compute 5! = 120.', code: factorialEis },
	loop: { ...examples.loop, description: 'Print 1 through 5, counting the iterations down with SOB.', code: loopSob },
	bitwise: { ...examples.bitwise, description: 'BIC, BIS and XOR give 8, 14 and 6.', code: bitwiseXor },
	mandelbrot: { ...examples.mandelbrot, description: 'The common 32 by 32, 16-iteration view in 8.8 fixed point with EIS MUL and DIV.', code: mandelbrotEis },
}

export const fisExamples: Readonly<Record<string, Example>> = {
	floatingpoint: { name: 'Floating-point Arithmetic', description: '22 / 7 * 1000 with FIS FDIV and FMUL on the stack, truncated by EIS shifts to 3142.', requirements: ['KE11-F FIS'], code: floatingPointFis },
	mandelbrot: { ...examples.mandelbrot, description: 'The common 32 by 32, 16-iteration view in FIS single precision on the stack.', requirements: ['KE11-F FIS'], code: mandelbrotFis },
}

export const fp11Examples: Readonly<Record<string, Example>> = {
	floatingpoint: { name: 'Floating-point Arithmetic', description: '1000 * 22 / 7 in D precision truncates to 3142, and 0.1 + 0.2 equals 0.3 exactly in DEC F.', requirements: ['FP11'], code: floatingPoint },
	mandelbrot: { ...examples.mandelbrot, description: 'The common 32 by 32, 16-iteration view in FP11 single precision.', code: mandelbrotFpu },
}
