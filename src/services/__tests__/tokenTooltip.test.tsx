import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TokenTooltipContent } from '../../components/TokenTooltip'
import { tipParagraphs, tipRuns, tokenTooltipMarkdown } from '../tokenTooltip'

const token = { contents: ['**BGE**', 'Branch when signed greater or equal.', 'Syntax: `bge rs1, rs2, target`'], reference: 'https://example.com/manual' }

describe('shared token tooltip UI', () => {
	it('gives both renderers one accessible corner link without a reference-text row', () => {
		const markdown = tokenTooltipMarkdown(token)
		expect(markdown).toHaveLength(1)
		const paragraphs = tipParagraphs(markdown)
		expect(tipRuns(paragraphs[0])).toEqual([{ text: '↗', kind: 'link', href: token.reference, title: 'Open instruction reference' }])
		const html = renderToStaticMarkup(<TokenTooltipContent token={token} />)
		expect(html.match(/<a /g)).toHaveLength(1)
		expect(html).toContain('aria-label="Open instruction reference"')
		expect(html).toContain('target="_blank" rel="noreferrer">↗</a>')
		expect(html).not.toContain('>Instruction reference<')
		expect(html).toContain('<strong>BGE</strong>')
		expect(html).toContain('<code>bge rs1, rs2, target</code>')
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
