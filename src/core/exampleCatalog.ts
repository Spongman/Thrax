/** Shared names and order for equivalent programs, independent of their CPU or syntax. */
export const EXAMPLE_NAMES = {
	hello: 'Hello, THRAX!',
	input: 'Interactive Input',
	sum: 'Sum of Numbers',
	factorial: 'Factorial',
	fibonacci: 'Fibonacci',
	ackermann: 'Ackermann',
	loop: 'Loop Counter',
	bitwise: 'Bitwise Operations',
	bitmap: 'Bitmap Display',
	macros: 'Macros',
	mmio: 'Keyboard and Display',
	keyboard: 'Keyboard Interrupts',
	interrupts: 'Interrupts',
	mandelbrot: 'Mandelbrot Set',
	coprocessors: 'Coprocessors',
	stack: 'Stack and Registers',
	memory: 'Memory and Rewind',
	call: 'Subroutine and SRAM',
	compressed: 'Compressed Instructions',
	cmos: 'W65C02S Instructions'
} as const

/** Every CPU can demonstrate these without requiring a console or a macro dialect. */
export const CORE_EXAMPLE_IDS = ['sum', 'factorial', 'fibonacci', 'loop', 'bitwise', 'bitmap'] as const

const names = new Map<string, string>(Object.entries(EXAMPLE_NAMES))
export const exampleName = (id: string, fallback: string): string => names.get(id) ?? fallback

const order: readonly string[] = Object.keys(EXAMPLE_NAMES)
export const exampleOrder = (id: string): number => {
	const index = order.indexOf(id)
	return index < 0 ? order.length : index
}
