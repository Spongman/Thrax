import { describe, expect, it } from 'vitest'
import type { InstructionHelp } from '../../core/instructionHelp'
import { EMPTY_MEMORY, type DebugInspection } from '../contracts'
import { INSTRUCTION_MNEMONICS } from '../mips/core/isa'
import { instructionHelp } from '../mips/core/isaDocs'
import { OPCODE_MNEMONIC } from '../beta/isa'
import { betaInstructionHelp } from '../beta/instructionHelp'
import { MNEMONICS as Z80 } from '../z80/asm/encoder'
import { z80InstructionHelp } from '../z80/instructionHelp'
import { NMOS_MODEL, W65C02_MODEL } from '../mos6502/isa'
import { mos6502InstructionHelp } from '../mos6502/instructionHelp'
import { ARCH_V2A, ARCH_V8 } from '../arm/a32/isa'
import { MNEMONICS as ARM, MNEMONICS_V8 } from '../arm/assembler/instructions'
import { armInstructionHelp } from '../arm/instructionHelp'
import { A64_MNEMONICS } from '../armv8/a64/assembler/encoder'
import { a64InstructionHelp } from '../armv8/instructionHelp'
import { MNEMONICS as M0 } from '../armv8/m0/isa'
import { m0InstructionHelp } from '../armv8/m0/instructionHelp'
import { MNEMONICS as AVR } from '../avr/isa'
import { avrInstructionHelp } from '../avr/instructionHelp'
import { MNEMONICS as RV } from '../riscv/isa'
import { COMPRESSED_MNEMONICS } from '../riscv/compressed'
import { riscvInstructionHelp } from '../riscv/instructionHelp'
import { MNEMONICS as M68K } from '../m68k/isa'
import { m68kInstructionHelp } from '../m68k/instructionHelp'
import { describeRiscvToken } from '../riscv/editor'
import { describeAvrToken } from '../avr/editor'
import { describeToken as describeM68kToken } from '../m68k/editor'
import { describeM0Token } from '../armv8/m0/dataTips'

const catalogs: [string, readonly string[], (name: string) => InstructionHelp | null][] = [
	['MIPS', [...INSTRUCTION_MNEMONICS], instructionHelp],
	['Beta', OPCODE_MNEMONIC.filter((name) => !!name && name !== 'PRIV'), betaInstructionHelp],
	['Z80', [...Z80], z80InstructionHelp],
	['6502', NMOS_MODEL.mnemonics, mos6502InstructionHelp],
	['65C02', W65C02_MODEL.mnemonics, (name) => mos6502InstructionHelp(name, W65C02_MODEL)],
	['ARM26', ARM, (name) => armInstructionHelp(name, ARCH_V2A)],
	['A32', MNEMONICS_V8, (name) => armInstructionHelp(name, ARCH_V8)],
	['A64', A64_MNEMONICS, a64InstructionHelp],
	['Cortex-M0', M0, m0InstructionHelp],
	['AVR', AVR, avrInstructionHelp],
	['RV32IM/C', [...RV, ...COMPRESSED_MNEMONICS], riscvInstructionHelp],
	['68k', M68K, m68kInstructionHelp],
]

describe('instruction help across CPUs', () => {
	it.each(catalogs)('%s has instruction-specific help and syntax for its entire completion catalog', (_name, names, help) => {
		for (const name of names) {
			const tip = help(name)
			expect(tip, name).not.toBeNull()
			expect(tip!.contents[0], name).toMatch(new RegExp(`^\\*\\*${name.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*\\*`))
			expect(tip!.contents[1], name).not.toMatch(/integer assembly|teaching profile|W65C02S instruction/)
			expect(tip!.contents[1], name).toBeTruthy()
			expect(tip!.contents[2], name).toMatch(/^Syntax: `/)
			expect(tip!.contents.join(' '), name).not.toContain('Instruction reference')
		}
	})

	it.each(catalogs)('%s ignores unknown identifiers and Object prototype names', (_name, _names, help) => {
		for (const word of ['unknown', 'constructor', 'toString', '__proto__']) expect(help(word), word).toBeNull()
	})

	it('distinguishes signed and unsigned branches and compressed return addresses', () => {
		expect(riscvInstructionHelp('BGE')?.contents).toContain('Branch to target if rs1 is greater than or equal to rs2 as signed integers.')
		expect(riscvInstructionHelp('bgeu')?.contents[1]).toContain('unsigned integers')
		expect(riscvInstructionHelp('c.jalr')?.contents[1]).toContain('PC + 2')
		expect(riscvInstructionHelp('jalr')?.contents[1]).toContain('PC + 4')
	})

	it('retains native conditional, flag, model and addressing differences', () => {
		expect(armInstructionHelp('addseq')?.contents).toContain('Executes when equal (Z = 1).')
		expect(armInstructionHelp('addseq')?.contents).toContain('Updates condition flags.')
		expect(armInstructionHelp('ldreqsb', ARCH_V8)?.contents[1]).toContain('sign-extend')
		expect(armInstructionHelp('ldrex', ARCH_V2A)).toBeNull()
		expect(m0InstructionHelp('sdiv')).toBeNull()
		expect(a64InstructionHelp('b.nv')?.contents[1]).toBe('Branch when always.')
		expect(m68kInstructionHelp('movea.w')?.contents[1]).toContain('sign-extended')
		expect(m68kInstructionHelp('dbne')?.contents[1]).toContain('0xFFFF')
		expect(mos6502InstructionHelp('SLO')?.contents[0]).toContain('undocumented NMOS')
		expect(mos6502InstructionHelp('SLO', W65C02_MODEL)).toBeNull()
		expect(mos6502InstructionHelp('BBR3', W65C02_MODEL)?.contents[1]).toContain('bit 3')
	})
})

const state: DebugInspection = { registers: { x1: 8, r1: 9, R1: 10, D0: 11 }, memory: EMPTY_MEMORY, labels: new Map([['loop', 16]]) }

it.each([
	['riscv', 'bge x1, x2, loop', describeRiscvToken, riscvInstructionHelp('bge')],
	['avr', 'breq loop', describeAvrToken, avrInstructionHelp('breq')],
	['m68k', 'move.w d0, d1', describeM68kToken, m68kInstructionHelp('move.w')],
	['m0', 'adds r0, r1, r2', describeM0Token, m0InstructionHelp('adds')],
] as const)('%s exposes the same instruction content and reference to source and disassembly', (_arch, line, describeToken, help) => {
	expect(describeToken(line, 1, state)).toMatchObject(help!)
})
