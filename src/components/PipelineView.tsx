import React from 'react'
import { formatWord } from '../core/format'
import { isOneOf, useStoredState } from '../hooks/useStoredState'
import type { PipelineOption, PipelineStage } from '../architectures/contracts'
import { optionFor, type BranchResolution, type DataHazardPolicy, type JumpResolution, type PipelineRow, type PipelineSettings, type PipelineSnapshot, type PredictionScheme } from '../tools/pipeline'
import PanelGroup from './PanelGroup'
import TabStrip, { type Tab } from './TabStrip'
import {
	describeHazard,
	hazardCounts,
	hazardsOf,
	registerName,
	stageAt,
	stageOccupants,
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
function cellFor(row: PipelineRow, cycle: number, stages: readonly PipelineStage[]): { label: string; kind: string } | null {
	const position = stageAt(row, cycle)
	if (!position) return null
	// A cycle spent held in a stage is the bubble the hazard opened up.
	const stage = stages[position.stage]
	return position.stalled ? { label: '•', kind: 'stall' } : { label: stage.label, kind: stage.kind }
}

/** A choice the model offers; fixed when it offers only one. */
function ModelSelect<T extends string>({ label, options, value, onChange }: { label: string; options: readonly PipelineOption[]; value: string; onChange: (value: T) => void }) {
	const selected = optionFor(options, value)
	return (
		<label>
			{label}
			<select value={selected.value} disabled={options.length < 2} onChange={(event) => onChange(event.target.value as T)}>
				{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
			</select>
		</label>
	)
}

/** The branch decision the front end made, for the row's tooltip. */
function describePrediction(row: PipelineRow): string {
	if (row.predicted === null) return row.mispredicted ? 'taken, and nothing predicted it' : ''
	const guess = row.predicted ? 'taken' : 'not taken'
	return row.mispredicted ? `predicted ${guess}, and was wrong` : `predicted ${guess}, correctly`
}

function describeStall(row: PipelineRow, names: readonly string[]): string {
	if (row.stalls === 0) return ''
	const register = row.blockedOn === null ? 'an earlier result' : registerName(row.blockedOn, names)
	const reason = row.cause === 'load-use' ? 'load-use hazard' : 'data hazard'
	return `${row.stalls} cycle${row.stalls === 1 ? '' : 's'} lost to a ${reason} on ${register}`
}

const cycleWord = (cycles: number) => `${cycles} cycle${cycles === 1 ? '' : 's'}`

/** The stages of the machine on one cycle, each with what is in it. */
function StageView({ rows, cycle, stages }: { rows: PipelineRow[]; cycle: number; stages: readonly PipelineStage[] }) {
	const occupants = stageOccupants(rows, cycle, stages.length)
	return (
		<div className="pipeline-stages">
			{stages.map(({ label, name, kind }, stage) => {
				const occupant = occupants[stage]
				return (
					<div
						key={label}
						className={`pipeline-stage-box${occupant ? ` pipeline-${kind}-box` : ''}${occupant?.stalled ? ' stalled' : ''}`}
						title={name}
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
function HazardReport({ rows, names }: { rows: PipelineRow[]; names: readonly string[] }) {
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
										<td className={`pipeline-hazard-${hazard.kind}`}>{describeHazard(hazard, names)}</td>
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
	if (!pipeline.available) return <div className="dock-panel-unavailable">Not available for this architecture.</div>
	return <PipelineTool pipeline={pipeline} settings={settings} onChange={onChange} />
}

function PipelineTool({ pipeline, settings, onChange }: Props) {
	const { model, rows, cycles, instructions, cpi, steadyStateCpi, idealCycles, dataStalls, loadUseStalls, controlFlushes, predictions, mispredictions } = pipeline
	const [tab, setTab] = useStoredState<PipelineTab>('pipeline.tab', 'timeline', isOneOf(TABS.map((item) => item.id)))
	/** The cycle the stage view is stopped on, or null to follow the run. */
	const [pickedCycle, setPickedCycle] = React.useState<number | null>(null)

	const lastCycle = rows.reduce((latest, row) => Math.max(latest, row.cycles[row.cycles.length - 1]), pipeline.firstCycle)
	const columns: number[] = []
	for (let cycle = pipeline.firstCycle; cycle <= lastCycle; cycle++) columns.push(cycle)

	// A cycle picked out of an older window would name one the rows no longer
	// cover, so the view falls back to the newest cycle it has.
	const cycle = pickedCycle !== null && pickedCycle >= pipeline.firstCycle && pickedCycle <= lastCycle ? pickedCycle : lastCycle

	return (
		<div className="tool">
			<div className="tool-settings">
				{model && (
					<>
						<ModelSelect<DataHazardPolicy> label="Data hazards" options={model.hazards} value={settings.dataHazards} onChange={(dataHazards) => onChange({ ...settings, dataHazards })} />
						<ModelSelect<BranchResolution> label="Branch resolved in" options={model.branches} value={settings.resolveBranchIn} onChange={(resolveBranchIn) => onChange({ ...settings, resolveBranchIn })} />
						<ModelSelect<JumpResolution> label="Jump resolved in" options={model.jumps} value={settings.resolveJumpIn} onChange={(resolveJumpIn) => onChange({ ...settings, resolveJumpIn })} />
					</>
				)}
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

			{tab === 'hazards' ? <HazardReport rows={rows} names={pipeline.registerNames} /> : (
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
												<th className="pipeline-label" title={[formatWord(row.address), describeStall(row, pipeline.registerNames), describePrediction(row)].filter(Boolean).join('\n')}>
													{row.op.toLowerCase()}
													{row.mispredicted && <span className="pipeline-mispredict" title="Mispredicted"> ✗</span>}
												</th>
												{columns.map((column) => {
													const cell = cellFor(row, column, model!.stages)
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
							<StageView rows={rows} cycle={cycle} stages={model!.stages} />
						</PanelGroup>
					)}
				</>
			)}
		</div>
	)
}

export default PipelineView
