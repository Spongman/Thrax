import { describe, expect, it } from 'vitest'
import type { DebugInspection, MemoryInspector } from '../../contracts'
import { describeMos6502Token } from '../editor/dataTips'
import { findMos6502Definition, mos6502SymbolAt } from '../editor/definition'
import { MOS6502_DIRECTIVES, mos6502Monarch } from '../editor/grammar'
import definition from '../index'
import { DEFAULT_MOS6502_SETTINGS } from '../settings'
import { NMOS_MODEL } from '../isa'

const memory: MemoryInspector = {
	wordBytes: 1,
	littleEndian: true,
	byte: (address) => address === 0x0610 ? 0x2A : 0,
	word: (address) => address === 0x0610 ? 0x2A : 0,
}

const state: DebugInspection = { registers: { A: 5, X: 0x10, Y: 0 }, memory, labels: new Map([['loop', 0x0610]]) }

const tip = (line: string, text: string) => describeMos6502Token(line, line.indexOf(text), state, { value: (name) => name === 'OUT' ? 0xF000 : undefined })

describe('6502 data tips', () => {
	it('shows registers, labels with their byte, and symbols', () => {
		expect(tip('\tsta $0200,x', 'x')).toMatchObject({ register: 'X', contents: ['**X**\n\n`$10 (16)`'] })
		expect(tip('\tjmp loop', 'loop')).toMatchObject({ address: 0x0610, contents: ['**Label loop**\n\n`$0610`', '`[$0610]` = `$2A (42)`'] })
		expect(tip('\tsta OUT', 'OUT')?.contents).toEqual(['**OUT**\n\n`$F000 (61440)`'])
	})

	it('names an address a disassembly shows in hex, but not an immediate', () => {
		expect(tip('JMP $0610', '$0610')).toMatchObject({ address: 0x0610, contents: [expect.stringContaining('**loop**'), expect.stringContaining('$2A')] })
		expect(tip('LDA #$10', '$10')).toEqual({ start: 5, length: 3, contents: ['**Number**\n\n`$10 (16)`'] })
	})

	it('describes mnemonics with their modes', () => {
		const described = tip('\tldx #1', 'ldx')
		expect(described?.contents[0]).toBe('**[LDX](https://www.pagetable.com/c64ref/6502/?tab=2#LDX "Open LDX in the manual")**')
		expect(described?.contents[1]).toBe('Load X (NZ)')
		expect(described?.contents[3]).toBe('Modes: immediate, zero page, zero page,Y, absolute, absolute,Y')
	})

	it('says nothing in a comment', () => {
		expect(tip('\tnop ; loop again', 'loop')).toBeNull()
	})

	it('answers for the gutter through the services', () => {
		const services = definition.createServices()
		expect(services.describeToken?.('LDA #$05', 0, state)?.contents[1]).toContain('Load A')
		services.dispose()
	})
})

describe('6502 go to definition', () => {
	const files = [
		{ name: 'main.s', code: 'COUNT = 3\nstart:  ldx #COUNT ; start:\n.macro twice v\n.endmacro\n' },
		{ name: 'lib.s', code: '  print: rts\nVALUE .equ 4\n' },
	]

	it('finds labels, symbols and macros across files', () => {
		expect(findMos6502Definition(files, 'start')).toEqual({ file: 'main.s', line: 2, column: 1, endColumn: 6 })
		expect(findMos6502Definition(files, 'COUNT')).toMatchObject({ file: 'main.s', line: 1 })
		expect(findMos6502Definition(files, 'twice')).toEqual({ file: 'main.s', line: 3, column: 8, endColumn: 13 })
		expect(findMos6502Definition(files, 'print')).toEqual({ file: 'lib.s', line: 1, column: 3, endColumn: 8 })
		expect(findMos6502Definition(files, 'VALUE')).toMatchObject({ file: 'lib.s', line: 2 })
		expect(findMos6502Definition(files, 'missing')).toBeNull()
	})

	it('reads the name under the pointer, local labels included', () => {
		expect(mos6502SymbolAt('\tbne @loop', 7)).toBe('@loop')
		expect(mos6502SymbolAt('\tlda #<msg', 8)).toBe('msg')
	})
})

describe('6502 editor language', () => {
	it('knows every directive, NMOS mnemonic and supported alias in both cases', () => {
		expect(MOS6502_DIRECTIVES).toEqual(expect.arrayContaining(['org', 'byte', 'word', 'res', 'ascii', 'asciiz', 'include', 'macro', 'endmacro', 'equ']))
		expect((mos6502Monarch.mnemonics as string[]).length).toBe(NMOS_MODEL.mnemonics.length * 2)
		expect(mos6502Monarch.mnemonics).toEqual(expect.arrayContaining(['SLO', 'slo', 'JAM', 'jam']))
	})

	it('offers its settings with a default', () => {
		expect(definition.settings.defaults).toEqual(DEFAULT_MOS6502_SETTINGS)
		expect(definition.registers.map((register) => register.id)).toEqual(['A', 'X', 'Y', 'SP', 'PC', 'P', 'N', 'V', 'B', 'D', 'I', 'Z', 'C', 'CYC'])
	})
})
