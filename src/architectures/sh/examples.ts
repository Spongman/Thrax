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

export const examples: Readonly<Record<string, Example>> = {
	hello: { name: 'Hello, THRAX!', description: 'Print a NUL-terminated string through the teaching monitor.', code: hello },
	input: { name: 'Interactive Input', description: 'Read and print a signed integer in R4.', code: input },
	sum: { name: 'Sum of Numbers', description: 'Add 3 and 5; prints 8.', code: sum },
	factorial: { name: 'Factorial', description: 'Compute 5! using a native BSR and word multiply; prints 120.', code: factorial },
	fibonacci: { name: 'Fibonacci', description: 'Compute F(10); prints 55.', code: fibonacci },
	loop: { name: 'Loop Counter', description: 'Print 1 through 5 using conditional branches.', code: loop },
	bitwise: { name: 'Bitwise Operations', description: 'AND, OR and XOR produce 8, 14 and 6.', code: bitwise },
	ackermann: { name: 'Ackermann', description: 'Recursive BSR/RTS with PR saved on the native stack; A(3, 3) = 61.', code: ackermann },
	bitmap: { name: 'Bitmap Display', description: 'Draw a 32 by 32 gradient using explicit RGB byte stores.', code: bitmap, tools: ['bitmap'] },
	mandelbrot: { name: 'Mandelbrot Set', description: '32 by 32 Q8 fixed point, 16 iterations and the MIPS palette.', code: mandelbrot, tools: ['bitmap'] },
}
