import type { Example } from '../../contracts'
import mandelbrotSource from './examples/mandelbrot.asm?raw'

/** Source programs are architecture-local text assets; this file holds metadata. */
export const mandelbrot: Example = {
	name: 'Mandelbrot Set',
	description: 'Thumb multiplication draws the 32 by 32 Mandelbrot view in signed 8.8 fixed point.',
	tools: ['bitmap'],
	code: mandelbrotSource
}
