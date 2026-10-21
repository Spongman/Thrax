/**
 * Pipeline visualizer.
 *
 * The simulator itself is not pipelined: it retires one instruction at a time
 * with branches resolved immediately.  This tool is an overlay that takes the
 * sequence of instructions that actually ran and works out when each stage of
 * each one would happen on the pipeline the architecture describes, so the
 * cost of a hazard is visible without changing what the program computes.
 *
 * What is modelled: in-order single issue, RAW hazards under the model's
 * bypass and stall policies, the stage a branch or jump resolves in, delay
 * slots or annulment, branch prediction, and stage occupancy supplied by the
 * architecture. Cache/bus contention is not inferred from memory accesses;
 * an architecture must supply any such cost in its timing model.
 */

import { PipelineResult, type InstructionSet, type PipelineBypass, type PipelineModel as ArchitecturePipeline, type PipelineOption, type PipelineExecutionTiming } from '../architectures/contracts'
import type { ExecutionObserver, MachineConfig } from '../core/observer'
import { Replay, type Replayable } from './replay'
import { StepLog } from './stepLog'

/**
 * Where a branch outcome is known, which sets the penalty for getting it wrong.
 * These are persisted keys of the model's options.
 */
export type BranchResolution = 'id' | 'ex' | 'mem'

/** A jump has no condition, so it is known one stage earlier than a branch can be. */
export type JumpResolution = 'id' | 'ex'

/** Keys of the model's read-after-write policies. */
export type DataHazardPolicy = 'forwarding' | 'split-decode' | 'none'

/**
 * The front end's guess at a branch.  `none` is no predictor at all, which
 * pays the penalty on every taken branch; the rest pay only when wrong.
 */
export type PredictionScheme = 'none' | 'taken' | 'not-taken' | 'one-bit' | 'two-bit'

export interface PipelineSettings {
	dataHazards: DataHazardPolicy
	resolveBranchIn: BranchResolution
	resolveJumpIn: JumpResolution
	prediction: PredictionScheme
	/** Rows kept for the timeline; the counters cover the whole run. */
	windowSize: number
}

export const DEFAULT_PIPELINE_SETTINGS: PipelineSettings = {
	dataHazards: 'forwarding',
	resolveBranchIn: 'ex',
	resolveJumpIn: 'id',
	prediction: 'none',
	windowSize: 24,
}

/** Why an instruction could not leave the read stage on the cycle after it entered. */
export type StallCause = 'data' | 'load-use' | 'structural' | null

export interface PipelineRow {
	index: number
	address: number
	op: string
	/** Cycle each stage is entered, indexed as the model's stages. */
	cycles: number[]
	/** Active cycles in each stage; absent means one throughout. */
	durations?: readonly number[]
	/** End of the final active stage, inclusive. */
	completed?: number
	/** Waits for a busy stage, included in stalls. */
	structuralStalls?: number
	/** Cycles spent held in the model's read stage. */
	stalls: number
	cause: StallCause
	/** Register number this instruction waited on, for the tooltip. */
	blockedOn: number | null
	/** Index of the instruction whose result it waited for, or null. */
	blockedBy: number | null
	/** Cycles the front end lost because the instruction before it redirected. */
	flushed: number
	/** What the predictor said about this branch, or null when it is not one. */
	predicted: boolean | null
	mispredicted: boolean
}

/** Per-instruction totals over the whole run, for the editor's hover. */
export interface PipelineAddressStats {
	executions: number
	stalls: number
	loadUseStalls: number
	structuralStalls: number
	/** Cycles lost to the front end refilling after the instruction before. */
	flushed: number
	branches: number
	mispredictions: number
}

export interface PipelineSnapshot {
	settings: PipelineSettings
	instructions: number
	cycles: number
	cpi: number
	/** CPI with the cost of filling the pipeline taken out. */
	steadyStateCpi: number
	/** Cycles an ideal pipeline would take: one per instruction plus fill. */
	idealCycles: number
	dataStalls: number
	loadUseStalls: number
	structuralStalls: number
	/** Additional active cycles, excluding time spent waiting behind another instruction. */
	multiCycleCycles: number
	controlFlushes: number
	/** Branches the predictor was asked about, and how many it got wrong. */
	predictions: number
	mispredictions: number
	/** The tail of the run, at most `windowSize` rows. */
	rows: PipelineRow[]
	/** Cycle the first shown row starts at, so the grid can be offset. */
	firstCycle: number
	/** Totals per instruction address, which outlive the window of rows. */
	byAddress: Map<number, PipelineAddressStats>
	/** Names of the registers `blockedOn` indexes, from the architecture. */
	registerNames: readonly string[]
	/** The architecture's pipeline, or null before a machine or where it has none. */
	model: ArchitecturePipeline | null
	/** False once a machine with no pipeline model is attached. */
	available: boolean
}

/** The option `value` names, or the list's first. */
export function optionFor<T extends PipelineOption>(options: readonly T[], value: string): T {
	for (const option of options) if (option.value === value) return option
	return options[0]
}

/** A model under one choice of settings, flattened to the ints the hot path reads. */
interface Timing {
	stageCount: number
	/** Stage a waiting instruction is held in. */
	hold: number
	/** Stage after `hold`, whose entry the operands gate. */
	gate: number
	/** Earliest stage a bypass carries each kind of result from, or -1. */
	aluBypass: number
	loadBypass: number
	/** Added to the bypass stage's cycle to give the earliest `gate` entry. */
	bypassDelay: number
	writeStage: number
	/** Added to the write stage's cycle for a read through the register file. */
	fileDelay: number
	/** Whether a load's stall is the one bypassing cannot remove. */
	loadUse: boolean
	/** Instructions fetched behind a transfer before it resolves. */
	branchPenalty: number
	jumpPenalty: number
	delaySlots: number
}

function earliestBypass(bypasses: readonly PipelineBypass[], result: number) {
	let stage = -1
	for (const bypass of bypasses) {
		if ((bypass.results & result) !== 0 && (stage < 0 || bypass.from < stage)) stage = bypass.from
	}
	return stage
}

function timingOf(model: ArchitecturePipeline, settings: PipelineSettings): Timing {
	const policy = optionFor(model.hazards, settings.dataHazards)
	const hold = model.readStage
	return {
		stageCount: model.stages.length,
		hold,
		gate: hold + 1,
		aluBypass: earliestBypass(policy.bypasses, PipelineResult.ALU),
		loadBypass: earliestBypass(policy.bypasses, PipelineResult.LOAD),
		// Used in `hold` itself, a value must arrive while the instruction is
		// still there; used in the next stage, it may arrive on the way in.
		bypassDelay: 1 - (policy.useStage - hold),
		writeStage: model.writeStage,
		fileDelay: policy.writeThenRead ? 1 : 2,
		loadUse: policy.bypasses.length > 0,
		branchPenalty: optionFor(model.branches, settings.resolveBranchIn).stage,
		jumpPenalty: optionFor(model.jumps, settings.resolveJumpIn).stage,
		delaySlots: model.delaySlots,
	}
}

interface InFlight {
	/** Index of the instruction, so a row can name what it waited for. */
	index: number
	writes: readonly number[]
	loadWrites?: readonly number[]
	isLoad: boolean
	cycles: readonly number[]
	durations: readonly number[]
}

export class PipelineModel implements ExecutionObserver, Replayable {
	private settings: PipelineSettings
	private rows: PipelineRow[] = []
	private recent: InFlight[] = []
	private index = 0
	/** Cycles the instruction before this one entered each stage. */
	private previous: readonly number[] | null = null
	private previousDurations: readonly number[] = []
	private observedOrigin: number | null = null
	private observedFill: number | null = null
	private observedTiming = false
	private pendingFetch = 0
	private lastCycle = 0
	private firstCycle = 1
	private dataStalls = 0
	private loadUseStalls = 0
	private structuralStalls = 0
	private multiCycleCycles = 0
	private controlFlushes = 0
	/** Penalty the instruction now being fetched owes the branch before it. */
	private pendingFlush = 0
	private predictions = 0
	private mispredictions = 0
	/** Saturating counters, one per branch address. */
	private predictor = new Map<number, number>()
	/** Whole-run totals per address; the row window keeps only the tail.  */
	private addresses = new Map<number, PipelineAddressStats>()
	/** Stats of the instruction now retiring, which its branch reports against. */
	private lastStats: PipelineAddressStats | null = null
	/**
	 * Whether the simulator is running with delay slots, which the front end
	 * fills usefully and so does not have to flush.  It arrives with the machine
	 * configuration at `onConfigure`; `reset` leaves it alone because it
	 * describes the machine, not the run.
	 */
	delaySlots = false
	/** Register traffic and control class of each instruction, from the architecture. */
	private instructions: InstructionSet | null = null
	/** The pipeline the architecture describes, and its reading under the settings. */
	private model: ArchitecturePipeline | null = null
	private timing: Timing | null = null
	/**
	 * Which way each conditional branch went.  The one thing a replay cannot
	 * work out for itself: the machine's log holds what ran, not what was
	 * decided, and the instruction after a branch is the handler's when an
	 * interrupt lands in between.  Recorded only while the tool is watching.
	 */
	private readonly branches = new StepLog<boolean>()
	private readonly replay = new Replay(this)

	onSeek(to: number) {
		this.replay.seek(to)
	}

	/** One instruction again, and the branch outcome noted against it. */
	replayStep(address: number, instruction: unknown, instructionCount: number) {
		this.apply(address, instruction, instructionCount)
		const index = this.branches.indexFrom(instructionCount)
		if (this.branches.countAt(index) === instructionCount) {
			this.resolveBranch(address, this.branches.valueAt(index)!)
		}
	}

	constructor(settings: PipelineSettings = DEFAULT_PIPELINE_SETTINGS) {
		this.settings = settings
		this.reset()
	}

	configure(settings: PipelineSettings) {
		const next = { ...settings, windowSize: Math.max(1, settings.windowSize) }
		// Only the timing model invalidates what has been recorded; the window
		// decides how much of it to keep, so changing it keeps the log.
		const modelChanged = next.dataHazards !== this.settings.dataHazards
			|| next.resolveBranchIn !== this.settings.resolveBranchIn
			|| next.resolveJumpIn !== this.settings.resolveJumpIn
			|| next.prediction !== this.settings.prediction
		this.settings = next
		if (modelChanged) {
			this.timing = this.model && timingOf(this.model, next)
			// The instructions that ran have not changed, only what the model makes
			// of them, so the reading is worked out again rather than thrown away.
			this.replay.rework()
			return
		}
		while (this.rows.length > next.windowSize) this.rows.shift()
		this.firstCycle = this.rows.length > 0 ? this.rows[0].cycles[0] : 1
	}

	/** Everything worked out from the instructions, which a replay redoes. */
	clear() {
		this.rows = []
		this.recent = []
		this.index = 0
		this.previous = null
		this.previousDurations = []
		this.observedOrigin = null
		this.observedFill = null
		this.observedTiming = false
		this.pendingFetch = 0
		this.lastCycle = 0
		this.firstCycle = 1
		this.dataStalls = 0
		this.loadUseStalls = 0
		this.structuralStalls = 0
		this.multiCycleCycles = 0
		this.controlFlushes = 0
		this.pendingFlush = 0
		this.predictions = 0
		this.mispredictions = 0
		this.predictor.clear()
		this.addresses.clear()
		this.lastStats = null
	}

	/** A new run: what was worked out and what was watched both go. */
	reset() {
		this.clear()
		this.branches.clear()
		this.replay.reset()
	}

	onReset() {
		this.reset()
	}

	onConfigure(machine: MachineConfig) {
		this.delaySlots = machine.delayedBranching
		this.instructions = machine.instructions ?? null
		this.model = this.instructions?.pipeline ?? null
		this.timing = this.model && timingOf(this.model, this.settings)
		this.replay.configure(machine)
	}

	private statsFor(address: number) {
		const key = address
		let stats = this.addresses.get(key)
		if (!stats) {
			stats = { executions: 0, stalls: 0, loadUseStalls: 0, structuralStalls: 0, flushed: 0, branches: 0, mispredictions: 0 }
			this.addresses.set(key, stats)
		}
		return stats
	}

	onInstruction(address: number, instruction: unknown, instructionCount = 0) {
		this.replay.watch(instructionCount)
		// Running on from a step back leaves a future that did not happen, and
		// the machine's history drops the oldest instructions as it fills.
		this.branches.dropFrom(instructionCount)
		const oldest = this.replay.oldest
		if (oldest !== undefined) this.branches.dropBefore(oldest)
		this.apply(address, instruction, instructionCount)
	}

	/** One instruction through the model, live or replayed. */
	private apply(address: number, instruction: unknown, instructionCount: number) {
		// Without the architecture's reading and pipeline there is nothing to model.
		const timing = this.timing
		if (!this.instructions || !timing) return
		const observed = this.model?.executionTiming?.(instruction)
		this.observedTiming = observed !== undefined
		if (observed) {
			this.applyObserved(address, instruction, observed)
			return
		}
		const effects = this.instructions.describe(instruction)
		const flushed = this.pendingFlush
		this.pendingFlush = 0

		// An instruction may enter a stage only once the one ahead has left it, so
		// a stall anywhere backs the whole front end up behind it.
		const { stageCount, hold, gate } = timing
		const prior = this.previous
		const cycles = new Array<number>(stageCount)
		const durations = Array.from({ length: stageCount }, (_, stage) =>
			Math.max(1, Math.trunc(this.model?.stageCycles?.(instruction, stage) ?? 1)))
		const available = (stage: number) => prior === null ? 0 : Math.max(
			prior[stage] + this.previousDurations[stage],
			stage + 1 < stageCount ? prior[stage + 1] : 0)
		cycles[0] = Math.max((prior ? available(0) : 1) + flushed, this.pendingFetch)
		this.pendingFetch = 0
		for (let stage = 1; stage <= gate; stage++) {
			cycles[stage] = Math.max(cycles[stage - 1] + durations[stage - 1], available(stage))
		}
		const structural = cycles[gate] - cycles[hold] - durations[hold]

		// Leave the hold stage as soon as every operand has arrived.
		let cause: StallCause = structural > 0 ? 'structural' : null
		let blockedOn: number | null = null
		let blockedBy: number | null = null
		for (const register of effects.reads) {
			const producer = this.producerOf(register)
			if (!producer) continue
			const loaded = producer.isLoad && (producer.loadWrites?.includes(register) ?? true)
			const bypass = loaded ? timing.loadBypass : timing.aluBypass
			const fromFile = producer.cycles[timing.writeStage] + producer.durations[timing.writeStage] - 1 + timing.fileDelay
			const ready = bypass < 0 ? fromFile : Math.min(fromFile, producer.cycles[bypass] + producer.durations[bypass] - 1 + timing.bypassDelay)
			if (ready > cycles[gate]) {
				cycles[gate] = ready
				cause = timing.loadUse && loaded ? 'load-use' : 'data'
				blockedOn = register
				blockedBy = producer.index
			}
		}
		for (let stage = gate + 1; stage < stageCount; stage++)
			cycles[stage] = Math.max(cycles[stage - 1] + durations[stage - 1], available(stage))

		const stalls = cycles[gate] - cycles[hold] - durations[hold]
		this.structuralStalls += structural
		this.multiCycleCycles += durations.reduce((sum, duration) => sum + duration - 1, 0)
		const data = stalls - structural
		if (data > 0) {
			if (cause === 'load-use') this.loadUseStalls += data
			else this.dataStalls += data
		}

		// An unconditional jump always redirects; a branch reports itself below.
		if (effects.isJump) this.redirect(timing.jumpPenalty, cycles, durations)

		const stats = this.statsFor(address)
		stats.executions += 1
		stats.stalls += Math.max(0, stalls)
		if (cause === 'load-use') stats.loadUseStalls += data
		stats.structuralStalls += structural
		stats.flushed += flushed
		this.lastStats = stats

		this.index += 1
		this.previous = cycles
		this.previousDurations = durations
		const completed = cycles[stageCount - 1] + durations[stageCount - 1] - 1
		this.lastCycle = Math.max(this.lastCycle, completed)

		this.recent.push({ index: this.index, writes: effects.writes, loadWrites: effects.loadWrites, isLoad: effects.isLoad, cycles, durations })
		if (this.recent.length > 8) this.recent.shift()

		this.rows.push({
			index: this.index,
			address: address,
			op: effects.mnemonic,
			cycles,
			durations,
			completed,
			structuralStalls: structural,
			stalls,
			cause,
			blockedOn,
			blockedBy,
			flushed,
			predicted: null,
			mispredicted: false,
		})
		if (this.rows.length > this.settings.windowSize) {
			this.rows.shift()
			this.firstCycle = this.rows[0].cycles[0]
		}
	}

	/** The shared window and counters can also consume a CPU's actual execution schedule. */
	private applyObserved(address: number, instruction: unknown, timing: PipelineExecutionTiming) {
		const effects = this.instructions!.describe(instruction)
		this.observedOrigin ??= timing.starts[0]
		this.observedFill ??= timing.starts[this.model!.writeStage] - timing.starts[0]
		const origin = this.observedOrigin
		const cycles = timing.starts.map((start) => start - origin + 1)
		const durations = [...timing.durations]
		const completed = timing.completed - origin
		const hold = this.timing!.hold
		const stalls = Math.max(0, cycles[hold + 1] - cycles[hold] - durations[hold])
		const flushed = this.pendingFlush
		const stats = this.statsFor(address)
		stats.executions++
		stats.stalls += stalls
		stats.structuralStalls += stalls
		stats.flushed += flushed
		this.lastStats = stats
		this.structuralStalls += stalls
		this.multiCycleCycles += Math.max(0, durations[durations.length - 1] - 1)
		this.controlFlushes += timing.discarded
		this.pendingFlush = timing.discarded
		this.index++
		this.lastCycle = Math.max(this.lastCycle, completed)
		this.rows.push({
			index: this.index, address: address, op: effects.mnemonic, cycles, durations, completed,
			stalls, structuralStalls: stalls, cause: stalls > 0 ? 'structural' : null,
			blockedOn: null, blockedBy: stalls > 0 ? this.index - 1 : null, flushed,
			predicted: null, mispredicted: false,
		})
		if (this.rows.length > this.settings.windowSize) this.rows.shift()
		this.firstCycle = this.rows[0].cycles[0]
	}

	/**
	 * Raised while the branch executes, so it lands after that instruction's own
	 * `onInstruction` and the penalty falls on whatever is fetched next, which is
	 * exactly where a real pipeline pays it.
	 */
	onBranch(address: number, taken: boolean) {
		// The branch just went through the model, so the outcome belongs to the
		// instruction behind the count it now stands at.
		this.branches.record(this.replay.at - 1, taken)
		this.resolveBranch(address, taken)
	}

	/** One branch outcome through the model, live or replayed. */
	private resolveBranch(address: number, taken: boolean) {
		if (!this.timing) return
		const penalty = this.timing.branchPenalty
		const row = this.rows[this.rows.length - 1]

		// With no predictor the front end simply falls through, so only a taken
		// branch costs anything.  With one, only a wrong guess does.
		const stats = this.lastStats
		if (stats) stats.branches += 1
		if (this.observedTiming) return

		if (this.settings.prediction === 'none') {
			if (taken) this.redirect(penalty, row?.cycles, row?.durations)
			if (row) row.mispredicted = taken
			if (stats && taken) stats.mispredictions += 1
			return
		}

		const predicted = this.predicts(address)
		this.predictions += 1
		if (predicted !== taken) {
			this.mispredictions += 1
			if (stats) stats.mispredictions += 1
			this.redirect(penalty, row?.cycles, row?.durations)
		}
		if (row) {
			row.predicted = predicted
			row.mispredicted = predicted !== taken
		}
		this.learn(address, taken)
	}

	/** What the front end would guess about the branch at `address`. */
	private predicts(address: number): boolean {
		const scheme = this.settings.prediction
		if (scheme === 'taken') return true
		if (scheme === 'not-taken' || scheme === 'none') return false
		const state = this.predictor.get(address) ?? 0
		return scheme === 'two-bit' ? state >= 2 : state >= 1
	}

	/** Moves the counter one step toward what actually happened, and stops there. */
	private learn(address: number, taken: boolean) {
		const scheme = this.settings.prediction
		if (scheme !== 'one-bit' && scheme !== 'two-bit') return
		const top = scheme === 'two-bit' ? 3 : 1
		const state = this.predictor.get(address) ?? 0
		this.predictor.set(address, Math.max(0, Math.min(top, state + (taken ? 1 : -1))))
	}

	/**
	 * Charges the front end for the instructions fetched down the wrong path,
	 * which are annulled.  Delay slots are ones the machine runs anyway, so
	 * they cost nothing.
	 */
	private redirect(penalty: number, cycles?: readonly number[], durations?: readonly number[]) {
		const cost = Math.max(0, penalty - (this.delaySlots ? this.timing!.delaySlots : 0))
		this.pendingFlush = cost
		if (cycles) this.pendingFetch = cycles[penalty] + (durations?.[penalty] ?? 1) - (this.delaySlots ? this.timing!.delaySlots : 0)
		this.controlFlushes += cost
	}

	/** The most recent still-relevant instruction writing `register`. */
	private producerOf(register: number): InFlight | null {
		for (let i = this.recent.length - 1; i >= 0; i--) {
			if (this.recent[i].writes.includes(register)) return this.recent[i]
		}
		return null
	}

	snapshot(): PipelineSnapshot {
		this.replay.settle()
		const cycles = this.lastCycle
		const fill = (this.model?.stages.length ?? 1) - 1
		return {
			settings: this.settings,
			instructions: this.index,
			cycles,
			cpi: this.index === 0 ? 0 : cycles / this.index,
			steadyStateCpi: this.index === 0 ? 0 : (cycles - (this.observedFill ?? fill)) / this.index,
			idealCycles: this.index === 0 ? 0 : this.index + fill,
			dataStalls: this.dataStalls,
			loadUseStalls: this.loadUseStalls,
			structuralStalls: this.structuralStalls,
			multiCycleCycles: this.multiCycleCycles,
			controlFlushes: this.controlFlushes,
			predictions: this.predictions,
			mispredictions: this.mispredictions,
			rows: this.rows,
			firstCycle: this.rows.length > 0 ? this.rows[0].cycles[0] : 1,
			byAddress: new Map([...this.addresses].map(([address, stats]) => [address, { ...stats }])),
			registerNames: this.instructions?.registerNames ?? [],
			model: this.model,
			available: this.instructions === null || this.model !== null,
		}
	}
}
