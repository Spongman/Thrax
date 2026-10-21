import type { TokenDescription } from '../architectures/contracts'

export const REFERENCE_TITLE = 'Open instruction reference'

/** Only web URLs may be turned into clickable links by either tooltip renderer. */
export function tooltipReference(reference: string | undefined): string | undefined {
	if (!reference) return undefined
	try {
		const url = new URL(reference)
		return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined
	} catch { return undefined }
}

/** Monaco and the gutter consume the same Markdown, including the corner link. */
export function tokenTooltipMarkdown(token: Pick<TokenDescription, 'contents' | 'reference'>): string[] {
	const reference = tooltipReference(token.reference)
	if (!reference) return token.contents
	// A single Markdown document gives the corner button one containing tooltip.
	const destination = reference.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/"/g, '%22')
	return [`[↗](${destination} "${REFERENCE_TITLE}")\n\n${token.contents.join('\n\n')}`]
}

export function tipParagraphs(contents: readonly string[]): string[] {
	return contents.flatMap((entry) => entry.split('\n\n')).map((paragraph) => paragraph.trim()).filter(Boolean)
}

export type TipRun = { text: string, kind: 'plain' | 'strong' | 'code' } | { text: string, kind: 'link', href: string, title?: string }

/** The small Markdown subset used by native token descriptions; never render HTML. */
export function tipRuns(paragraph: string): TipRun[] {
	const runs: TipRun[] = []
	let plain = '', cursor = 0
	const flush = () => {
		if (plain) runs.push({ text: plain, kind: 'plain' })
		plain = ''
	}
	for (const match of paragraph.matchAll(/\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)(?: "([^"\n]+)")?\)/g)) {
		plain += paragraph.slice(cursor, match.index)
		flush()
		if (match[1] !== undefined) runs.push({ text: match[1], kind: 'strong' })
		else if (match[2] !== undefined) runs.push({ text: match[2], kind: 'code' })
		else {
			const href = tooltipReference(match[4])
			if (href) runs.push({ text: match[3], kind: 'link', href, ...(match[5] ? { title: match[5] } : {}) })
			else plain += match[0]
		}
		cursor = match.index + match[0].length
	}
	plain += paragraph.slice(cursor)
	flush()
	return runs
}
