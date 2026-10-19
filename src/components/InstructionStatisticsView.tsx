import { CATEGORY_LABELS, type CategoryKey, type StatisticsSnapshot } from '../tools/statistics'
import PanelGroup from './PanelGroup'
import './ToolPanels.css'

interface Props {
	statistics: StatisticsSnapshot
}

const CATEGORIES = Object.keys(CATEGORY_LABELS) as CategoryKey[]

function InstructionStatisticsView({ statistics }: Props) {
	const { total, byCategory, byEncoding, byMnemonic } = statistics

	return (
		<div className="tool">
			<div className="tool-headline">
				<div className="tool-metric">
					<span className="tool-metric-value">{total.toLocaleString()}</span>
					<span className="tool-metric-label">Instructions</span>
				</div>
				<div className="tool-metric">
					<span className="tool-metric-value">{byMnemonic.length}</span>
					<span className="tool-metric-label">Distinct</span>
				</div>
			</div>

			<PanelGroup title="By format">
				{byEncoding.map(({ label, count }) => {
					const share = total === 0 ? 0 : count / total
					return (
						<div className="tool-bar-row" key={label}>
							<span>{label}</span>
							<div className="tool-bar-track">
								<div className="tool-bar-fill" style={{ width: `${share * 100}%` }} />
							</div>
							<span className="tool-bar-value">{count.toLocaleString()}</span>
						</div>
					)
				})}
			</PanelGroup>

			<PanelGroup title="By kind">
				{CATEGORIES.map((category) => {
					const count = byCategory[category]
					const share = total === 0 ? 0 : count / total
					return (
						<div className="tool-bar-row" key={category}>
							<span>{CATEGORY_LABELS[category]}</span>
							<div className="tool-bar-track">
								<div className="tool-bar-fill" style={{ width: `${share * 100}%` }} />
							</div>
							<span className="tool-bar-value">{count.toLocaleString()}</span>
						</div>
					)
				})}
			</PanelGroup>

			<PanelGroup title="By instruction" flush>
				{byMnemonic.length === 0 ? (
					<div className="tool-empty">Run a program to collect statistics.</div>
				) : (
					<table>
						<thead>
							<tr>
								<th>Instruction</th>
								<th className="numeric">Count</th>
								<th className="numeric">Share</th>
							</tr>
						</thead>
						<tbody>
							{byMnemonic.map((entry) => (
								<tr key={entry.op}>
									<td>{entry.op.toLowerCase()}</td>
									<td className="numeric">{entry.count.toLocaleString()}</td>
									<td className="numeric">{((entry.count / total) * 100).toFixed(1)}%</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</PanelGroup>
		</div>
	)
}

export default InstructionStatisticsView
