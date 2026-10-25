import { describe, expect, it } from 'vitest'
import definition from '../index'
import { encode } from '../isa'

const context = { address: 0x1000, value: (text: string) => Number(text) }
function machine(code: string) {
	const services = definition.createServices(), settings = definition.settings.defaults
	const program = services.assemble({ files: [{ name: 'main.asm', code }], entries: ['main.asm'] }, settings)
	expect(program.diagnostics).toEqual([])
	return { services, machine: services.createMachine(program, settings, { speed: null, historyLimit: 1000 }) }
}
describe('65C816', () => {
	it('encodes independent WDC opcode examples and explicit width suffixes', () => {
		expect(encode('lda.b', ['#0x12'], context)).toEqual([0xa9, 0x12])
		expect(encode('lda.w', ['#0x1234'], context)).toEqual([0xa9, 0x34, 0x12])
		expect(encode('lda.l', ['0x123456,x'], context)).toEqual([0xbf, 0x56, 0x34, 0x12])
		expect(encode('lda', ['(0x12,s)', 'y'], context)).toEqual([0xb3, 0x12])
		expect(encode('jsl', ['0x123456'], context)).toEqual([0x22, 0x56, 0x34, 0x12])
		expect(encode('mvn', ['2', '3'], context)).toEqual([0x54, 3, 2])
	})
	it('preserves the hidden accumulator byte and truncates index registers on SEP', () => {
		const { services, machine: cpu } = machine('clc\nxce\nrep #0x30\nlda.w #0xabcd\nldx.w #0x1234\nsep #0x30\nlda.b #0x12\nstp')
		try { while (!cpu.halted) cpu.step(); expect(cpu.registerValues().a).toBe(0xab12); expect(cpu.registerValues().x).toBe(0x34); expect(cpu.registerValues().e).toBe(0) } finally { services.dispose() }
	})
	it('supports decimal carry and native long calls with native stack bytes', () => {
		const { services, machine: cpu } = machine('clc\nxce\nrep #0x30\nsed\nlda.w #0x9999\nclc\nadc.w #1\ncld\njsl 0x11000\nstp\n.org 0x11000\ninc a\nrtl')
		try {
			for (let step = 0; step < 9; step++) cpu.step()
			expect(cpu.registerValues().a).toBe(0)
			expect(cpu.callStack).toHaveLength(1)
			expect(cpu.registerValues().pbr).toBe(1)
			while (!cpu.halted) cpu.step()
			expect(cpu.registerValues().a).toBe(1)
			expect(cpu.callStack).toHaveLength(0)
			expect(cpu.registerValues().pbr).toBe(0)
		} finally { services.dispose() }
	})
	it('runs every bundled non-graphics example including recursive JSR and input', () => {
		for (const [key, example] of Object.entries(definition.examples)) {
			if (['bitmap', 'mandelbrot'].includes(key)) continue
			const { services, machine: cpu } = machine(example.code)
			try {
				let steps = 0
				while (!cpu.halted && steps++ < 200000) { cpu.step(); if (cpu.pendingInput) cpu.provideInput('-17') }
				expect(cpu.halted, key).toBe(true)
				const answers: Record<string, string> = { sum: '8', factorial: '120', fibonacci: '55', ackermann: '61', input: '-17' }
				if (answers[key]) expect(cpu.console.trim(), key).toBe(answers[key])
			} finally { services.dispose() }
		}
	})
	it('steps over JSR across a program-bank boundary without changing PBR', async () => {
		const { services, machine: cpu } = machine('.org 0x1fffe\n.byte 0x20,0x03\n.org 0x10000\n.byte 0\n.org 0x10003\nrts')
		try {
			cpu.setProgramCounter(0x1fffe)
			await cpu.stepOver()
			expect(cpu.pc).toBe(0x10001)
			expect(cpu.registerValues().pbr).toBe(1)
			expect(cpu.callStack).toEqual([])
		} finally { services.dispose() }
	})
})
