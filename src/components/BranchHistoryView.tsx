import { formatAddress } from '../core/format'
import type { BranchHistorySettings, BranchHistorySnapshot } from '../tools/branchHistory'
import PanelGroup from './PanelGroup'
import './ToolPanels.css'

interface Props {
	branchHistory: BranchHistorySnapshot
	settings: BranchHistorySettings
	onChange: (settings: BranchHistorySettings) => void
}

const ENTRY_COUNTS = [4, 8, 16, 32, 64]

/** The saturating counter states. */
function stateLabel(state: number, historyBits: 1 | 2): string {
	if (historyBits === 1) return state === 1 ? 'T' : 'N'
	return ['NN', 'NT', 'TN', 'TT'][state] ?? '??'
}

function BranchHistoryView({ branchHistory, settings, onChange }: Props) {
	const { entries, predictions, correct, accuracy } = branchHistory

	return (
		<div className="tool">
			<p className="tool-description">Table index uses address / {branchHistory.addressUnitBytes} byte{branchHistory.addressUnitBytes === 1 ? '' : 's'}.</p>
			<div className="tool-settings">
				<label>
					Entries
					<select value={settings.entryCount} onChange={(event) => onChange({ ...settings, entryCount: Number(event.target.value) })}>
						{ENTRY_COUNTS.map((value) => <option key={value} value={value}>{value}</option>)}
					</select>
				</label>
				<label>
					History
					<select value={settings.historyBits} onChange={(event) => onChange({ ...settings, historyBits: Number(event.target.value) as 1 | 2 })}>
						<option value={1}>1 bit</option>
						<option value={2}>2 bits</option>
					</select>
				</label>
				<label>
					Initial guess
					<select value={settings.initiallyTaken ? 'taken' : 'not'} onChange={(event) => onChange({ ...settings, initiallyTaken: event.target.value === 'taken' })}>
						<option value="not">not taken</option>
						<option value="taken">taken</option>
					</select>
				</label>
			</div>

			<div className="tool-headline">
				<div className="tool-metric">
					<span className="tool-metric-value">{(accuracy * 100).toFixed(1)}%</span>
					<span className="tool-metric-label">Accuracy</span>
				</div>
				<div className="tool-metric">
					<span className="tool-metric-value">{predictions.toLocaleString()}</span>
					<span className="tool-metric-label">Branches</span>
				</div>
				<div className="tool-metric">
					<span className="tool-metric-value">{(predictions - correct).toLocaleString()}</span>
					<span className="tool-metric-label">Mispredicted</span>
				</div>
			</div>

			<PanelGroup title="Predictions" flush>
				{predictions === 0 ? (
					<div className="tool-empty">Run a program with a conditional branch.</div>
				) : (
					<table>
						<thead>
							<tr>
								<th>#</th>
								<th>Branch</th>
								<th>State</th>
								<th>Predicts</th>
								<th className="numeric">Seen</th>
								<th className="numeric">Correct</th>
							</tr>
						</thead>
						<tbody>
							{entries.map((entry) => (
								<tr key={entry.index} className={entry.predictions === 0 ? 'tool-row-idle' : undefined}>
									<td>{entry.index}</td>
									<td>{entry.addresses.map(formatAddress).join(' ') || '-'}</td>
									<td>{stateLabel(entry.state, settings.historyBits)}</td>
									<td>{entry.predictTaken ? 'taken' : 'not taken'}</td>
									<td className="numeric">{entry.predictions}</td>
									<td className="numeric">{entry.predictions === 0 ? '-' : `${((entry.correct / entry.predictions) * 100).toFixed(0)}%`}</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</PanelGroup>
		</div>
	)
}

export default BranchHistoryView
