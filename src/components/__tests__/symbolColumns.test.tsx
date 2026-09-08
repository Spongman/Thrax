import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DataEntry, MemoryView, SymbolTables } from '../../core/types'
import SymbolTableView, { symbolSite, type SymbolRow } from '../SymbolTableView'

/**
 * How a row is laid out and coloured: the address leads, the name reads as the
 * label it is, and the value is coloured by what the directive declared.
 */

const symbols: SymbolTables = {
	globals: new Map([['count', 0x10010000], ['greeting', 0x10010004]]),
	locals: new Map(),
}

const data: DataEntry[] = [
	{ address: 0x10010000, bytes: [7, 0, 0, 0], directive: '.word' },
	{ address: 0x10010004, bytes: [0x68, 0x69, 0], directive: '.asciiz' },
]

const memory: MemoryView = { words: new Map([[0x10010000 >>> 2, 7], [0x10010004 >>> 2, 0x006968]]) }

describe('a symbol row', () => {
	const markup = renderToStaticMarkup(<SymbolTableView symbols={symbols} data={data} memory={memory} />)

	it('leads with the address, then the name and its colon', () => {
		expect(markup.indexOf('symbol-address')).toBeLessThan(markup.indexOf('symbol-name'))
		expect(markup).toContain('count<span class="symbol-colon">:</span>')
	})

	it('colours a text value as text and a number as a number', () => {
		expect(markup).toContain('<td class="symbol-value">7</td>')
		expect(markup).toContain('<td class="symbol-value text">&quot;hi&quot;</td>')
	})

	it('offers a toggle for every column but the name', () => {
		expect(markup.match(/Show the \w+ column/g)).toEqual(['Show the address column', 'Show the type column', 'Show the value column'])
	})

	it('leaves the type and value toggles disabled where nothing was declared', () => {
		const plain = renderToStaticMarkup(<SymbolTableView symbols={symbols} />)
		expect(plain).not.toContain('symbol-type')
		// The address toggle still offers itself; the other two have no column.
		expect(plain).toContain('Show the address column" aria-pressed="true"')
		expect(plain).toContain('Show the type column" aria-pressed="true" disabled=""')
		expect(plain).toContain('Show the value column" aria-pressed="true" disabled=""')
	})
})

describe('where a name is written', () => {
	const sites = new Map([
		['a.asm', new Map([['count', { file: 'a.asm', line: 3 }], ['loop', { file: 'lib.inc', line: 8 }]])],
		['b.asm', new Map([['loop', { file: 'b.asm', line: 40 }]])],
	])

	it('looks a local up in the unit that owns it', () => {
		expect(symbolSite(sites, { name: 'loop', address: 0, file: 'b.asm' })).toEqual({ file: 'b.asm', line: 40 })
		// An included file keeps its own name, since that is where the text is.
		expect(symbolSite(sites, { name: 'loop', address: 0, file: 'a.asm' })).toEqual({ file: 'lib.inc', line: 8 })
	})

	it('asks every unit for a global, which has left its own table', () => {
		expect(symbolSite(sites, { name: 'count', address: 0, file: null })).toEqual({ file: 'a.asm', line: 3 })
	})

	it('says nothing about a name it never saw', () => {
		expect(symbolSite(sites, { name: 'missing', address: 0, file: null })).toBeNull()
		expect(symbolSite(sites, { name: 'count', address: 0, file: 'b.asm' })).toBeNull()
	})
})

describe('a name in the symbol table', () => {
	const sourceOf = (row: SymbolRow) => row.name === 'count' ? { file: 'a.asm', line: 12 } : null

	it('says it goes to both the line and the address', () => {
		const markup = renderToStaticMarkup(<SymbolTableView symbols={symbols} sourceOf={sourceOf} onSelectSource={() => {}} />)
		// The name and the address of a row go to the same two places.
		expect(markup.match(/Show 0x10010000 in memory and a\.asm:12 in the editor/g)).toHaveLength(2)
		expect(markup).toContain('count<span class="symbol-colon">:</span>')
	})

	it('offers the address alone where nothing says which line defined it', () => {
		const markup = renderToStaticMarkup(<SymbolTableView symbols={symbols} />)
		expect(markup).toContain('Show 0x10010000 in memory"')
		expect(markup).not.toContain('in the editor')
		// Both halves still click: an address is somewhere even with no line.
		expect(markup.match(/symbol-link/g)).toHaveLength(4)
	})
})
