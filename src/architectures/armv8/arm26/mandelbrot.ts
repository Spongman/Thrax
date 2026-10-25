import type { Example } from '../../contracts'
import mandelbrotSource from './examples/mandelbrot.asm?raw'

/** Source programs are architecture-local text assets; this file holds metadata. */
export const mandelbrot: Example = {
	name: 'Mandelbrot Set',
	description: 'ARM2/ARM3 integer multiplication draws a fractal in signed 8.8 fixed point.',
	tools: ['bitmap'],
	code: mandelbrotSource
}
