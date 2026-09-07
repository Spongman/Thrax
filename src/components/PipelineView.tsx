import React from 'react'
import { formatWord } from '../core/format'
import { isOneOf, useStoredState } from '../hooks/useStoredState'
import type { BranchResolution, DataHazardPolicy, JumpResolution, PipelineRow, PipelineSettings, PipelineSnapshot, PredictionScheme } from '../tools/pipeline'
import PanelGroup from './PanelGroup'
import TabStrip, { type Tab } from './TabStrip'
import {
	describeHazard,
	hazardCounts,
	hazardsOf,
	registerName,
	stageAt,
	stageOccupants,
	STAGE_KINDS,
	STAGE_LABELS,
	STAGE_NAMES,
} from './pipelineStages'
import './ToolPanels.css'

interface Props {
	pipeline: PipelineSnapshot
	settings: PipelineSettings
	onChange: (settings: PipelineSettings) => void
}

const WINDOW_SIZES = [8, 16, 24, 40, 64]

type PipelineTab = 'timeline' | 'hazards'

const TABS: Array<Tab<PipelineTab>> = [
	{ id: 'timeline', label: 'Timeline' },
	{ id: 'hazards', label: 'Hazards' },
]

/** What the instruction is doing on `cycle`, or null when it is not in flight. */
function cellFor(row: PipelineRow, cycle: number): { label: string; kind: string } | null {
	const position = stageAt(row, cycle)
	if (!position) return null
	// A cycle spent held in a stage is the bubble the hazard opened up.
	return position.stalled
		? { label: '•', kind: 'stall' }
		: { label: STAGE_LABELS[position.stage], kind: STAGE_KINDS[position.stage] }
}

/** The branch decision the front end made, for the row's tooltip. */
function describePrediction(row: PipelineRow): string {
	if (row.predicted === null) return row.mispredicted ? 'taken, and nothing predicted it' : ''
	const guess = row.predicted ? 'taken' : 'not taken'
	return row.mispredicted ? `predicted ${guess}, and was wrong` : `predicted ${guess}, correctly`
}

function describeStall(row: PipelineRow): string {
	if (row.stalls === 0) return ''
	const register = row.blockedOn === null ? 'an earlier result' : registerName(row.blockedOn)
	const reason = row.cause === 'load-use' ? 'load-use hazard' : 'data hazard'
	return `${row.stalls} cycle${row.stalls === 1 ? '' : 's'} lost to a ${reason} on ${register}`
}

const cycleWord = (cycles: number) => `${cycles} cycle${cycles === 1 ? '' : 's'}`

/** The five stages of the machine on one cycle, each with what is in it. */
function StageView({ rows, cycle }: { rows: PipelineRow[]; cycle: number }) {
	const occupants = stageOccupants(rows, cycle)
	return (
		<div className="pipeline-stages">
			{STAGE_LABELS.map((label, stage) => {
				const occupant = occupants[stage]
				return (
					<div
						key={label}
						className={`pipeline-stage-box${occupant ? ` pipeline-${STAGE_KINDS[stage]}-box` : ''}${occupant?.stalled ? ' stalled' : ''}`}
						title={STAGE_NAMES[stage]}
					>
						<span className="pipeline-stage-name">{label}</span>
						{occupant ? (
							<>
								<span className="pipeline-stage-op">{occupant.row.op.toLowerCase()}</span>
								<span className="pipeline-stage-address">{formatWord(occupant.row.address)}</span>
								{occupant.stalled && <span className="pipeline-stage-note">held</span>}
							</>
						) : (
							<span className="pipeline-stage-empty">bubble</span>
						)}
					</div>
				)
			})}
		</div>
	)
}

/** Every hazard in the window, instruction by instruction. */
function HazardReport({ rows }: { rows: PipelineRow[] }) {
	const counts = hazardCounts(rows)
	const reported = rows
		.map((row, index) => ({ row, hazards: hazardsOf(rows, index) }))
		.filter((entry) => entry.hazards.length > 0)

	return (
		<>
			<div className="tool-headline">
				<div className="tool-metric">
					<span className="tool-metric-value">{counts.data}</span>
					<span className="tool-metric-label">RAW</span>
				</div>
				<div className="tool-metric">
					<span className="tool-metric-value">{counts['load-use']}</span>
					<span className="tool-metric-label">Load-use</span>
				</div>
				<div className="tool-metric">
					<span className="tool-metric-value">{counts.control}</span>
					<span className="tool-metric-label">Control</span>
				</div>
			</div>

			<PanelGroup title="Hazards in the window" flush>
				{reported.length === 0 ? (
					<div className="tool-empty">
						{rows.length === 0 ? 'Run or step a program to see what its instructions wait for.' : 'Nothing in the window waited: every instruction issued the cycle after it decoded.'}
					</div>
				) : (
					<div className="pipeline-scroll">
						<table className="pipeline-hazards">
							<thead>
								<tr>
									<th>#</th>
									<th>Instruction</th>
									<th>Hazard</th>
									<th className="numeric">Cost</th>
									<th>Waiting on</th>
								</tr>
							</thead>
							<tbody>
								{reported.flatMap((entry) => entry.hazards.map((hazard) => (
									<tr key={`${entry.row.index}-${hazard.kind}`}>
										<td className="numeric">{entry.row.index}</td>
										<th title={formatWord(entry.row.address)}>{entry.row.op.toLowerCase()}</th>
										<td className={`pipeline-hazard-${hazard.kind}`}>{describeHazard(hazard)}</td>
										<td className="numeric">{cycleWord(hazard.cycles)}</td>
										<td>{hazard.producer ? `#${hazard.producer.index} ${hazard.producer.op.toLowerCase()}` : '-'}</td>
									</tr>
								)))}
							</tbody>
						</table>
					</div>
				)}
			</PanelGroup>
		</>
	)
}

function PipelineView({ pipeline, settings, onChange }: Props) {
	const { rows, cycles, instructions, cpi, steadyStateCpi, idealCycles, dataStalls, loadUseStalls, controlFlushes, predictions, mispredictions } = pipeline
	const [tab, setTab] = useStoredState<PipelineTab>('pipeline.tab', 'timeline', isOneOf(TABS.map((item) => item.id)))
	/** The cycle the stage view is stopped on, or null to follow the run. */
	const [pickedCycle, setPickedCycle] = React.useState<number | null>(null)

	const lastCycle = rows.reduce((latest, row) => Math.max(latest, row.cycles[4]), pipeline.firstCycle)
	const columns: number[] = []
	for (let cycle = pipeline.firstCycle; cycle <= lastCycle; cycle++) columns.push(cycle)

	// A cycle picked out of an older window would name one the rows no longer
	// cover, so the view falls back to the newest cycle it has.
	const cycle = pickedCycle !== null && pickedCycle >= pipeline.firstCycle && pickedCycle <= lastCycle ? pickedCycle : lastCycle

	return (
		<div className="tool">
			<div className="tool-settings">
				<label>
					Data hazards
					<select
						value={settings.dataHazards}
						onChange={(event) => onChange({ ...settings, dataHazards: event.target.value as DataHazardPolicy })}
					>
						<option value="forwarding">Forwarding (0 stalls)</option>
						<option value="split-decode">Decode with write-back (2)</option>
						<option value="none">No countermeasure (3)</option>
					</select>
				</label>
				<label>
					Branch resolved in
					<select
						value={settings.resolveBranchIn}
						onChange={(event) => onChange({ ...settings, resolveBranchIn: event.target.value as BranchResolution })}
					>
						<option value="id">ID (1 bubble)</option>
						<option value="ex">EX (2 bubbles)</option>
						<option value="mem">MEM (3 bubbles)</option>
					</select>
				</label>
				<label>
					Jump resolved in
					<select
						value={settings.resolveJumpIn}
						onChange={(event) => onChange({ ...settings, resolveJumpIn: event.target.value as JumpResolution })}
					>
						<option value="id">ID (1 bubble)</option>
						<option value="ex">EX (2 bubbles)</option>
					</select>
				</label>
				<label>
					Prediction
					<select
						value={settings.prediction}
						onChange={(event) => onChange({ ...settings, prediction: event.target.value as PredictionScheme })}
					>
						<option value="none">None</option>
						<option value="not-taken">Static, not taken</option>
						<option value="taken">Static, taken</option>
						<option value="one-bit">Dynamic, 1-bit</option>
						<option value="two-bit">Dynamic, 2-bit</option>
					</select>
				</label>
				<label>
					Rows
					<select value={settings.windowSize} onChange={(event) => onChange({ ...settings, windowSize: Number(event.target.value) })}>
						{WINDOW_SIZES.map((value) => <option key={value} value={value}>{value}</option>)}
					</select>
				</label>
			</div>

			<TabStrip tabs={TABS} active={tab} onSelect={setTab} />

			{tab === 'hazards' ? <HazardReport rows={rows} /> : (
				<>
					<div className="tool-headline">
						<div className="tool-metric">
							<span className="tool-metric-value">{instructions === 0 ? '-' : cpi.toFixed(2)}</span>
							<span className="tool-metric-label">Cycles per instruction</span>
						</div>
						<div className="tool-metric">
							<span className="tool-metric-value">{instructions === 0 ? '-' : steadyStateCpi.toFixed(2)}</span>
							<span className="tool-metric-label">Steady-state CPI</span>
						</div>
						<div className="tool-metric">
							<span className="tool-metric-value">{cycles.toLocaleString()}</span>
							<span className="tool-metric-label">Cycles</span>
						</div>
						<div className="tool-metric">
							<span className="tool-metric-value">{(cycles - idealCycles).toLocaleString()}</span>
							<span className="tool-metric-label">Lost to hazards</span>
						</div>
						<div className="tool-metric">
							<span className="tool-metric-value">{dataStalls.toLocaleString()}</span>
							<span className="tool-metric-label">Data stalls</span>
						</div>
						<div className="tool-metric">
							<span className="tool-metric-value">{loadUseStalls.toLocaleString()}</span>
							<span className="tool-metric-label">Load-use</span>
						</div>
						<div className="tool-metric">
							<span className="tool-metric-value">{controlFlushes.toLocaleString()}</span>
							<span className="tool-metric-label">Branch flushes</span>
						</div>
						{predictions > 0 && (
							<div className="tool-metric">
								<span className="tool-metric-value">{((1 - mispredictions / predictions) * 100).toFixed(0)}%</span>
								<span className="tool-metric-label">Predicted right</span>
							</div>
						)}
					</div>

					<PanelGroup title="Timeline" flush>
						{rows.length === 0 ? (
							<div className="tool-empty">Run or step a program to see it flow through the pipeline.</div>
						) : (
							<div className="pipeline-scroll">
								<table className="pipeline-grid">
									<thead>
										<tr>
											<th className="pipeline-label">Instruction</th>
											{columns.map((column) => (
												<th
													key={column}
													className={`pipeline-cycle${column === cycle ? ' picked' : ''}`}
													onClick={() => setPickedCycle(column)}
													title={`The machine on cycle ${column}`}
												>
													{column}
												</th>
											))}
										</tr>
									</thead>
									<tbody>
										{rows.map((row) => (
											<tr key={row.index} className={row.stalls > 0 ? 'pipeline-row-stalled' : undefined}>
												<th className="pipeline-label" title={[formatWord(row.address), describeStall(row), describePrediction(row)].filter(Boolean).join('\n')}>
													{row.op.toLowerCase()}
													{row.mispredicted && <span className="pipeline-mispredict" title="Mispredicted"> ✗</span>}
												</th>
												{columns.map((column) => {
													const cell = cellFor(row, column)
													return (
														<td
															key={column}
															className={[
																'pipeline-stage',
																cell ? `pipeline-${cell.kind}` : '',
																column === cycle ? 'picked' : '',
															].filter(Boolean).join(' ')}
															onClick={() => setPickedCycle(column)}
														>
															{cell?.label ?? ''}
														</td>
													)
												})}
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
					</PanelGroup>

					{rows.length > 0 && (
						<PanelGroup
							title="Stages"
							actions={<span className="pipeline-cycle-picked">Cycle {cycle}{pickedCycle === null ? ' (latest)' : ''}</span>}
						>
							<StageView rows={rows} cycle={cycle} />
						</PanelGroup>
					)}
				</>
			)}
		</div>
	)
}

export default PipelineView
