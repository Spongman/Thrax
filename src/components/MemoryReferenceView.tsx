import { formatAddress, parseAddress } from '../core/format'
import { colorForCount } from '../tools/memoryReference'
import type { MemoryReferenceSettings, MemoryReferenceSnapshot } from '../tools/memoryReference'
import PanelGroup from './PanelGroup'
import './ToolPanels.css'
import './MemoryReferenceView.css'

interface Props {
	memoryReference: MemoryReferenceSnapshot
	settings: MemoryReferenceSettings
	onChange: (settings: MemoryReferenceSettings) => void
}

const WORDS_PER_UNIT = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048]
const UNIT_PIXELS = [1, 2, 4, 8, 16, 32]

function MemoryReferenceView({ memoryReference, settings, onChange }: Props) {
	const { rows, columns, counts, max } = memoryReference

	return (
		<div className="tool">
			<div className="tool-settings">
				<label>
					Base address
					<input
						className="memory-reference-address"
						value={formatAddress(settings.baseAddress)}
						onChange={(event) => {
							const parsed = parseAddress(event.target.value)
							if (parsed !== null) onChange({ ...settings, baseAddress: parsed })
						}}
					/>
				</label>
				<label>
					Words / unit ({memoryReference.wordBytes} B)
					<select value={settings.wordsPerUnit} onChange={(event) => onChange({ ...settings, wordsPerUnit: Number(event.target.value) })}>
						{WORDS_PER_UNIT.map((value) => <option key={value} value={value}>{value}</option>)}
					</select>
				</label>
				<label>
					Unit width
					<select value={settings.unitPixelWidth} onChange={(event) => onChange({ ...settings, unitPixelWidth: Number(event.target.value) })}>
						{UNIT_PIXELS.map((value) => <option key={value} value={value}>{value}px</option>)}
					</select>
				</label>
				<label>
					Unit height
					<select value={settings.unitPixelHeight} onChange={(event) => onChange({ ...settings, unitPixelHeight: Number(event.target.value) })}>
						{UNIT_PIXELS.map((value) => <option key={value} value={value}>{value}px</option>)}
					</select>
				</label>
				<label>
					Rows
					<input
						type="number"
						min={1}
						value={settings.rows}
						onChange={(event) => onChange({ ...settings, rows: Math.max(1, Math.trunc(Number(event.target.value))) })}
					/>
				</label>
				<label>
					Columns
					<input
						type="number"
						min={1}
						value={settings.columns}
						onChange={(event) => onChange({ ...settings, columns: Math.max(1, Math.trunc(Number(event.target.value))) })}
					/>
				</label>
			</div>

			<div className="tool-headline">
				<div className="tool-metric">
					<span className="tool-metric-value">{max.toLocaleString()}</span>
					<span className="tool-metric-label">Hottest cell</span>
				</div>
				<div className="tool-metric">
					<span className="tool-metric-value">{(rows * columns).toLocaleString()}</span>
					<span className="tool-metric-label">Cells</span>
				</div>
			</div>

			<PanelGroup title="Heat map" flush>
				<div
					className="memory-reference-grid"
					style={{ gridTemplateColumns: `repeat(${columns}, ${settings.unitPixelWidth}px)`, gridAutoRows: `${settings.unitPixelHeight}px` }}
				>
					{counts.map((count, index) => (
						<div
							key={index}
							className="memory-reference-cell"
							style={{ background: colorForCount(count, settings.colorRamp) }}
							title={`${formatAddress(settings.baseAddress + index * settings.wordsPerUnit * memoryReference.wordBytes)}: ${count}`}
						/>
					))}
				</div>
			</PanelGroup>

			<PanelGroup title="Legend">
				<div className="memory-reference-legend">
					{settings.colorRamp.map((stop, index) => (
						<span key={stop.count} className="memory-reference-swatch">
							<span className="memory-reference-swatch-color" style={{ background: stop.color }} />
							{stop.count}{index < settings.colorRamp.length - 1 ? `-${settings.colorRamp[index + 1].count - 1}` : '+'}
						</span>
					))}
				</div>

				{max === 0 && <div className="tool-empty">Run a program that touches memory.</div>}
			</PanelGroup>
		</div>
	)
}

export default MemoryReferenceView
