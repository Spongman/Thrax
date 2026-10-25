import type { Example } from '../architectures/contracts'

/** Explicit provenance; file contents alone never opt a document into replacement. */
export interface ExampleSource { id: string; source: string }

export function exampleSource(examples: Readonly<Record<string, Example>>, example: Example): ExampleSource | undefined {
	const id = example.id && Object.prototype.hasOwnProperty.call(examples, example.id) && examples[example.id].code === example.code
		? example.id : Object.entries(examples).find(([, candidate]) => candidate === example)?.[0]
	return id === undefined ? undefined : { id, source: example.code }
}

/** Persist only an unchanged explicitly loaded example, including its exact baseline. */
export function cleanExampleSource(value: unknown, code: string): ExampleSource | undefined {
	if (!value || typeof value !== 'object') return undefined
	const example = value as Partial<ExampleSource>
	return typeof example.id === 'string' && example.id.length > 0 && example.source === code ? { id: example.id, source: code } : undefined
}

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
	floatingpoint: 'Floating-point Arithmetic',
	cmos: 'W65C02S Instructions'
} as const

/** Every CPU can demonstrate these without requiring a console or a macro dialect. */
export const CORE_EXAMPLE_IDS = ['sum', 'factorial', 'fibonacci', 'loop', 'bitwise', 'bitmap'] as const

const names = new Map<string, string>(Object.entries(EXAMPLE_NAMES))
export const exampleName = (id: string, fallback: string): string => names.get(id) ?? fallback

/** Variants may reuse compatible sources and override only the examples they need. */
export function canonicalExamples(examples: Readonly<Record<string, Example>>): Readonly<Record<string, Example>> {
	return Object.fromEntries(Object.entries(examples).map(([id, example]) => [id, { ...example, name: exampleName(id, example.name) }]))
}

const order: readonly string[] = Object.keys(EXAMPLE_NAMES)
export const exampleOrder = (id: string): number => {
	const index = order.indexOf(id)
	return index < 0 ? order.length : index
}
