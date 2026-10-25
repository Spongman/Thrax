import type { Example } from '../contracts'
import mandelbrotSource from './examples/mandelbrot.uasm?raw'

/** Source programs are architecture-local text assets; this file holds metadata. */
export const mandelbrot: Example = {
	name: 'Mandelbrot Set',
	description: 'Escape-time fractal in signed 8.8 fixed point, drawn to the Bitmap Display.',
	tools: ['bitmap'],
	code: mandelbrotSource
}
