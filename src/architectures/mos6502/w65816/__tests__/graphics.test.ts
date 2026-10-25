import { expect, it } from 'vitest'
import definition from '../index'

const palette = [0x000030,0x00104a,0x001f66,0x003080,0x0044a0,0x0059bd,0x1a72d4,0x3d8ce0,0x62a6ea,0x86bff2,0xa8d5f7,0xc6e6fb,0xdef1fd,0xeff8fe,0xf8fcff,0xffffff,0]
it.each(['bitmap', 'mandelbrot'])('computes every %s pixel with native instructions', key => {
	const services = definition.createServices(), settings = definition.settings.defaults
	try {
		const program = services.assemble({ files: [{ name: 'main.asm', code: definition.examples[key].code }], entries: ['main.asm'] }, settings)
		expect(program.diagnostics).toEqual([])
		const cpu = services.createMachine(program, settings, { speed: null, historyLimit: 100 })
		let steps = 0
		while (!cpu.halted && steps++ < 10000000) cpu.step()
		expect(cpu.halted).toBe(true)
		const memory = cpu.inspectMemory(), actual: number[] = [], expected: number[] = []
		for (let row = 0; row < 32; row++) for (let col = 0; col < 32; col++) {
			let iteration = 0, x = 0, y = 0
			if (key === 'mandelbrot') for (; iteration < 16; iteration++) {
				const xx = Math.trunc(x * x / 256), yy = Math.trunc(y * y / 256)
				if (xx + yy >= 1024) break
				y = 2 * Math.trunc(x * y / 256) - 320 + row * 20
				x = xx - yy - 512 + col * 20
			}
			expected.push(key === 'mandelbrot' ? palette[iteration] : (row << 19) | (col << 3))
			const address = 0x8000 + (row * 32 + col) * 4
			actual.push((memory.byte(address) ?? 0) | ((memory.byte(address + 1) ?? 0) << 8) | ((memory.byte(address + 2) ?? 0) << 16) | ((memory.byte(address + 3) ?? 0) << 24))
		}
		expect(actual).toEqual(expected)
	} finally { services.dispose() }
}, 30000)
