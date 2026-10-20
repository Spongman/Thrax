import { describe, expect, it } from 'vitest'
import { codeRowOf } from '../../../core/sourceIndex'
import definition from '../index'
import { examples } from '../examples'
import { assembleAvr } from '../assembler'
import { AvrProgram, disassembly } from '../program'
import { AvrRuntime } from '../runtime'

function assembly(code: string) {
	const result = assembleAvr({ files: [{ name: 'main.asm', code }], entries: ['main.asm'] })
	expect(result.diagnostics).toEqual([])
	return new AvrProgram(result.image, result.diagnostics, 'main.asm')
}
function machine(code: string, historyLimit = 100000) {
	return new AvrRuntime(assembly(code), { speed: null, historyLimit })
}
function execute(code: string) {
	const cpu = machine(code)
	for (let i = 0; i < 1000 && !cpu.halted; i++) cpu.step()
	expect(cpu.halted).toBe(true)
	return cpu
}
describe('classic AVR profile', () => {
	it('encodes independent Microchip bit patterns, including 32-bit forms', () => {
		const image = assembly(
			'ldi r16, 0x42\nadd r16, r17\npush r16\npop r17\nlds r18, 0x1234\nsts 0x1234, r18\nrjmp end\nnop\nend: break'
		).image()
		expect(Array.from(image.sections[0].bytes)).toEqual([
			0x02, 0xe4, 0x01, 0x0f, 0x0f, 0x93, 0x1f, 0x91, 0x20, 0x91, 0x34, 0x12, 0x20, 0x93, 0x34,
			0x12, 0x01, 0xc0, 0, 0, 0x98, 0x95
		])
	})
	it('runs sum and rewinds register/SREG/halt state', () => {
		const cpu = execute(examples.sum.code)
		expect(cpu.registers[17]).toBe(8)
		expect(cpu.sreg & 2).toBe(0)
		expect(cpu.stepBack()).toBe(true)
		expect(cpu.halted).toBe(false)
		while (cpu.stepBack()) {
			/* restore reset */
		}
		expect(cpu.pc).toBe(0)
		expect(cpu.instructionCount).toBe(0)
		expect(cpu.registers.every((value) => value === 0)).toBe(true)
	})
	it('runs the common factorial, Fibonacci, loop and bitwise examples', () => {
		expect(execute(examples.factorial.code).registers[16]).toBe(120)
		expect(execute(examples.fibonacci.code).registers[16]).toBe(55)
		const loop = execute(examples.loop.code)
		expect(Array.from(loop.data.slice(0x100, 0x105))).toEqual([1, 2, 3, 4, 5])
		const bitwise = execute(examples.bitwise.code)
		expect(Array.from(bitwise.registers.slice(18, 21))).toEqual([8, 14, 6])
	})
	it('keeps .data pointer symbols native while debugger symbols point at SRAM', () => {
		const cpu = execute(examples.call.code)
		expect(cpu.program.labels.get('value')).toBe(0x10100)
		expect(cpu.registers[26] | (cpu.registers[27] << 8)).toBe(0x100)
		expect(cpu.data[0x100]).toBe(42)
		expect(cpu.flash[0x100]).toBe(0)
		expect(cpu.sp).toBe(65535)
		expect(cpu.callStack).toEqual([])
		while (cpu.stepBack()) {
			/* restore data and stack */
		}
		expect(cpu.data[0x100]).toBe(41)
		expect(cpu.data[65535]).toBe(0)
	})
	it('stores AVR return words on the descending stack and restores frames', () => {
		const cpu = machine('rcall f\nbreak\nf: ret')
		cpu.step()
		expect(cpu.pc).toBe(4)
		expect(cpu.sp).toBe(65533)
		expect(cpu.data[65535]).toBe(1)
		expect(cpu.data[65534]).toBe(0)
		expect(cpu.callStack[0]).toEqual({ callAddress: 0, returnAddress: 2, targetAddress: 4 })
		cpu.step()
		expect(cpu.pc).toBe(2)
		cpu.stepBack()
		expect(cpu.callStack).toHaveLength(1)
		expect(cpu.sp).toBe(65533)
	})
	it('implements arithmetic carry/half carry/overflow and chained zero', () => {
		const cpu = execute(
			'ldi r16, 0x7f\nldi r17, 1\nadd r16, r17\nin r18, 0x3f\nldi r16, 0\nsec\nsbc r16, r16\nin r19, 0x3f\nbreak'
		)
		expect(cpu.registers[18]).toBe(0x2c)
		expect(cpu.registers[16]).toBe(255)
		expect(cpu.registers[19] & 0x23).toBe(0x21)
	})
	it('skips full two-word instructions and reports branches', () => {
		const cpu = machine('ldi r16, 0\ncpse r16, r16\nlds r17, 0x100\ninc r16\nbreak')
		const branches: boolean[] = []
		cpu.observers.push({ onBranch: (_pc, taken) => branches.push(taken) })
		cpu.step()
		cpu.step()
		expect(cpu.pc).toBe(8)
		cpu.step()
		expect(cpu.registers[16]).toBe(1)
		expect(branches).toEqual([true])
	})
	it('decodes word order used by the shared source gutter', () => {
		const cpu = machine('ldi r16, 42\nlds r17, 0x100\nld r18, X+\nst -Y, r18\nbreak')
		const rows = Array.from(cpu.program.sourceIndex.rowsForLine('main.asm', 1))
		expect(disassembly.row(codeRowOf(rows[0], cpu.inspectMemory()))).toBe('ldi r16, 0x2a')
		expect(disassembly.at(cpu.inspectMemory(), 6)).toBe('ld r18, X+')
		expect(disassembly.at(cpu.inspectMemory(), 8)).toBe('st -Y, r18')
	})
	it('faults unknown instructions and I/O atomically, notifying rewind observers', () => {
		const cpu = machine('ldi r16, 5\nout 0, r16\nbreak')
		let seek = -1
		cpu.observers.push({
			onSeek: (count) => {
				seek = count
			}
		})
		cpu.step()
		expect(() => cpu.step()).toThrow(/peripheral/)
		expect(cpu.pc).toBe(2)
		expect(cpu.instructionCount).toBe(1)
		expect(cpu.history.length).toBe(1)
		expect(seek).toBe(1)
		expect(
			assembleAvr({ files: [{ name: 'a', code: 'sleep' }], entries: ['a'] }).diagnostics[0].message
		).toMatch(/Unsupported/)
	})
	it('records user edits and crossing history block boundaries', () => {
		const cpu = machine('inc r16\nrjmp 0', 2)
		for (let i = 0; i < 4200; i++) cpu.step()
		expect(cpu.history.length).toBeGreaterThan(0)
		expect(cpu.history.length).toBeLessThan(2051)
		const previous = cpu.registers[16]
		cpu.writeRegister('r16', 42)
		expect(
			cpu.historyFormat
				.effects(cpu.history.at(cpu.history.length - 1)!, true)
				.some((effect) => effect.register === 'r16' && effect.value === previous)
		).toBe(true)
		cpu.stepBack()
		expect(cpu.registers[16]).toBe(previous)
		expect(cpu.writeByte(0x10100, 42)).toBe(true)
		cpu.stepBack()
		expect(cpu.data[0x100]).toBe(0)
	})
	it('has bounded includes and diagnoses immediate/alignment limits', () => {
		const result = assembleAvr({
			files: [
				{ name: 'a', code: '.include "b"' },
				{ name: 'b', code: 'ldi r16, 2\nbreak' }
			],
			entries: ['a']
		})
		expect(result.diagnostics).toEqual([])
		for (const code of ['ldi r0, 1', 'ldi r16, 256', '.org 1\nnop', 'rjmp 3', 'ld r26, X+'])
			expect(assembleAvr({ files: [{ name: 'a', code }], entries: ['a'] }).diagnostics).not.toEqual(
				[]
			)
	})
	it('records recursive frames with constant payload size per call', () => {
		const cpu = machine('rcall 0')
		for (let i = 0; i < 3000; i++) cpu.step()
		expect(cpu.callStack).toHaveLength(3000)
		const payload = cpu.log.entries.payload(cpu.log.first) as { depth: number; frame?: unknown }
		expect(payload).toEqual({ depth: 0, frame: undefined })
		while (cpu.stepBack()) {
			/* inverse deltas undo every call */
		}
		expect(cpu.callStack).toHaveLength(0)
		expect(cpu.sp).toBe(65535)
	})
	it('runs through services and rejects use after disposal', async () => {
		const service = definition.createServices()
		const program = service.assemble(
			{ files: [{ name: 'a', code: 'ldi r16, 5\ninc r16\nbreak' }], entries: ['a'] },
			{}
		)
		const cpu = service.createMachine(program, {}, { speed: null, historyLimit: 100 })
		await cpu.run()
		expect(cpu.registerValues().r16).toBe(6)
		service.dispose()
		expect(() => service.assemble({ files: [], entries: [] }, {})).toThrow(/disposed/)
	})
	it('keeps quoted semicolons as character data', () => {
		const cpu = execute("ldi r16, ';' ; comment\nbreak")
		expect(cpu.registers[16]).toBe(59)
	})
})
