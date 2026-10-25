import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MemoryInspector, RegisterDescriptor } from '../../architectures/contracts'
import { formatOctal } from '../../core/format'
import { parseEditedValue, parseEditedWide } from '../editValue'
import MemoryView from '../MemoryView'
import RegisterView from '../RegisterView'

const text = (markup: string) => markup.replace(/<[^>]+>/g, '')

describe('octal radix', () => {
	it('formats unprefixed digits padded to the register width', () => {
		expect(formatOctal(0o177776, 16)).toBe('177776')
		expect(formatOctal(5, 16)).toBe('000005')
		expect(formatOctal(0xffffffff, 32)).toBe('37777777777')
		expect(formatOctal(-1n, 64)).toBe('1777777777777777777777')
	})

	it('reads typed octal, keeping 0x as hexadecimal', () => {
		expect(parseEditedValue('177776', '0o')).toBe(0o177776)
		expect(parseEditedValue('-1', '0o')).toBe(0xffffffff)
		expect(parseEditedValue('0x10', '0o')).toBe(16)
		expect(parseEditedValue('18', '0o')).toBeNull()
		expect(parseEditedWide('1777777777777777777777', '0o', 64)).toBe(2n ** 64n - 1n)
		expect(parseEditedWide('9', '0o', 64)).toBeNull()
	})

	const registers: RegisterDescriptor[] = [{ id: 'r0', name: 'R0', bank: 'cpu', bits: 16, editable: true }]
	it('offers octal beside decimal and hex, and starts in it where the target asks', () => {
		const octal = renderToStaticMarkup(<RegisterView registers={{ r0: 0o17 }} descriptors={registers} radix={8} />)
		expect(octal).toContain('class="toggle-button active" title="Octal"')
		expect(text(octal)).toContain('000017')
		const hex = renderToStaticMarkup(<RegisterView registers={{ r0: 0o17 }} descriptors={registers} />)
		expect(hex).toContain('class="toggle-button" title="Octal"')
		expect(hex).toContain('class="toggle-button active" title="Hexadecimal"')
	})

	it('reads a wide DEC register as one F/D memory image', () => {
		const ac: RegisterDescriptor[] = [{ id: 'ac0', name: 'AC0', bank: 'FP11', group: 'Accumulators', bits: 64, editable: true, floatEncoding: 'dec' }]
		// 0.1 in F: words 037314 146315, the first lowest; the D half beyond it is ignored.
		const tenth = 0o146315n << 16n | 0o37314n
		const markup = renderToStaticMarkup(<RegisterView registers={{ ac0: tenth }} descriptors={ac} radix={8} />)
		expect(markup).toContain('class="toggle-button active" title="Single precision float"')
		expect(text(markup)).toContain('0.1')
		expect(text(renderToStaticMarkup(<RegisterView registers={{ ac0: 0o40200n }} descriptors={ac} radix={8} />))).toMatch(/AC0\d+1$/)
	})

	it('shows memory groups and row addresses in octal', () => {
		const bytes = new Map([[0o1000, 0o376], [0o1001, 0o377]])
		const memory: MemoryInspector = { wordBytes: 2, littleEndian: true, byte: a => bytes.get(a) ?? 0, word: () => undefined }
		const markup = renderToStaticMarkup(<MemoryView memory={memory} sections={[{ id: 'text', label: 'Code', start: 0o1000, end: 0o1777 }]} pc={null} returnAddresses={new Set()} focusAddress={null} onHoverAddress={() => {}} radix={8} />)
		expect(text(markup)).toContain('001000')
		expect(text(markup)).toContain('00000177776')
	})
})
