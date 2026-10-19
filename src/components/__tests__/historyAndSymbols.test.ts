import { describe, expect, it } from 'vitest'
import { Kind } from '../../core/effectKind'
import { describeEffect, rowEffects } from '../../architectures/mips/history/format'
import { symbolRows, symbolSections } from '../SymbolTableView'
import { parseEditedDouble, parseEditedValue } from '../editValue'
import { historyWith } from '../../architectures/mips/core/__tests__/historyFixture'
import type { Effect, SymbolTables } from '../../core/types'

describe('what a history row says about an effect', () => {
	const register: Effect = { kind: Kind.REGISTER, name: '$t0', value: 5 }

	it('reads the held value as the old one behind the present', () => {
		// Behind the cursor the effect holds what the instruction destroyed.
		expect(describeEffect(register, false)?.label).toBe('$t0 0x00000005 →')
	})

	it('reads it as the new one ahead of the present', () => {
		// Ahead of it, the same field holds what the instruction produced.
		expect(describeEffect(register, true)?.label).toBe('$t0 → 0x00000005')
	})

	it('names a run of memory once, with the span it covers', () => {
		const effect: Effect = { kind: Kind.MEMORY, wordAddress: 0x10010000 >>> 2, words: [1, 2, 3] }
		expect(describeEffect(effect, false)).toEqual({ subject: '[0x10010000+12]', label: '[0x10010000+12]', address: 0x10010000, applied: false })
	})

	it('gives a single word its plain address', () => {
		const effect: Effect = { kind: Kind.MEMORY, wordAddress: 0x10010004 >>> 2, words: [0] }
		expect(describeEffect(effect, false)).toEqual({ subject: '[0x10010004]', label: '[0x10010004]', address: 0x10010004, applied: false })
	})

	it('points a click at the register a value belongs to', () => {
		// The chip is how a register in the past is reached, so the name has to
		// survive being described rather than being folded into the text.
		expect(describeEffect(register, false).register).toBe('$t0')
		expect(describeEffect({ kind: Kind.FP, index: 3, value: 1 }, false).register).toBe('$f3')
		// A word the panel renders itself, rather than a string it cannot dim.
		expect(describeEffect(register, false).value).toBe(5)
	})

	it('leaves console text and a line of input without an arrow', () => {
		// Neither replaced a value, so there is nothing for an arrow to point at.
		expect(describeEffect({ kind: Kind.INPUT, value: '42' }, false).detail).toBe('"42"')
		expect(describeEffect({ kind: Kind.INPUT, value: '42' }, true).label).toBe('read "42"')
	})

	it('shows what a syscall read and what it printed', () => {
		expect(describeEffect({ kind: Kind.INPUT, value: '42' }, false)?.label).toBe('read "42"')
		expect(describeEffect({ kind: Kind.CONSOLE, text: 'hi' }, false)?.label).toBe('console "hi"')
	})

	it('gives a row one chip per effect, read back out of the columns', () => {
		const history = historyWith(0, (effects) => effects.push(Kind.REGISTER, 8, 5), null)
		expect(rowEffects(history.at(0)!, history.effects, false).map((chip) => chip.label)).toEqual(['$t0 0x00000005 →'])
	})
})

describe('the symbol table', () => {
	const symbols: SymbolTables = {
		globals: new Map([['helper', 0x00400010]]),
		locals: new Map([
			['b.asm', new Map([['loop', 0x00400020]])],
			['a.asm', new Map([['loop', 0x00400004], ['done', 0x00400000]])],
		]),
	}

	it('puts the globals first, then a section per file', () => {
		const sections = symbolSections(symbolRows(symbols))
		expect(sections.map((section) => section.file)).toEqual([null, 'a.asm', 'b.asm'])
		expect(sections[0].rows.map((row) => row.name)).toEqual(['helper'])
	})

	it('keeps the same name in two files as two rows', () => {
		const rows = symbolRows(symbols).filter((row) => row.name === 'loop')
		expect(rows.map((row) => row.file)).toEqual(['a.asm', 'b.asm'])
		expect(rows.map((row) => row.address)).toEqual([0x00400004, 0x00400020])
	})

	it('sorts within a file by name or by address', () => {
		const byName = symbolRows(symbols, 'name').filter((row) => row.file === 'a.asm')
		expect(byName.map((row) => row.name)).toEqual(['done', 'loop'])

		const byAddress = symbolRows(symbols, 'address').filter((row) => row.file === 'a.asm')
		expect(byAddress.map((row) => row.name)).toEqual(['done', 'loop'])
	})
})

describe('reading a value typed into a cell', () => {
	it('reads the radix the cell is showing', () => {
		expect(parseEditedValue('20', '0n')).toBe(20)
		expect(parseEditedValue('20', '0x')).toBe(0x20)
	})

	it('takes a 0x prefix wherever it appears', () => {
		expect(parseEditedValue('0x1f', '0n')).toBe(31)
		expect(parseEditedValue('0x1f', '0x')).toBe(31)
	})

	it('keeps a negative value as the word that holds it', () => {
		expect(parseEditedValue('-1', '0n')).toBe(0xffffffff)
	})

	it('refuses text that is not a value in that radix', () => {
		expect(parseEditedValue('', '0n')).toBeNull()
		expect(parseEditedValue('  ', '0x')).toBeNull()
		expect(parseEditedValue('12g', '0x')).toBeNull()
		expect(parseEditedValue('1f', '0n')).toBeNull()
	})

	it('turns a float into the bits the machine stores', () => {
		expect(parseEditedValue('1', 'f')).toBe(0x3f800000)
		expect(parseEditedDouble('1')).toEqual({ low: 0, high: 0x3ff00000 })
		expect(parseEditedDouble('nonsense')).toBeNull()
	})
})
