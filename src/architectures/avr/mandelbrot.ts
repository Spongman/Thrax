import type { Example } from '../contracts'
import mandelbrotSource from './examples/mandelbrot.asm?raw'

/** Source programs are architecture-local text assets; this file holds metadata. */
export const mandelbrot: Example = {
	name: 'Mandelbrot Set',
	description: 'Four byte multiplies form each signed 8.8 product; a 32 by 32 RGB fractal fills SRAM.',
	tools: ['bitmap'],
	code: mandelbrotSource
}
