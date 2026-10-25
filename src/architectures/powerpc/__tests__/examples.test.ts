import { describe, expect, it } from 'vitest'
import powerpc from '../index'
import alpha from '../../alpha'
import tms9900 from '../../tms9900'
import { activateArchitecture } from '../../registry'
import { variantOf } from '../../contracts'
import { pixelBytes, pixelColor } from '../../../components/bitmapPixels'

describe.each([powerpc, alpha, tms9900])('$name common example ports', definition => {
	it('assembles and executes every console example including recursive calls', () => {
		const services = definition.createServices(), settings = definition.settings.defaults
		const expected: Record<string, string> = { hello: 'Hello, THRAX!\n', sum: '8', factorial: '120', fibonacci: '55', loop: '1 2 3 4 5 ', bitwise: '8 14 6', ackermann: '61', input: '-17' }
		try {
			for (const [name, output] of Object.entries(expected)) {
				const code = definition.examples[name].code
				const program = services.assemble({ files: [{ name: 'main.asm', code }], entries: ['main.asm'] }, settings)
				expect(program.diagnostics, name).toEqual([])
				const machine = services.createMachine(program, settings, { speed: null, historyLimit: 1000 })
				for (let i = 0; i < 200_000 && !machine.halted; i++) { machine.step(); if (machine.pendingInput) expect(machine.provideInput('-17')).toBe(true) }
				expect(machine.halted, name).toBe(true)
				expect(machine.console, name).toBe(output)
				expect(machine.callStack, name).toEqual([])
				if (name === 'ackermann') {
					const count = machine.instructionCount
					expect(machine.stepBack()).toBe(true)
					expect(machine.halted).toBe(false)
					machine.step()
					expect(machine.halted).toBe(true)
					expect(machine.instructionCount).toBe(count)
				}
			}
		} finally { services.dispose() }
	})
	it('draws all gradient and Mandelbrot pixels with common constants', () => {
		const services = definition.createServices(), settings = definition.settings.defaults
		const palette = [0x000030, 0x00104a, 0x001f66, 0x003080, 0x0044a0, 0x0059bd, 0x1a72d4, 0x3d8ce0, 0x62a6ea, 0x86bff2, 0xa8d5f7, 0xc6e6fb, 0xdef1fd, 0xeff8fe, 0xf8fcff, 0xffffff, 0]
		try {
			for (const name of ['bitmap', 'mandelbrot']) {
				const program = services.assemble({ files: [{ name: 'main.asm', code: definition.examples[name].code }], entries: ['main.asm'] }, settings)
				expect(program.diagnostics, name).toEqual([])
				const machine = services.createMachine(program, settings, { speed: null, historyLimit: 100 })
				for (let i = 0; i < 1_000_000 && !machine.halted; i++) machine.step()
				expect(machine.halted, name).toBe(true)
				for (let row = 0; row < 32; row++) for (let col = 0; col < 32; col++) {
					let x = 0, y = 0, iteration = 0
					// PowerPC (always with its FPU) and Alpha draw the single-precision MIPS port.
					for (; iteration < 16; iteration++) {
						if (definition === powerpc || definition === alpha) {
							const xx = Math.fround(x * x), yy = Math.fround(y * y)
							if (Math.fround(xx + yy) > 4) break
							y = Math.fround(Math.fround(Math.fround(x * y) * 2) - 1.25 + row * 2.5 / 32)
							x = Math.fround(Math.fround(xx - yy) - 2 + col * 2.5 / 32)
							continue
						}
						const xx = Math.trunc(x * x / 256), yy = Math.trunc(y * y / 256)
						if (xx + yy >= 1024) break
						y = 2 * Math.trunc(x * y / 256) - 320 + row * 20
						x = xx - yy - 512 + col * 20
					}
					const address = services.profile(settings).dataBase! + (row * 32 + col) * 4, memory = machine.inspectMemory()
					const actual = memory.byte(address)! | memory.byte(address + 1)! << 8 | memory.byte(address + 2)! << 16
					expect(actual, `${name} ${row},${col}`).toBe(name === 'bitmap' ? row << 19 | col << 3 : palette[iteration])
				}
			}
		} finally { services.dispose() }
	})
})

describe('PowerPC floating-point Mandelbrot', () => {
	it('runs to completion and matches the MIPS single-precision pixels exactly', async () => {
		const { definition: mips } = await activateArchitecture('mips')
		const colours = async (definition: typeof powerpc) => {
			const services = definition.createServices(), settings = definition.settings.defaults
			try {
				await services.prepare?.(settings)
				const example = variantOf(definition, settings).examples.mandelbrot
				const program = services.assemble({ files: [{ name: 'main.asm', code: example.code }], entries: ['main.asm'] }, settings)
				expect(program.diagnostics.filter(d => d.severity === 'error')).toEqual([])
				const machine = services.createMachine(program, settings, { speed: null, historyLimit: 100 })
				for (let i = 0; i < 2_000_000 && !machine.halted; i++) machine.step()
				expect(machine.halted, definition.id).toBe(true)
				const profile = services.profile(settings), memory = machine.inspectMemory()
				return Array.from({ length: 1024 }, (_, i) => pixelColor(memory, profile.dataBase! + i * pixelBytes(profile.bitmap), example.bitmap ?? profile.bitmap, example.bitmapPalette))
			} finally { services.dispose() }
		}
		const ppc = await colours(powerpc), reference = await colours(mips)
		expect(new Set(ppc).size).toBeGreaterThan(10)
		expect(ppc).toEqual(reference)
	}, 30_000)
})
