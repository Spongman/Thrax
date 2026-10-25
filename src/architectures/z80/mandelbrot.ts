import type { Example } from '../contracts'
import mandelbrotSource from './examples/mandelbrot.asm?raw'

/** Source programs are architecture-local text assets; this file holds metadata. */
export const mandelbrot: Example = {
	name: 'Mandelbrot Set',
	description: 'Software multiplication draws the 32 by 32 fractal in signed 8.8 fixed point.',
	tools: ['bitmap'],
	bitmapPalette: [48, 4170, 8038, 12416, 17568, 22973, 1733332, 4033760, 6465258, 8830962, 11064823, 13035259, 14610941, 15726846, 16317695, 16777215, 0],
	code: mandelbrotSource
}
