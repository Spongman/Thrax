import { describe, expect, it } from 'vitest'
import architecture from '../index'
import { EXAMPLES } from '../examples'

describe('M6800 executable example ports', () => {
	it('suspends for signed input and replays the original result', async () => {
		const services = architecture.createServices(), settings = architecture.settings.defaults
		const program = services.assemble({ files: [{ name: 'main.asm', code: EXAMPLES.input.code }], entries: ['main.asm'] }, settings)
		const machine = services.createMachine(program, settings, { speed: null, historyLimit: 1000 })
		try {
			await machine.run()
			expect(machine.pendingInput?.type).toBe('integer')
			expect(machine.provideInput('-17')).toBe(true)
			await machine.continue()
			expect(machine.console).toBe('-17')
			const cursor = machine.historyCursor
			while (machine.stepBack()) { /* rewind typed records */ }
			while (machine.historyCursor < cursor) machine.step()
			expect(machine.console).toBe('-17')
		} finally { machine.dispose(); services.dispose() }
	})
	it.each([['sum', '8'], ['factorial', '120'], ['fibonacci', '55'], ['loop', '1\n2\n3\n4\n5'], ['bitwise', '8\n14\n6'], ['hello', 'Hello, THRAX!'], ['ackermann', '61']] as const)('%s computes the expected result', async (key, output) => {
		const services = architecture.createServices(), settings = architecture.settings.defaults
		const program = services.assemble({ files: [{ name: 'main.asm', code: EXAMPLES[key].code }], entries: ['main.asm'] }, settings)
		expect(program.diagnostics).toEqual([])
		const machine = services.createMachine(program, settings, { speed: null, historyLimit: 1000 })
		try { await machine.run(); expect(machine.console.trim()).toBe(output); expect(machine.stopReason?.kind).toBe('halt') } finally { machine.dispose(); services.dispose() }
	})
	it.each(['bitmap', 'mandelbrot'])('%s produces a framebuffer on the guest CPU', async key => {
		const services = architecture.createServices(), settings = architecture.settings.defaults
		const program = services.assemble({ files: [{ name: 'main.asm', code: EXAMPLES[key].code }], entries: ['main.asm'] }, settings)
		expect(program.diagnostics).toEqual([])
		const machine = services.createMachine(program, settings, { speed: null, historyLimit: 1000 })
		try {
			await machine.run()
			expect(machine.stopReason?.kind).toBe('halt')
			const memory = machine.inspectMemory()
			const colors = [
				0x000030, 0x00104a, 0x001f66, 0x003080, 0x0044a0, 0x0059bd,
				0x1a72d4, 0x3d8ce0, 0x62a6ea, 0x86bff2, 0xa8d5f7, 0xc6e6fb,
				0xdef1fd, 0xeff8fe, 0xf8fcff, 0xffffff, 0,
			]
			for (let row = 0; row < 32; row++) for (let col = 0; col < 32; col++) {
				let x = 0, y = 0, iteration = 0
				if (key === 'mandelbrot') for (; iteration < 16; iteration++) {
					const xx = Math.trunc(x * x / 256), yy = Math.trunc(y * y / 256)
					if (xx + yy >= 1024) break
					y = 2 * Math.trunc(x * y / 256) - 320 + row * 20
					x = xx - yy - 512 + col * 20
				}
				const expected = key === 'bitmap' ? row << 19 | col << 3 : colors[iteration]
				const offset = 0x4000 + (row * 32 + col) * 4
				const actual = memory.byte(offset)! | memory.byte(offset + 1)! << 8 | memory.byte(offset + 2)! << 16
				expect(actual, `${key} pixel ${row},${col}`).toBe(expected)
				expect(memory.byte(offset + 3)).toBe(0)
			}
		} finally { machine.dispose(); services.dispose() }
	}, 30_000)
})
