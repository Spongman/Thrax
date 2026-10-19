import { describe, expect, it } from 'vitest'
import { EMPTY_MEMORY, type DebugInspection } from '../../contracts'
import { describeZ80Token } from '../editor/dataTips'
import { findZ80Definition, z80SymbolAt } from '../editor/definition'
import { z80Monarch } from '../editor/grammar'
import { Z80Memory } from '../runtime'

const memory = new Uint8Array(0x10000)
memory[0x8000] = 0x34
memory[0x8001] = 0x12

const state: DebugInspection = {
	registers: { A: 0x42, HL: 0x8000, IX: 0x1234 },
	memory: new Z80Memory(memory),
	labels: new Map([['buffer', 0x8000]]),
}

describe('Z80 data tips', () => {
	it('shows a register, and what a pair points at', () => {
		const a = describeZ80Token('\tld a,(hl)', 4, state)
		expect(a?.register).toBe('A')
		expect(a?.contents[0]).toContain('$42')
		const hl = describeZ80Token('\tld a,(hl)', 7, state)
		expect(hl?.register).toBe('HL')
		expect(hl?.contents.join('\n')).toContain('word `$1234`')
	})

	it('shows an index half from its pair', () => {
		expect(describeZ80Token('\tld a,ixh', 7, state)?.contents[0]).toContain('$12')
	})

	it('shows a label with the memory there, and numbers in every spelling', () => {
		const label = describeZ80Token('\tld hl,buffer', 8, state)
		expect(label?.address).toBe(0x8000)
		expect(describeZ80Token('\tld a,0FFh', 6, state)?.contents[0]).toContain('255')
		expect(describeZ80Token('\tld a,%101', 6, state)?.contents[0]).toContain('$05')
		// The disassembly's four-digit addresses name the label.
		expect(describeZ80Token('LD HL,$8000', 7, state)?.contents[0]).toContain('buffer')
	})

	it('says nothing in a comment', () => {
		expect(describeZ80Token('\tnop ; hl', 8, { ...state, memory: EMPTY_MEMORY })).toBeNull()
	})
})

describe('Z80 go to definition', () => {
	const files = [{ title: 'main.z80', code: 'COUNT equ 3\nstart:\tld a,COUNT\nloop\tjr loop\nshow macro x\n\tendm\n' }]

	it('finds labels with and without a colon, equates and macros', () => {
		expect(findZ80Definition(files, 'COUNT')).toMatchObject({ line: 1, column: 1 })
		expect(findZ80Definition(files, 'start')).toMatchObject({ line: 2, column: 1 })
		expect(findZ80Definition(files, 'loop')).toMatchObject({ line: 3, column: 1 })
		expect(findZ80Definition(files, 'show')).toMatchObject({ line: 4, column: 1 })
		expect(findZ80Definition(files, 'count')).toBeNull()
	})

	it('picks the name under the pointer', () => {
		expect(z80SymbolAt('\tjp .loop', 6)).toBe('.loop')
	})
})

describe('Z80 grammar', () => {
	it('knows the instructions and directives', () => {
		expect(z80Monarch.mnemonics).toContain('ldir')
		expect(z80Monarch.directives).toContain('.org')
		expect(z80Monarch.registers).toContain('af\'')
	})
})
