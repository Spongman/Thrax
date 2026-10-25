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
describe('8086', () => {
	it('encodes independently specified native words and ModRM forms', () => {
		expect(encode('mov', ['ax', '0x1234'], context)).toEqual([0xb8, 0x34, 0x12])
		expect(encode('mov', ['byte [bx+si+4]', 'al'], context)).toEqual([0x88, 0x80, 4, 0])
		expect(encode('mov', ['ax', 'es:[bp+6]'], context)).toEqual([0x26, 0x8b, 0x86, 6, 0])
		expect(encode('call', ['0x1010'], context)).toEqual([0xe8, 0x0d, 0])
		expect(encode('rep', ['movsb'], context)).toEqual([0xf3, 0xa4])
	})
	it('selects DS/SS, applies segment overrides, and wraps 20-bit physical addresses', () => {
		const { services, machine: cpu } = machine('mov ax,0x1000\nmov ds,ax\nmov ax,0x2000\nmov ss,ax\nmov bp,0x10\nmov word [bp],0x1234\nmov bx,0x10\nmov word [bx],0x5678\nmov ax,ss:[bx]\nhlt')
		try { while (!cpu.halted) cpu.step(); expect(cpu.registerValues().ax).toBe(0x1234); expect(cpu.inspectMemory().word(0x20010)).toBe(0x1234); expect(cpu.inspectMemory().word(0x10010)).toBe(0x5678) } finally { services.dispose() }
	})
	it('uses native stack words for calls and can rewind register and memory effects', () => {
		const { services, machine: cpu } = machine('mov ax,5\ncall twice\nhlt\ntwice:\nadd ax,ax\nret')
		try {
			cpu.step(); cpu.step()
			expect(cpu.callStack).toHaveLength(1)
			expect(cpu.registerValues().sp).toBe(0xfffc)
			cpu.step(); cpu.step()
			expect(cpu.registerValues().ax).toBe(10)
			expect(cpu.callStack).toHaveLength(0)
			expect(cpu.stepBack()).toBe(true)
			expect(cpu.callStack).toHaveLength(1)
			expect(cpu.registerValues().sp).toBe(0xfffc)
		} finally { services.dispose() }
	})
	it('steps over a near CALL whose encoding wraps the CS offset', async () => {
		const { services, machine: cpu } = machine('.org 0x1fffe\n.byte 0xe8,0x02\n.org 0x10000\n.byte 0\n.org 0x10003\nret')
		try {
			expect(cpu.writeRegister('cs', 0x1000)).toBe(true)
			cpu.setProgramCounter(0x1fffe)
			await cpu.stepOver()
			expect(cpu.pc).toBe(0x10001)
			expect(cpu.registerValues().ip).toBe(1)
			expect(cpu.callStack).toEqual([])
		} finally { services.dispose() }
	})
	it('preserves original PUSH SP semantics, decimal adjust and signed division', () => {
		const { services, machine: cpu } = machine('mov sp,0x8000\npush sp\npop bx\nmov al,9\nadd al,9\ndaa\nmov dx,ax\nmov ax,-513\ncwd\nmov cx,256\nidiv cx\nhlt')
		try {
			while (!cpu.halted) cpu.step()
			expect(cpu.registerValues().bx).toBe(0x7ffe)
			expect(cpu.registerValues().ax).toBe(0xfffe)
			expect(cpu.registerValues().dx).toBe(0xffff)
			expect(Number(cpu.registerValues().flags) & 0xf02a).toBe(0xf002)
		} finally { services.dispose() }
	})
	it('shares segmented word transfers across offset and physical wraps, including REP MOVSW', () => {
		const { services, machine: cpu } = machine('mov ax,0x1000\nmov ds,ax\nmov word [0xffff],0x1234\nmov bx,[0xffff]\nmov ax,0xffff\nmov ds,ax\nmov word [15],0x5678\nmov dx,[15]\nmov ax,0x2000\nmov es,ax\nmov si,15\nmov di,0xffff\nmov cx,1\nrep movsw\nhlt')
		try {
			while (!cpu.halted) cpu.step()
			expect(cpu.registerValues().bx).toBe(0x1234)
			expect(cpu.registerValues().dx).toBe(0x5678)
			expect(cpu.registerValues().cx).toBe(0)
			expect(cpu.registerValues().di).toBe(1)
			const memory = cpu.inspectMemory()
			expect([memory.byte(0x1ffff), memory.byte(0x10000)]).toEqual([0x34, 0x12])
			expect([memory.byte(0xfffff), memory.byte(0)]).toEqual([0x78, 0x56])
			expect([memory.byte(0x2ffff), memory.byte(0x20000)]).toEqual([0x78, 0x56])
		} finally { services.dispose() }
	})
	it('runs every bundled non-graphics example, including native recursion and input', () => {
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
})
