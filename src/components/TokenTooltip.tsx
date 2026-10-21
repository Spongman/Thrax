import type { TokenDescription } from '../architectures/contracts'
import { tipParagraphs, tipRuns, tokenTooltipMarkdown } from '../services/tokenTooltip'
import './TokenTooltip.css'

/** The disassembly uses Monaco's hover shell and the same content/link helper. */
export function TokenTooltipContent({ token }: { token: Pick<TokenDescription, 'contents' | 'reference'> }) {
	return <div className="hover-contents">
		{tipParagraphs(tokenTooltipMarkdown(token)).map((paragraph, index) => <p key={index}>
			{tipRuns(paragraph).map((run, runIndex) => (
				run.kind === 'strong' ? <strong key={runIndex}>{run.text}</strong>
					: run.kind === 'code' ? <code key={runIndex}>{run.text}</code>
						: run.kind === 'link' ? <a key={runIndex} href={run.href} title={run.title} aria-label={run.title} target="_blank" rel="noreferrer">{run.text}</a>
							: <span key={runIndex}>{run.text}</span>
			))}
		</p>)}
	</div>
}
