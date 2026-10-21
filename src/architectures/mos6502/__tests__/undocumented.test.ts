import { describe, expect, it } from 'vitest'
import { assembleMos6502 } from '../assembler'
import { disassemble, instructionLength } from '../disassemble'
import { FLAG_B, FLAG_U, Mos6502Cpu, STEP_OK } from '../cpu'
import { NMOS_MODEL, W65C02_MODEL } from '../isa'
import { Mos6502Machine } from '../machine'
import { ACCESS_READ, ACCESS_WRITE, Mos6502Access, classifyAt } from '../instructions'
import vectors from './fixtures/nmos-vectors.json'

// First 32 cases per selected opcode from SingleStepTests/65x02, 6502/v1.
// Independent emulator vectors, including decimal and page-crossing cases.
// https://github.com/SingleStepTests/65x02 (MIT; license beside the fixture).
describe('independent NMOS unintended-instruction vectors', () => {
	it.each(vectors)('$name', (vector) => {
		const cpu = new Mos6502Cpu()
		const initial = vector.initial
		Object.assign(cpu, { a: initial.a, x: initial.x, y: initial.y, sp: initial.s, pc: initial.pc, p: (initial.p & ~FLAG_B) | FLAG_U, cycles: 0 })
		for (const [address, value] of initial.ram) cpu.memory[address] = value
		expect(cpu.step()).toBe(STEP_OK)
		const end = vector.final
		expect([cpu.pc, cpu.a, cpu.x, cpu.y, cpu.sp, cpu.p, cpu.cycles]).toEqual([
			end.pc, end.a, end.x, end.y, end.s, (end.p & ~FLAG_B) | FLAG_U, vector.cycles,
		])
		for (const [address, value] of end.ram) expect(cpu.memory[address], `RAM $${address.toString(16)}`).toBe(value)
	})
})

const FORMS: readonly [string, number[]][] = [
	['SLO ($44,X)', [0x03, 0x44]], ['SLO $44', [0x07, 0x44]], ['SLO $4400', [0x0F, 0, 0x44]],
	['SLO ($44),Y', [0x13, 0x44]], ['SLO $44,X', [0x17, 0x44]], ['SLO $4400,Y', [0x1B, 0, 0x44]], ['SLO $4400,X', [0x1F, 0, 0x44]],
	['RLA $44', [0x27, 0x44]], ['SRE $44', [0x47, 0x44]], ['RRA $44', [0x67, 0x44]],
	['SAX $44', [0x87, 0x44]], ['SAX $44,Y', [0x97, 0x44]], ['SAX ($44,X)', [0x83, 0x44]], ['SAX $4400', [0x8F, 0, 0x44]],
	['LAX #$44', [0xAB, 0x44]], ['LAX $44', [0xA7, 0x44]], ['LAX $44,Y', [0xB7, 0x44]], ['LAX $4400,Y', [0xBF, 0, 0x44]],
	['LAX ($44,X)', [0xA3, 0x44]], ['LAX ($44),Y', [0xB3, 0x44]], ['LAX $4400', [0xAF, 0, 0x44]],
	['DCP $44', [0xC7, 0x44]], ['ISC $44', [0xE7, 0x44]], ['ANC #$44', [0x0B, 0x44]], ['ALR #$44', [0x4B, 0x44]],
	['ARR #$44', [0x6B, 0x44]], ['AXS #$44', [0xCB, 0x44]], ['XAA #$44', [0x8B, 0x44]], ['LAS $4400,Y', [0xBB, 0, 0x44]],
	['AHX ($44),Y', [0x93, 0x44]], ['AHX $4400,Y', [0x9F, 0, 0x44]], ['SHX $4400,Y', [0x9E, 0, 0x44]],
	['SHY $4400,X', [0x9C, 0, 0x44]], ['TAS $4400,Y', [0x9B, 0, 0x44]], ['KIL', [0x02]],
	['NOP #$44', [0x80, 0x44]], ['NOP $44', [0x04, 0x44]], ['NOP $44,X', [0x14, 0x44]],
	['NOP $4400', [0x0C, 0, 0x44]], ['NOP $4400,X', [0x1C, 0, 0x44]],
]

describe('NMOS assembly and disassembly', () => {
	it.each(FORMS)('encodes and decodes %s independently', (code, bytes) => {
		const result = assembleMos6502({ name: 'main.s', code })
		expect(result.diagnostics).toEqual([])
		expect(Array.from(result.image!.sections[0].bytes)).toEqual(bytes)
		expect(disassemble(bytes)).toBe(code)
		expect(instructionLength(bytes[0])).toBe(bytes.length)
	})
	it('decodes every NMOS byte, keeping CMOS replacements isolated', () => {
		for (let opcode = 0; opcode < 256; opcode++) {
			expect(NMOS_MODEL.instructions[opcode]).toBeGreaterThanOrEqual(0)
			expect(disassemble([opcode, 0x10, 0x20])).not.toContain('.byte')
		}
		for (const [bytes, nmos, cmos] of [
			[[0x07, 0x10], 'SLO $10', 'RMB0 $10'], [[0xCB, 0x10], 'AXS #$10', 'WAI'],
			[[0xDB, 0x10, 0x20], 'DCP $2010,Y', 'STP'], [[0x9C, 0x10, 0x20], 'SHY $2010,X', 'STZ $2010'],
		] as const) {
			expect(disassemble(bytes)).toBe(nmos)
			expect(disassemble(bytes, 0, undefined, W65C02_MODEL)).toBe(cmos)
		}
		for (const code of ['slo $10', 'lax #1', 'jam', 'axs #1', 'shx $1234,y'])
			expect(assembleMos6502({ name: 'c.s', code }, { model: W65C02_MODEL }).diagnostics.length).toBeGreaterThan(0)
	})
	it.each([['ASO $10', 0x07], ['ISB $10', 0xE7], ['SBX #1', 0xCB], ['ANE #1', 0x8B], ['SHA $1234,Y', 0x9F], ['JAM', 0x02]])('accepts alias %s', (code, opcode) => {
		const result = assembleMos6502({ name: 'main.s', code: String(code) })
		expect(result.diagnostics).toEqual([])
		expect(result.image!.sections[0].bytes[0]).toBe(opcode)
	})
})

describe('NMOS side effects and rewind', () => {
	it('reads through a memory NOP without changing registers or flags', () => {
		const cpu = new Mos6502Cpu()
		cpu.memory.set([0x0C, 0x00, 0xF0], 0x600)
		cpu.pc = 0x600
		const reads: number[] = []
		cpu.io = { read: (address) => { reads.push(address); return 0x80 }, write: () => {} }
		const before = [cpu.a, cpu.x, cpu.y, cpu.sp, cpu.p]
		cpu.step()
		expect(reads).toEqual([0xF000])
		expect([cpu.a, cpu.x, cpu.y, cpu.sp, cpu.p]).toEqual(before)
	})
	it('classifies both halves of compound operations and the corrupted masked-store address', () => {
		const cpu = new Mos6502Cpu()
		cpu.memory.set([0x07, 0x10, 0x9E, 0xFF, 0x12], 0x600)
		cpu.pc = 0x600
		expect(classifyAt(cpu, new Mos6502Access())).toMatchObject({ flags: ACCESS_READ | ACCESS_WRITE, address: 0x10 })
		cpu.pc += 2
		cpu.x = 0x0F
		cpu.y = 1
		expect(classifyAt(cpu, new Mos6502Access())).toMatchObject({ flags: ACCESS_WRITE, address: 0x0300 })
		cpu.step()
		expect(cpu.memory[0x0300]).toBe(3)
		expect(cpu.memory[0x1300]).toBe(0)
	})
	it('rewinds compound memory/register effects and a jammed CPU', () => {
		const result = assembleMos6502({ name: 'main.s', code: 'lda #$81\nsta $10\nslo $10\njam' })
		expect(result.diagnostics).toEqual([])
		const machine = new Mos6502Machine({ historyLimit: 100 })
		machine.load(result.image!)
		machine.run(10)
		expect(machine.cpu.a).toBe(0x83)
		expect(machine.cpu.memory[0x10]).toBe(2)
		expect(machine.halted).toBe(true)
		machine.history!.stepBack()
		expect(machine.halted).toBe(false)
		expect(machine.cpu.stopped).toBe(false)
		machine.history!.stepBack()
		expect(machine.cpu.a).toBe(0x81)
		expect(machine.cpu.memory[0x10]).toBe(0x81)
	})
})
