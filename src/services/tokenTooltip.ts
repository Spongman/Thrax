import type { TokenDescription } from '../architectures/contracts'

export const REFERENCE_TITLE = 'Open instruction reference'
/** Every manual link opens in this one named tab, so lookups reuse it. */
export const REFERENCE_TARGET = 'thrax-manual'

/** Let the browser handle manual links, before Monaco cancels their native events. */
export function installTooltipLinks(root: HTMLElement): { dispose(): void } {
	const nativeLink = (event: MouseEvent) => {
		const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('.monaco-hover a') : null
		const href = link && referenceDestination(link.dataset.href || link.getAttribute('href') || undefined)
		if (!link || !href) return
		// Older Monaco renderers keep the real URL only in data-href. Native link
		// actions need href as well; leave the default browser action enabled.
		link.href = href
		link.target = REFERENCE_TARGET
		// noreferrer/noopener make named targets open a fresh tab on every click.
		link.removeAttribute('rel')
		event.stopPropagation()
	}
	const events = ['click', 'auxclick', 'contextmenu'] as const
	for (const event of events) root.addEventListener(event, nativeLink, true)
	return { dispose: () => { for (const event of events) root.removeEventListener(event, nativeLink, true) } }
}

/** PDF viewers can ignore fragment-only navigations; load the requested page afresh. */
export function referenceDestination(reference: string | undefined): string | undefined {
	const href = tooltipReference(reference)
	if (!href) return undefined
	const url = new URL(href), page = /^#page=(\d+)(?:&|$)/i.exec(url.hash)?.[1]
	if (!/\.pdf$/i.test(url.pathname) || !page) return href
	url.searchParams.set('thrax-page', page)
	return url.href
}

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

export type TipRun = { text: string, kind: 'plain' | 'strong' | 'code' } | { text: string, kind: 'link', href: string, title?: string, strong?: true }

/** The small Markdown subset used by native token descriptions; never render HTML. */
export function tipRuns(paragraph: string): TipRun[] {
	const runs: TipRun[] = []
	let plain = '', cursor = 0
	const flush = () => {
		if (plain) runs.push({ text: plain, kind: 'plain' })
		plain = ''
	}
	for (const match of paragraph.matchAll(/(\*\*)?\[([^\]]+)\]\((https?:\/\/[^\s)]+)(?: "([^"\n]+)")?\)\1|\*\*([^*]+)\*\*|`([^`]+)`/g)) {
		plain += paragraph.slice(cursor, match.index)
		flush()
		if (match[5] !== undefined) runs.push({ text: match[5], kind: 'strong' })
		else if (match[6] !== undefined) runs.push({ text: match[6], kind: 'code' })
		else {
			const href = tooltipReference(match[3])
			if (href) runs.push({ text: match[2], kind: 'link', href, ...(match[4] ? { title: match[4] } : {}), ...(match[1] ? { strong: true as const } : {}) })
			else plain += match[0]
		}
		cursor = match.index + match[0].length
	}
	plain += paragraph.slice(cursor)
	flush()
	return runs
}
