/** Check the ports through the same assembler/runtime contracts the workbench uses. */
import { describe, expect, it } from 'vitest'
import { variantOf, type ArchitectureDefinition, type Machine } from '../contracts'
import type { TargetSettings } from '../../core/settings'
import { activateArchitecture, knownArchitectures } from '../registry'
import { CORE_EXAMPLE_IDS } from '../../core/exampleCatalog'
import { BYTE_PALETTE, pixelBytes, pixelColor } from '../../components/bitmapPixels'

const EXPECTED_MANDELBROT_PALETTE = [
	0x000030, 0x00104a, 0x001f66, 0x003080,
	0x0044a0, 0x0059bd, 0x1a72d4, 0x3d8ce0,
	0x62a6ea, 0x86bff2, 0xa8d5f7, 0xc6e6fb,
	0xdef1fd, 0xeff8fe, 0xf8fcff, 0xffffff,
	0x000000,
]

function variants(definition: ArchitectureDefinition) {
	const defaults = definition.settings.defaults
	const configurations = [{ label: 'default', settings: defaults }]
	const seen = new Set([variantOf(definition, defaults)])
	for (const field of definition.settings.fields) {
		if (field.control.kind !== 'choice') continue
		for (const option of field.control.options) {
			const settings: TargetSettings = { ...defaults, [field.key]: option.value }
			const variant = variantOf(definition, settings)
			if (seen.has(variant)) continue
			seen.add(variant)
			configurations.push({ label: `${field.key}=${option.value}`, settings })
		}
	}
	return configurations
}

function finish(machine: Machine, inputSupplied = false) {
	let steps = 0
	// A device can offer more keyboard input while the program is still
	// processing its buffered line. After supplying it, run through to halt.
	while (!machine.halted && (inputSupplied || !machine.pendingInput) && steps++ < 200_000) machine.step()
	expect(steps, 'example instruction limit').toBeLessThan(200_000)
}

const answers: Record<string, number[]> = { sum: [8], factorial: [120], fibonacci: [55], loop: [1, 2, 3, 4, 5], bitwise: [8, 14, 6] }

describe.each(knownArchitectures())('%s example ports', (id) => {
	it('draws every Mandelbrot pixel from the fixed point reference', async () => {
		const { definition } = await activateArchitecture(id)
		for (const { settings, label } of variants(definition)) {
			const variant = variantOf(definition, settings)
			const services = definition.createServices()
			try {
				const example = variant.examples.mandelbrot
				const context = `${id}/${label}/mandelbrot`
				expect(example.tools, context).toContain('bitmap')
				const program = services.assemble({ files: [{ name: 'main.asm', code: example.code }], entries: ['main.asm'] }, settings)
				expect(program.diagnostics.filter((d) => d.severity === 'error'), context).toEqual([])
				const machine = services.createMachine(program, settings, { speed: null, historyLimit: 100 })
				try {
					for (let steps = 0; !machine.halted && steps < 10_000_000; steps++) machine.step()
					expect(machine.halted, context).toBe(true)
					const memory = machine.inspectMemory()
					const base = services.profile(settings).dataBase!
					const actual: (number | undefined)[] = [], expected: number[] = []
					for (let row = 0; row < 32; row++) for (let col = 0; col < 32; col++) {
						const highPrecision = id === 'armv8' && settings.executionState !== 'cortex-m0'
						const scale = highPrecision ? 65536 : 256
						const cx = -2 * scale + col * (highPrecision ? 6144 : 20)
						const cy = (highPrecision ? -98304 : -320) + row * (highPrecision ? 6144 : 20)
						let x = 0, y = 0, iteration = 0
						for (; iteration < 16; iteration++) {
							if (id === 'mips') {
								const xx = Math.fround(x * x), yy = Math.fround(y * y)
								if (Math.fround(xx + yy) > 4) break
								y = Math.fround(Math.fround(Math.fround(x * y) * 2) - 1.25 + row * 2.5 / 32)
								x = Math.fround(Math.fround(xx - yy) - 2 + col * 2.5 / 32)
							} else {
								const xx = Math.trunc(x * x / scale), yy = Math.trunc(y * y / scale)
								if (highPrecision ? xx + yy > 4 * scale : xx + yy >= 4 * scale) break
								y = (highPrecision ? Math.floor(x * y / (scale / 2)) : 2 * Math.trunc(x * y / scale)) + cy
								x = xx - yy + cx
							}
						}
						expected.push(EXPECTED_MANDELBROT_PALETTE[iteration])
						actual.push(pixelColor(memory, base + (row * 32 + col) * pixelBytes(services.profile(settings).bitmap), example.bitmap ?? services.profile(settings).bitmap, example.bitmapPalette))
					}
					expect(actual, context).toEqual(expected)
				} finally { machine.dispose() }
			} finally { services.dispose() }
		}
	}, 30_000)

	if (['avr', 'riscv', 'm68k', 'armv8'].includes(id)) it('computes Ackermann with nested calls and restores the call stack', async () => {
		const { definition } = await activateArchitecture(id)
		for (const { settings, label } of variants(definition)) {
			if (id === 'armv8' && settings.executionState !== 'cortex-m0') continue
			const services = definition.createServices()
			try {
				const context = `${id}/${label}/ackermann`
				const code = variantOf(definition, settings).examples.ackermann.code
				const program = services.assemble({ files: [{ name: 'main.asm', code }], entries: ['main.asm'] }, settings)
				expect(program.diagnostics, context).toEqual([])
				const machine = services.createMachine(program, settings, { speed: null, historyLimit: 100 })
				try {
					finish(machine)
					expect(machine.halted, context).toBe(true)
					expect(machine.callStack, context).toEqual([])
					if (id === 'avr') {
						expect(machine.registerValues().r16, context).toBe(61)
						expect(machine.inspectMemory().byte(0x10100), context).toBe(61)
					} else expect(machine.console, context).toBe('61')
				} finally { machine.dispose() }
			} finally { services.dispose() }
		}
	})

	it('preserves arithmetic results, console input/output and all bitmap pixels across CPU variants', async () => {
		const { definition } = await activateArchitecture(id)
		for (const { settings, label } of variants(definition)) {
			const services = definition.createServices()
			try {
				const examples = variantOf(definition, settings).examples
				for (const key of [...CORE_EXAMPLE_IDS, 'hello', 'input']) {
					const example = examples[key]
					if (!example) continue // AVR has no teaching console.
					const context = `${id}/${label}/${key}`
					const program = services.assemble({ files: [{ name: 'main.asm', code: example.code }], entries: ['main.asm'] }, settings)
					expect(program.diagnostics.filter((d) => d.severity === 'error'), context).toEqual([])
					const machine = services.createMachine(program, settings, { speed: null, historyLimit: 100 })
					finish(machine)
					if (key === 'input') {
						expect(machine.pendingInput, context).not.toBeNull()
						const input = machine.pendingInput!.type === 'integer' ? '-17' : 'hello, ports'
						expect(machine.provideInput(input), context).toBe(true)
						finish(machine, true)
						expect(machine.console.trimEnd(), context).toBe(input)
					}
					expect(machine.halted, context).toBe(true)
					if (key === 'hello') expect(machine.console, context).toBe('Hello, THRAX!\n')
					if (key === 'bitmap') {
						const memory = machine.inspectMemory()
						const base = services.profile(settings).dataBase!
						expect(example.tools, context).toContain('bitmap')
						const actual = [], expected = []
						for (let row = 0; row < 32; row++) for (let column = 0; column < 32; column++) {
							actual.push(pixelColor(memory, base + (row * 32 + column) * pixelBytes(services.profile(settings).bitmap), services.profile(settings).bitmap))
							expected.push(id === 'mos6502' ? BYTE_PALETTE[((row + column) >> 2) & 15]
								: id === 'z80' ? BYTE_PALETTE[(row + column) & 15] : (row << 19) | (column << 3))
						}
						expect(actual, context).toEqual(expected)
					} else if (key in answers) {
						if (id === 'avr') {
							const registers = machine.registerValues()
							const actual = key === 'loop' ? [0, 1, 2, 3, 4].map((offset) => machine.inspectMemory().byte(0x10100 + offset))
								: (key === 'bitwise' ? ['r18', 'r19', 'r20'] : [key === 'sum' ? 'r17' : 'r16']).map((name) => registers[name])
							expect(actual, context).toEqual(answers[key])
						} else expect(machine.console.match(/-?\d+/g)?.map(Number), context).toEqual(answers[key])
					}
					machine.dispose()
				}
			} finally {
				services.dispose()
			}
		}
	})
})
