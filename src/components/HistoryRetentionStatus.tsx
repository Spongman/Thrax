import { useId, useState } from 'react'
import type { HistoryRetention } from '../architectures/contracts'
import './HistoryRetentionStatus.css'

const mib = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MiB`
const count = (n: number) => Number.isFinite(n) ? n.toLocaleString('en-US') : 'unlimited'

export function HistoryRetentionStatus({ retention: r }: { retention?: HistoryRetention }) {
	const tooltipId = useId()
	const [open, setOpen] = useState(false)
	if (!r) return null
	return (
		<div
			className="history-retention"
			onMouseEnter={() => setOpen(true)}
			onMouseLeave={(event) => {
				if (!event.currentTarget.contains(document.activeElement)) setOpen(false)
			}}
			onFocus={() => setOpen(true)}
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
			}}
			onKeyDown={(event) => {
				if (event.key === 'Escape') {
					setOpen(false)
					event.stopPropagation()
				}
			}}
		>
			<button type="button" className="history-retention-info" aria-label="History memory statistics" aria-describedby={open ? tooltipId : undefined}>
				<svg viewBox="0 0 16 16" aria-hidden="true">
					<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.3" />
					<circle cx="8" cy="5" r="0.9" fill="currentColor" />
					<path d="M8 7.5v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
				</svg>
			</button>
			<div id={tooltipId} role="tooltip" className="history-retention-tooltip" hidden={!open}>
				<strong>{count(r.entries)} retained · {mib(r.liveBufferBytes)}{r.byteEvictions > 0 || r.oversizedEntries > 0 ? ' · memory limit reached' : ''}</strong>
				<div>Entry target: {count(r.entryLimit)} (whole blocks retained)</div>
				<div>Typed buffers: {mib(r.liveBufferBytes)} live / {mib(r.byteLimit)} budget · {mib(r.allocatedBufferBytes)} allocated including spare blocks</div>
				<div>Evicted entries: {count(r.entryEvictions)} by entry target · {count(r.byteEvictions)} by byte budget · {count(r.oversizedEntries)} oversized entries dropped</div>
				<div>Opaque payloads: {count(r.payloadCount)}; their heap memory is additional.</div>
			</div>
		</div>
	)
}
