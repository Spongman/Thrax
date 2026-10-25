import type { Example } from '../contracts'
import mandelbrotSource from './examples/mandelbrot.asm?raw'

/** Source programs are architecture-local text assets; this file holds metadata. */
export const mandelbrot: Example = {
	name: 'Mandelbrot Set',
	description: '32 by 32 Mandelbrot, signed Q8 arithmetic, 16 iterations and the MIPS palette.',
	tools: ['bitmap'],
	bitmap: {
		kind: 'rgb32',
		littleEndian: true
	},
	code: mandelbrotSource
}
