import type { HistoryRetention } from '../architectures/contracts'
import './HistoryRetentionStatus.css'

const mib = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MiB`
const count = (n: number) => Number.isFinite(n) ? n.toLocaleString('en-US') : 'unlimited'

export function HistoryRetentionStatus({ retention: r }: { retention?: HistoryRetention }) {
	if (!r) return null
	return (
		<details className="history-retention">
			<summary>{count(r.entries)} retained · {mib(r.liveBufferBytes)}{r.byteEvictions > 0 || r.oversizedEntries > 0 ? ' · memory limit reached' : ''}</summary>
			<div>Entry target: {count(r.entryLimit)} (whole blocks retained)</div>
			<div>Typed buffers: {mib(r.liveBufferBytes)} live / {mib(r.byteLimit)} budget · {mib(r.allocatedBufferBytes)} allocated including spare blocks</div>
			<div>Evicted entries: {count(r.entryEvictions)} by entry target · {count(r.byteEvictions)} by byte budget · {count(r.oversizedEntries)} oversized entries dropped</div>
			<div>Opaque payloads: {count(r.payloadCount)}; their heap memory is additional.</div>
		</details>
	)
}
