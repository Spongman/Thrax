import { describe, expect, it } from 'vitest'
import { assembleMos6502 } from '../assembler'
import {
	FLAG_C,
	FLAG_D,
	FLAG_I,
	FLAG_N,
	FLAG_U,
	FLAG_V,
	FLAG_Z,
	Mos6502Cpu,
	STEP_FAULT,
	STEP_HALT,
	STEP_INTERRUPT,
	STEP_OK,
	STEP_WAIT
} from '../cpu'
import { disassemble, instructionLength } from '../disassemble'
import { ENABLE_KEYBOARD, ENABLE_TIMER } from '../device'
import { cmosPrimer } from '../examples'
import definition from '../index'
import { modelFor, NMOS_MODEL, W65C02_MODEL } from '../isa'
import { Mos6502Machine } from '../machine'
import { Mos6502Assembly } from '../program'
import { Mos6502Runtime } from '../runtime'

function assemble(code: string) {
	const result = assembleMos6502({ name: 'test.s', code }, { model: W65C02_MODEL })
	expect(result.diagnostics).toEqual([])
	return result
}
function machine(code: string) {
	const cpu = new Mos6502Machine({ model: W65C02_MODEL, historyLimit: 10000 })
	cpu.load(assemble(code).image!)
	return cpu
}
function run(code: string) {
	const cpu = machine(code)
	cpu.run(10000)
	return cpu
}
describe('WDC W65C02S model', () => {
	it('uses independent documented encodings for its added instructions and modes', () => {
		const result = assemble(
			'bra next\nnext: stz $12\nstz $1234,x\ntrb $12\ntsb $1234\nphx\nplx\nphy\nply\ninc a\ndec a\njmp ($1234,x)\nlda ($12)\nsmb3 $12\nrmb7 $34\nbbr2 $12, done\nbbs5 $34, done\ndone: wai\nstp'
		)
		expect(Array.from(result.image!.sections[0].bytes)).toEqual([
			0x80, 0, 0x64, 0x12, 0x9e, 0x34, 0x12, 0x14, 0x12, 0x0c, 0x34, 0x12, 0xda, 0xfa, 0x5a, 0x7a,
			0x1a, 0x3a, 0x7c, 0x34, 0x12, 0xb2, 0x12, 0xb7, 0x12, 0x77, 0x34, 0x2f, 0x12, 3, 0xdf, 0x34,
			0, 0xcb, 0xdb
		])
	})
	it('rejects CMOS forms under NMOS while preserving its illegal-opcode faults', () => {
		for (const code of [
			'stz $10',
			'bra *',
			'inc a',
			'lda ($10)',
			'jmp ($1234,x)',
			'bit #1',
			'wai',
			'bbs7 $10,*'
		])
			expect(assembleMos6502({ name: 'n.s', code }).diagnostics.length).toBeGreaterThan(0)
		const cpu = new Mos6502Cpu()
		cpu.memory[0] = 0x64
		expect(cpu.step()).toBe(STEP_FAULT)
		expect(modelFor()).toBe(NMOS_MODEL)
	})
	it('runs new memory/stack/accumulator operations and reverses them', () => {
		const m = run(cmosPrimer.code)
		expect(m.halted).toBe(true)
		expect(m.cpu.stopped).toBe(true)
		expect(m.cpu.x).toBe(42)
		expect(m.cpu.a).toBe(43)
		expect(m.cpu.memory[0x200]).toBe(43)
		expect(m.cpu.memory[0x10]).toBe(8)
		while (m.history!.stepBack()) {
			/* restore reset */
		}
		expect(m.cpu.stopped).toBe(false)
		expect(m.cpu.memory[0x200]).toBe(0)
		expect(m.cpu.memory[0x10]).toBe(0)
		expect(m.cpu.a).toBe(0)
		expect(m.cpu.sp).toBe(0xfd)
	})
	it('updates only Z for BIT immediate and TRB/TSB; leaves flags for RMB/SMB', () => {
		const m = run(
			'lda #$80\npha\nlda #$c1\npha\nplp\npla\nbit #$01\nphp\npla\nsta $20\nlda #$0f\nsta $10\nlda #$f0\ntsb $10\nphp\npla\nsta $21\nlda #$0f\ntrb $10\nsmb2 $10\nrmb7 $10\nstp'
		)
		expect(m.cpu.memory[0x20] & (FLAG_N | FLAG_V | FLAG_Z | FLAG_C)).toBe(
			FLAG_N | FLAG_V | FLAG_Z | FLAG_C
		)
		expect(m.cpu.memory[0x21] & FLAG_Z).toBe(FLAG_Z)
		expect(m.cpu.memory[0x10]).toBe(0x74)
	})
	it('supports all zero-page indirect ALU/store forms and wraps the pointer within zero page', () => {
		const m = run(
			'lda #$00\nsta $ff\nlda #$02\nsta $00\nlda #42\nsta ($ff)\nlda ($ff)\nand ($ff)\nora ($ff)\neor ($ff)\nclc\nadc ($ff)\nsec\nsbc ($ff)\ncmp ($ff)\nstp'
		)
		expect(m.cpu.memory[0x200]).toBe(42)
		expect(m.cpu.a).toBe(0)
		expect(m.cpu.p & FLAG_C).toBe(0)
	})
	it('fixes JMP indirect page wrap and supports indexed absolute indirect', () => {
		const cpu = new Mos6502Cpu(W65C02_MODEL)
		cpu.memory.set([0x6c, 0xff, 0x12], 0)
		cpu.memory[0x12ff] = 0x78
		cpu.memory[0x1200] = 0x99
		cpu.memory[0x1300] = 0x56
		cpu.step()
		expect(cpu.pc).toBe(0x5678)
		expect(cpu.cycles).toBe(13)
		cpu.pc = 0
		cpu.x = 2
		cpu.memory[0] = 0x7c
		cpu.memory[1] = 0xfd
		cpu.step()
		expect(cpu.pc).toBe(0x5678)
	})
	it('sets decimal NZ from the adjusted result and adds one arithmetic cycle', () => {
		const cpu = new Mos6502Cpu(W65C02_MODEL)
		cpu.memory.set([0x69, 0x01])
		cpu.a = 0x99
		cpu.p = FLAG_U | FLAG_D
		cpu.step()
		expect(cpu.a).toBe(0)
		expect(cpu.p & (FLAG_N | FLAG_Z | FLAG_C)).toBe(FLAG_Z | FLAG_C)
		expect(cpu.cycles).toBe(10)
		cpu.pc = 0
		cpu.memory[0] = 0xe9
		cpu.a = 0
		cpu.p = FLAG_U | FLAG_D | FLAG_C
		cpu.step()
		expect(cpu.a).toBe(0x99)
		expect(cpu.p & (FLAG_N | FLAG_Z | FLAG_C)).toBe(FLAG_N)
	})
	it('clears D on IRQ/NMI and BRK after pushing its old value', () => {
		for (const brk of [false, true]) {
			const cpu = new Mos6502Cpu(W65C02_MODEL)
			cpu.p |= FLAG_D
			if (brk) cpu.step()
			else cpu.interrupt(0xfffa)
			expect(cpu.p & FLAG_D).toBe(0)
			expect(cpu.memory[0x1fb] & FLAG_D).toBe(FLAG_D)
		}
	})
	it('records WAI, waits without extra history, wakes on masked IRQ and rewinds its sleeping state', () => {
		const m = machine('sei\nwai\ninc $10\nstp')
		m.step()
		m.step()
		expect(m.cpu.sleeping).toBe(true)
		const length = m.history!.length
		expect(m.step()).toBe(STEP_WAIT)
		expect(m.history!.length).toBe(length)
		m.device.control = ENABLE_KEYBOARD
		m.device.feed('k')
		expect(m.step()).toBe(STEP_OK)
		expect(m.cpu.memory[0x10]).toBe(1)
		expect(m.cpu.sleeping).toBe(false)
		expect(m.cpu.p & FLAG_I).toBe(FLAG_I)
		m.history!.stepBack()
		expect(m.cpu.sleeping).toBe(true)
		expect(m.cpu.memory[0x10]).toBe(0)
	})
	it('lets the timer run through WAI and takes an unmasked IRQ, with reversible elapsed clocks', () => {
		const m = machine('cli\nwai\nstp\n.org $0700\nrti\n.org $fffe\n.word $0700')
		m.step()
		m.step()
		m.device.control = ENABLE_TIMER
		m.device.period = 100
		m.device.timer = 100
		const cycles = m.cpu.cycles
		expect(m.step()).toBe(STEP_INTERRUPT)
		expect(m.cpu.pc).toBe(0x700)
		expect(m.cpu.cycles).toBe(cycles + 107)
		m.history!.stepBack()
		expect(m.cpu.sleeping).toBe(true)
		expect(m.cpu.cycles).toBe(cycles)
		expect(m.device.timer).toBe(100)
	})
	it('only reset or debugger rewind leaves STP; NMI cannot wake it', () => {
		const m = machine('stp\ninc $10')
		m.step()
		m.nmi()
		expect(m.step()).toBe(STEP_HALT)
		expect(m.cpu.memory[0x10]).toBe(0)
		m.history!.stepBack()
		expect(m.cpu.stopped).toBe(false)
		expect(m.halted).toBe(false)
		m.cpu.reset()
		expect(m.cpu.sleeping).toBe(false)
		expect(m.cpu.stopped).toBe(false)
	})
	it('retains atomic device waits for new read/modify/write forms', () => {
		const m = machine('lda #1\ntrb $f001\nstp')
		m.step()
		const count = m.history!.length,
			p = m.cpu.p,
			pc = m.cpu.pc
		expect(m.step()).toBe(STEP_WAIT)
		expect(m.cpu.pc).toBe(pc)
		expect(m.cpu.p).toBe(p)
		expect(m.history!.length).toBe(count)
	})
	it('disassembles and classifies the active model without changing NMOS', () => {
		expect(disassemble([0xb2, 0x10], 0, undefined, W65C02_MODEL)).toBe('LDA ($10)')
		expect(disassemble([0x7c, 0x34, 0x12], 0, undefined, W65C02_MODEL)).toBe('JMP ($1234,X)')
		expect(disassemble([0x2f, 0x10, 0xfd], 0x600, undefined, W65C02_MODEL)).toBe('BBR2 $10,$0600')
		expect(disassemble([0xb2, 0x10])).toBe('.byte $B2')
		expect(instructionLength(0x2f, W65C02_MODEL)).toBe(3)
		const result = assemble('bbr0 $10, done\ndone: stp')
		const program = new Mos6502Assembly(
			'test.s',
			result.image,
			result.diagnostics,
			[],
			result.values,
			W65C02_MODEL
		)
		const runtime = new Mos6502Runtime(program, { decimal: true, historyLimit: 100, speed: null })
		const branches: boolean[] = []
		runtime.observers.push({ onBranch: (_pc, taken) => branches.push(taken) })
		runtime.step()
		expect(branches).toEqual([true])
		expect(runtime.toolConfig().instructions!.describe(0x2f).isBranch).toBe(true)
		expect(runtime.historyFormat.instruction(runtime.history.at(0)!)).toBe('BBR0 $10,$0603')
	})
	it('implements WDC reserved NOP byte lengths and cycle counts', () => {
		for (const [opcode, length, clocks] of [
			[0x03, 1, 1],
			[0x02, 2, 2],
			[0x44, 2, 3],
			[0x54, 2, 4],
			[0x5c, 3, 8],
			[0xdc, 3, 4]
		]) {
			const cpu = new Mos6502Cpu(W65C02_MODEL)
			cpu.memory[0] = opcode
			cpu.step()
			expect(cpu.pc).toBe(length)
			expect(cpu.cycles).toBe(7 + clocks)
		}
	})
	it('selects model settings and variant examples while keeping the target id', async () => {
		expect(definition.id).toBe('mos6502')
		expect(definition.variant!({ cpuModel: 'w65c02' }).language).toBe('ca65-w65c02')
		expect(definition.variant!({ cpuModel: 'w65c02' }).examples.bitmap).toBeDefined()
		const services = definition.createServices()
		const settings = { cpuModel: 'w65c02' as const, decimalMode: true }
		const program = services.assemble(
			{ files: [{ name: 'test.s', code: cmosPrimer.code }], entries: ['test.s'] },
			settings
		)
		expect(program.diagnostics).toEqual([])
		const runtime = services.createMachine(program, settings, { speed: null, historyLimit: 100 })
		await runtime.run()
		expect(runtime.registerValues().A).toBe(43)
		services.dispose()
	})
})
