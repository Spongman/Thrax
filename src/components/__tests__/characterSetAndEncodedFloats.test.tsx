import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CharacterSet, RegisterDescriptor } from '../../architectures/contracts'
import { RegisterFormat } from '../../architectures/contracts'
import { RamInspector } from '../../core/ramInspector'
import MemoryView from '../MemoryView'
import RegisterView from '../RegisterView'

/** A toy single-byte set in which bytes C8 and 89 are 'H' and 'i', as in EBCDIC. */
const TOY: CharacterSet = { name: 'toy', decode: byte => byte === 0xc8 ? 0x48 : byte === 0x89 ? 0x69 : byte, encode: code => code === 0x48 ? 0xc8 : code === 0x69 ? 0x89 : code }

describe('a target character set', () => {
	const render = (characterSet?: CharacterSet) => {
		const bytes = new Uint8Array(64)
		bytes.set([0xc8, 0x89])
		return renderToStaticMarkup(
			<MemoryView memory={new RamInspector(bytes, { wordBytes: 4, littleEndian: false })} sections={[{ id: 'all', label: 'memory', start: 0, end: 63 }]}
				pc={null} returnAddresses={new Set()} focusAddress={null} onHoverAddress={() => {}} characterSet={characterSet} />,
		)
	}
	const characters = (markup: string) => [...markup.matchAll(/class="memory-char[^"]*"[^>]*>([^<]*)</g)].slice(0, 2).map(match => match[1])

	it('reads memory text through it', () => {
		expect(characters(render())).toEqual(['.', '.'])
		expect(characters(render(TOY))).toEqual(['H', 'i'])
	})
})

describe('an encoded 64-bit float register', () => {
	it('shows its value in its own encoding, without IEEE bit fields', () => {
		const descriptors: RegisterDescriptor[] = [{ id: 'f0', name: 'F0', bank: 'fp', bits: 64, editable: false, format: RegisterFormat.FLOAT, floatEncoding: 'ibm' }]
		const markup = renderToStaticMarkup(<RegisterView registers={{ f0: 0x4118000000000000n }} descriptors={descriptors} />)
		expect(markup).toContain('title="1.5"')
	})
})
