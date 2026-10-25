import type { Example } from '../contracts'
import hello from './examples/hello.asm?raw'
import input from './examples/input.asm?raw'
import sum from './examples/sum.asm?raw'
import factorial from './examples/factorial.asm?raw'
import fibonacci from './examples/fibonacci.asm?raw'
import loop from './examples/loop.asm?raw'
import bitwise from './examples/bitwise.asm?raw'
import ackermann from './examples/ackermann.asm?raw'
import bitmap from './examples/bitmap.asm?raw'
import mandelbrot from './examples/mandelbrot.asm?raw'
import mandelbrotFixed from './examples/mandelbrot-fixed.asm?raw'
import floatingpoint from './examples/floatingpoint.asm?raw'

const common: Readonly<Record<string, Example>> = {
	hello: { name: 'Hello, THRAX!', description: 'Print a string through the console transmit buffer with MFPR and MTPR.', code: hello },
	input: { name: 'Interactive Input', description: 'Read and print a signed integer through the CHMK console monitor.', code: input },
	sum: { name: 'Sum of Numbers', description: 'Add 3 and 5 with ADDL3; prints 8.', code: sum },
	factorial: { name: 'Factorial', description: 'Compute 5! in a CALLS procedure with an entry mask; prints 120.', code: factorial },
	fibonacci: { name: 'Fibonacci', description: 'Compute F(10) with SOBGTR; prints 55.', code: fibonacci },
	loop: { name: 'Loop Counter', description: 'Print 1 through 5 with AOBLEQ.', code: loop },
	bitwise: { name: 'Bitwise Operations', description: 'AND (MCOML and BICL3), OR and XOR produce 8, 14 and 6.', code: bitwise },
	ackermann: { name: 'Ackermann', description: 'Recursive A(3, 3) = 61 through CALLS and RET frames.', code: ackermann },
	bitmap: { name: 'Bitmap Display', description: 'Draw a 32 by 32 gradient with autoincrement longword stores.', code: bitmap, tools: ['bitmap'] },
}

export const examples: Readonly<Record<string, Example>> = {
	...common,
	mandelbrot: { name: 'Mandelbrot Set', description: '32 by 32 in F_floating, 16 iterations and the MIPS palette.', code: mandelbrot, tools: ['bitmap'] },
	floatingpoint: { name: 'Floating-point Arithmetic', description: 'F_floating and D_floating division, truncating and rounding conversion, and 0.1 + 0.2 against 0.3.', code: floatingpoint },
}

/** Without the 78132 FPU the floating instructions trap, so the Mandelbrot uses fixed point. */
export const fixedPointExamples: Readonly<Record<string, Example>> = {
	...common,
	mandelbrot: { name: 'Mandelbrot Set', description: '32 by 32 in signed 8.8 fixed point, 16 iterations and the MIPS palette.', code: mandelbrotFixed, tools: ['bitmap'] },
}
