import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TokenTooltipContent } from '../../components/TokenTooltip'
import { referenceDestination, tipParagraphs, tipRuns, tokenTooltipMarkdown } from '../tokenTooltip'
import { formatInstructionHelp, instructionLinks } from '../../core/instructionHelp'

const token = { contents: ['**BGE**', 'Branch when signed greater or equal.', 'Syntax: `bge rs1, rs2, target`'], reference: 'https://example.com/manual' }

describe('manual destinations', () => {
	it('changes the PDF resource URL with the page while preserving viewer options', () => {
		expect(referenceDestination('https://example.com/manual.pdf?download=1#page=4&zoom=150')).toBe('https://example.com/manual.pdf?download=1&thrax-page=4#page=4&zoom=150')
		expect(referenceDestination('https://example.com/manual.pdf?download=1#page=5&zoom=150')).toBe('https://example.com/manual.pdf?download=1&thrax-page=5#page=5&zoom=150')
	})
	it('preserves HTML anchors and PDF links without page selectors', () => {
		for (const url of ['https://example.com/reference.html#ADC', 'https://example.com/manual.pdf', 'https://example.com/manual.pdf#nameddest=ADD']) expect(referenceDestination(url)).toBe(url)
		expect(referenceDestination('javascript:alert(1)')).toBeUndefined()
	})
})

describe('shared token tooltip UI', () => {
	it('gives both renderers one accessible corner link without a reference-text row', () => {
		const markdown = tokenTooltipMarkdown(token)
		expect(markdown).toHaveLength(1)
		const paragraphs = tipParagraphs(markdown)
		expect(tipRuns(paragraphs[0])).toEqual([{ text: '↗', kind: 'link', href: token.reference, title: 'Open instruction reference' }])
		const html = renderToStaticMarkup(<TokenTooltipContent token={token} />)
		expect(html.match(/<a /g)).toHaveLength(1)
		expect(html).toContain('aria-label="Open instruction reference"')
		expect(html).toContain('target="thrax-manual">↗</a>')
		expect(html).not.toContain('>Instruction reference<')
		expect(html).toContain('<strong>BGE</strong>')
		expect(html).toContain('<code>bge rs1, rs2, target</code>')
	})

	it('links the mnemonic to its place in the manual', () => {
		const links = instructionLinks('https://example.com/manual.pdf', { add: 42 })
		expect(links('ADD')).toBe('https://example.com/manual.pdf#page=42')
		expect(links('sub')).toBeUndefined()
		expect(instructionLinks('https://example.com/x86/', (name) => name)('Mov')).toBe('https://example.com/x86/mov')
		const help = formatInstructionHelp('add', { summary: 'Add.', link: 'https://example.com/a (b)' })
		expect(tipRuns(tipParagraphs(help.contents)[0])).toEqual([{ text: 'ADD', kind: 'link', href: 'https://example.com/a%20%28b%29', title: 'Open ADD in the manual', strong: true }])
		expect(renderToStaticMarkup(<TokenTooltipContent token={help} />)).toContain('target="thrax-manual"><strong>ADD</strong></a>')
		expect(formatInstructionHelp('add', { summary: 'Add.' }).contents[0]).toBe('**ADD**')
	})

	it('preserves ordinary register tips and omits buttons without a web reference', () => {
		const plain = { contents: ['**R1**', '`5`'] }
		expect(tokenTooltipMarkdown(plain)).toEqual(plain.contents)
		for (const reference of ['javascript:alert(1)', 'file:///secret', '/relative', 'not a URL']) {
			expect(tokenTooltipMarkdown({ ...plain, reference })).toEqual(plain.contents)
		}
		expect(tipRuns('[bad](javascript:alert(1))')).toEqual([{ kind: 'plain', text: '[bad](javascript:alert(1))' }])
	})
})
