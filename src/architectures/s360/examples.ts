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
import mandelbrotFpu from './examples/mandelbrot-fpu.asm?raw'
import floatingpoint from './examples/floatingpoint.asm?raw'

export const examples: Readonly<Record<string, Example>> = {
	hello: { name: 'Hello, THRAX!', description: 'Write an EBCDIC message with WTO (SVC 35).', code: hello },
	input: { name: 'Interactive Input', description: 'Read and print a signed integer.', code: input },
	sum: { name: 'Sum of Numbers', description: 'Add 3 and 5; prints 8.', code: sum },
	factorial: { name: 'Factorial', description: 'Compute 5! in a BALR subroutine with save-area linkage; prints 120.', code: factorial },
	fibonacci: { name: 'Fibonacci', description: 'Compute F(10) with a BCT loop; prints 55.', code: fibonacci },
	loop: { name: 'Loop Counter', description: 'Print 1 through 5 with BXLE.', code: loop },
	bitwise: { name: 'Bitwise Operations', description: 'NR, OR and XR produce 8, 14 and 6.', code: bitwise },
	ackermann: { name: 'Ackermann', description: 'Recursive A(3, 3) = 61 with a stack of chained save areas.', code: ackermann },
	bitmap: { name: 'Bitmap Display', description: 'Draw a 32 by 32 gradient with STC and MVI.', code: bitmap, tools: ['bitmap'] },
	mandelbrot: { name: 'Mandelbrot Set', description: '32 by 32 in 8.8 fixed point with M and D, 16 iterations and the MIPS palette.', code: mandelbrot, tools: ['bitmap'] },
}

/** Variants with the floating-point feature. */
export const floatExamples: Readonly<Record<string, Example>> = {
	mandelbrot: { ...examples.mandelbrot, description: '32 by 32 in long hexadecimal floating point, 16 iterations and the MIPS palette.', code: mandelbrotFpu, requirements: ['Floating-point feature'] },
	floatingpoint: { name: 'Floating-point Arithmetic', description: '1000 * 22 / 7 truncated to 3142 through an unnormalized add, and 0.1 + 0.2 against 0.3.', code: floatingpoint, requirements: ['Floating-point feature'] },
}
