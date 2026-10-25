import { describe, expect, it } from 'vitest'
import architecture from '../index'
import { EXAMPLES } from '../examples'

describe('8051 executable example ports', () => {
	it('recomputes hardware parity atomically for ACC and PSW debugger edits', () => {
		const services = architecture.createServices(), settings = architecture.settings.defaults
		const program = services.assemble({ files: [{ name: 'main.asm', code: 'nop' }], entries: ['main.asm'] }, settings)
		const machine = services.createMachine(program, settings, { speed: null, historyLimit: 1000 })
		const snapshot = () => ({ a: machine.registerValues().a, psw: machine.registerValues().psw })
		try {
			expect(machine.writeRegister('a', 7)).toBe(true)
			expect(snapshot()).toEqual({ a: 7, psw: 1 })
			const cursor = machine.historyCursor
			expect(machine.writeByte(0x10160, 3)).toBe(true)
			expect(snapshot()).toEqual({ a: 3, psw: 0 })
			expect(machine.historyCursor).toBe(cursor + 1)
			expect(machine.stepBack()).toBe(true)
			expect(snapshot()).toEqual({ a: 7, psw: 1 })
			machine.step()
			expect(snapshot()).toEqual({ a: 3, psw: 0 })
			// P follows ACC even when a debugger tries to write it explicitly.
			expect(machine.writeRegister('psw', 0xc1)).toBe(true)
			expect(snapshot()).toEqual({ a: 3, psw: 0xc0 })
			expect(machine.writeByte(0x10150, 0x81)).toBe(true)
			expect(snapshot()).toEqual({ a: 3, psw: 0x80 })
			expect(machine.stepBack()).toBe(true)
			expect(snapshot()).toEqual({ a: 3, psw: 0xc0 })
			machine.step()
			expect(snapshot()).toEqual({ a: 3, psw: 0x80 })
		} finally { machine.dispose(); services.dispose() }
	})
	it('suspends for input and preserves signed results through history replay', async () => {
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
	it('aliases debugger edits between SFR, register banks and native instructions', () => {
		const services = architecture.createServices(), settings = architecture.settings.defaults
		const program = services.assemble({ files: [{ name: 'main.asm', code: 'mov a,r0\ninc a' }], entries: ['main.asm'] }, settings)
		const machine = services.createMachine(program, settings, { speed: null, historyLimit: 1000 })
		try {
			machine.writeByte(0x10000, 41)
			expect(machine.registerValues().r0).toBe(41)
			machine.step()
			expect(machine.inspectMemory().byte(0x10160)).toBe(41)
			machine.writeByte(0x10160, 98)
			expect(machine.registerValues().a).toBe(98)
			machine.step()
			expect(machine.registerValues().a).toBe(99)
			machine.stepBack()
			expect(machine.registerValues().a).toBe(98)
			expect(machine.inspectMemory().byte(0x10160)).toBe(98)
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
				const offset = 0x20000 + (row * 32 + col) * 4
				const actual = memory.byte(offset)! | memory.byte(offset + 1)! << 8 | memory.byte(offset + 2)! << 16
				expect(actual, `${key} pixel ${row},${col}`).toBe(expected)
				expect(memory.byte(offset + 3)).toBe(0)
			}
		} finally { machine.dispose(); services.dispose() }
	}, 30_000)
})
