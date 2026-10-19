import type { MarsBotSnapshot } from '../tools/marsBot'
import PanelGroup from '../../../components/PanelGroup'
import '../../../components/ToolPanels.css'
import './MarsBotView.css'

interface Props {
	marsBot: MarsBotSnapshot
}

/** Bot body size in world units, matching the original's 20x20 at one pixel per unit. */
const BOT_SIZE = 20
/** World units of empty margin kept around the track and the bot. */
const PADDING = 30

/** A triangle pointing up (north), rotated by heading below; the original's square carried no facing. */
function botTriangle(x: number, y: number): string {
	const half = BOT_SIZE / 2
	return `${x},${y - half} ${x - half},${y + half} ${x + half},${y + half}`
}

function MarsBotView({ marsBot }: Props) {
	const { heading, x, y, moving, leavingTrack, segments } = marsBot

	const points = [{ x, y }, ...segments.flatMap((segment) => [segment.from, segment.to])]
	const minX = Math.min(...points.map((point) => point.x), 0) - PADDING
	const minY = Math.min(...points.map((point) => point.y), 0) - PADDING
	const maxX = Math.max(...points.map((point) => point.x), 0) + PADDING
	const maxY = Math.max(...points.map((point) => point.y), 0) + PADDING
	const width = maxX - minX
	const height = maxY - minY

	return (
		<div className="tool">
			<div className="tool-headline">
				<div className="tool-metric">
					<span className="tool-metric-value">{heading}&deg;</span>
					<span className="tool-metric-label">Heading</span>
				</div>
				<div className="tool-metric">
					<span className="tool-metric-value">{x.toFixed(1)}, {y.toFixed(1)}</span>
					<span className="tool-metric-label">Position</span>
				</div>
				<div className="tool-metric">
					<span className="tool-metric-value">{moving ? 'Moving' : 'Stopped'}</span>
					<span className="tool-metric-label">State</span>
				</div>
				<div className="tool-metric">
					<span className="tool-metric-value">{leavingTrack ? 'On' : 'Off'}</span>
					<span className="tool-metric-label">Trail</span>
				</div>
			</div>

			<PanelGroup title="Position" flush>
				<svg className="mars-bot-canvas" viewBox={`${minX} ${minY} ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
					{segments.map((segment, index) => (
						<line
							key={index}
							className="mars-bot-track"
							x1={segment.from.x}
							y1={segment.from.y}
							x2={segment.to.x}
							y2={segment.to.y}
						/>
					))}
					<polygon
						className="mars-bot-body"
						points={botTriangle(x, y)}
						transform={`rotate(${heading}, ${x}, ${y})`}
					/>
				</svg>

				{segments.length === 0 && <div className="tool-empty">Write MOVE and LEAVETRACK to 0xffff8050 / 0xffff8020 to draw a trail.</div>}
			</PanelGroup>
		</div>
	)
}

export default MarsBotView
