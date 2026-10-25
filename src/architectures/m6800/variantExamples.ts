import { EXAMPLES } from './examples'
import mandelbrot from './examples/m6809/mandelbrot.asm?raw'
import sum from './examples/m6809/sum.asm?raw'
import factorial from './examples/m6809/factorial.asm?raw'
import fibonacci from './examples/m6809/fibonacci.asm?raw'
import loop from './examples/m6809/loop.asm?raw'
import bitwise from './examples/m6809/bitwise.asm?raw'
import hello from './examples/m6809/hello.asm?raw'
import input from './examples/m6809/input.asm?raw'
import ackermann from './examples/m6809/ackermann.asm?raw'
import bitmap from './examples/m6809/bitmap.asm?raw'
import hc11Factorial from './examples/hc11/factorial.asm?raw'
import hc11Hello from './examples/hc11/hello.asm?raw'

const sources = { mandelbrot, sum, factorial, fibonacci, loop, bitwise, hello, input, ackermann, bitmap }
export const m6809Examples = Object.fromEntries(Object.entries(sources).map(([id, code]) => [id, { ...EXAMPLES[id], code }]))
export const hc11Examples = { ...EXAMPLES,
	factorial: { ...EXAMPLES.factorial, description: 'Compute 5! using the native 68HC11 MUL instruction.', code: hc11Factorial },
	hello: { ...EXAMPLES.hello, description: 'Print a NUL-terminated string using native Y-indexed loads.', code: hc11Hello },
}
