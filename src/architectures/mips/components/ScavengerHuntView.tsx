import type { ScavengerHuntSnapshot } from '../tools/scavengerHunt'
import { ADMINISTRATOR_ID, GRAPHIC_HEIGHT, GRAPHIC_WIDTH, NUM_LOCATIONS } from '../tools/scavengerHunt'
import PanelGroup from '../../../components/PanelGroup'
import '../../../components/ToolPanels.css'
import './ScavengerHuntView.css'

interface Props {
	scavengerHunt: ScavengerHuntSnapshot
}

/** A stable, readable colour per player when the MIPS program never set one (raw 0). */
const DEFAULT_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6']
const colorFor = (id: number, raw: number) => raw !== 0 ? `#${(raw & 0xffffff).toString(16).padStart(6, '0')}` : DEFAULT_COLORS[id % DEFAULT_COLORS.length]

function ScavengerHuntView({ scavengerHunt }: Props) {
	const { gameOn, activePlayerId, numTurns, locations, players, illegalWrites } = scavengerHunt
	const finishedCount = players.filter((player) => player.finished).length

	return (
		<div className="tool">
			<div className="tool-headline">
				<div className="tool-metric">
					<span className="tool-metric-value">{gameOn ? 'On' : 'Waiting'}</span>
					<span className="tool-metric-label">Game</span>
				</div>
				<div className="tool-metric">
					<span className="tool-metric-value">{activePlayerId === ADMINISTRATOR_ID ? 'Admin' : activePlayerId}</span>
					<span className="tool-metric-label">Live player</span>
				</div>
				<div className="tool-metric">
					<span className="tool-metric-value">{numTurns}</span>
					<span className="tool-metric-label">Turns left</span>
				</div>
				<div className="tool-metric">
					<span className="tool-metric-value">{finishedCount}</span>
					<span className="tool-metric-label">Finished</span>
				</div>
				{illegalWrites > 0 && (
					<div className="tool-metric">
						<span className="tool-metric-value">{illegalWrites}</span>
						<span className="tool-metric-label">Illegal writes</span>
					</div>
				)}
			</div>

			<PanelGroup title="Board" flush>
				<svg className="scavenger-hunt-board" viewBox={`0 0 ${GRAPHIC_WIDTH} ${GRAPHIC_HEIGHT}`} preserveAspectRatio="xMidYMid meet">
					{locations.map((location, index) => (
						<g key={index} className="scavenger-hunt-location">
							<rect x={location.x} y={location.y} width={20} height={20} />
							<text x={location.x + 4} y={location.y + 15}>{index}</text>
						</g>
					))}
					{players.map((player) => (
						<g key={player.id} className="scavenger-hunt-player" style={{ color: colorFor(player.id, player.color) }}>
							<circle cx={player.x} cy={player.y} r={10} />
							<text x={player.x + 4} y={player.y + 15}>{player.id}</text>
						</g>
					))}
				</svg>
			</PanelGroup>

			<PanelGroup title="Scoreboard" flush>
				<div className="scavenger-hunt-scoreboard">
					<table>
						<thead>
							<tr>
								<th>Player</th>
								<th className="numeric">Energy</th>
								<th>Visited</th>
								<th>Status</th>
							</tr>
						</thead>
						<tbody>
							{players.map((player) => (
								<tr key={player.id} className={player.finished ? '' : 'tool-row-idle'}>
									<td>{player.id}</td>
									<td className="numeric">{player.energy}</td>
									<td>{player.visited.filter(Boolean).length}/{NUM_LOCATIONS}</td>
									<td>{player.finished ? `Finished @${player.finishedAtInstruction}` : '-'}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>

				{!gameOn && <div className="tool-empty">Waiting for the administrator to write GAME_ON (0xffffe008).</div>}
			</PanelGroup>
		</div>
	)
}

export default ScavengerHuntView
