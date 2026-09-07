import { describe, expect, it } from 'vitest'
import { findDefinition, symbolAt } from '../gotoDefinition'

const MAIN = { title: 'main.asm', code: '.include "lib.asm"\n.eqv SIZE 64\nmain:\n\tla $a0, buffer\n\tjal helper\n\tli $v0, SIZE\n\tj main\n' }
const LIB = { title: 'lib.asm', code: '.data\nbuffer: .space 64\n.text\n# helper: not this one\n  helper:  jr $ra\n.macro push %r\n.end_macro\n' }

describe('the name under the pointer', () => {
	it('spans a label, a register or a directive name', () => {
		expect(symbolAt('\tla $a0, buffer', 12)).toBe('buffer')
		expect(symbolAt('\tla $a0, buffer', 5)).toBe('$a0')
		expect(symbolAt('\tla $a0, buffer', 8)).toBeNull()
		expect(symbolAt('loop.top:', 1)).toBe('loop.top')
	})
})

describe('finding a definition', () => {
	it('finds a label in the same file first', () => {
		expect(findDefinition([MAIN, LIB], 'main')).toEqual({ file: 'main.asm', line: 3, column: 1, endColumn: 5 })
	})

	it('reaches into another file, past comments and leading blanks', () => {
		expect(findDefinition([MAIN, LIB], 'helper')).toEqual({ file: 'lib.asm', line: 5, column: 3, endColumn: 9 })
		expect(findDefinition([MAIN, LIB], 'buffer')).toEqual({ file: 'lib.asm', line: 2, column: 1, endColumn: 7 })
	})

	it('knows .eqv and .macro names', () => {
		expect(findDefinition([MAIN, LIB], 'SIZE')).toEqual({ file: 'main.asm', line: 2, column: 6, endColumn: 10 })
		expect(findDefinition([MAIN, LIB], 'push')).toEqual({ file: 'lib.asm', line: 6, column: 8, endColumn: 12 })
	})

	it('has nothing for registers, mnemonics or names never defined', () => {
		expect(findDefinition([MAIN, LIB], '$a0')).toBeNull()
		expect(findDefinition([MAIN, LIB], 'la')).toBeNull()
		expect(findDefinition([MAIN, LIB], 'nowhere')).toBeNull()
	})

	it('does not mistake a longer label for a shorter name', () => {
		expect(findDefinition([{ title: 'a.asm', code: 'mainloop:\n' }], 'main')).toBeNull()
	})
})
