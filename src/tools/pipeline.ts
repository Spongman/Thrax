/**
 * Five-stage pipeline visualizer.
 *
 * The simulator itself is not pipelined: it retires one instruction at a time
 * with branches resolved immediately.  This tool is an overlay that takes the
 * sequence of instructions that actually ran and works out when each stage of
 * each one would happen on a classic MIPS pipeline, so the cost of a hazard is
 * visible without changing what the program computes.
 *
 * What is modelled: in-order single issue, IF/ID/EX/MEM/WB, RAW hazards under
 * three countermeasures, the stage a branch or jump resolves in, and branch
 * prediction.  Those follow Tables III and IV of Lim & Smitha, "Pipelined MIPS
 * Simulation" (TALE 2019), which describes the PSBE plug-in.  What is
 * not modelled: structural hazards on memory (separate caches are assumed) and
 * write-after-write, which cannot arise in order.
 */

import type { Decoded } from '../core/decoder'
import { Op, OP_NAMES } from '../core/ops'
import type { ExecutionObserver, MachineConfig } from '../core/observer'
import { Replay, type Replayable } from './replay'
import { StepLog } from './stepLog'

export const STAGES = ['IF', 'ID', 'EX', 'MEM', 'WB'] as const
export type Stage = (typeof STAGES)[number]

/** Where a branch outcome is known, which sets the penalty for getting it wrong. */
export type BranchResolution = 'id' | 'ex' | 'mem'

/** A jump has no condition, so it is known one stage earlier than a branch can be. */
export type JumpResolution = 'id' | 'ex'

/** Bubbles owed when control is redirected from each stage (Table IV). */
const RESOLUTION_PENALTY: Record<BranchResolution, number> = { id: 1, ex: 2, mem: 3 }

/**
 * How the hardware copes with a read-after-write dependency (Table III):
 * bypasses feed the result back with no delay; a register file that decodes and
 * writes back in one cycle costs two bubbles; neither costs three.
 */
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

/** Why an instruction could not enter EX on the cycle after it was decoded. */
export type StallCause = 'data' | 'load-use' | null

export interface PipelineRow {
	index: number
	address: number
	op: string
	/** Cycle each stage occupies, indexed as in STAGES. */
	cycles: [number, number, number, number, number]
	/** Cycles spent waiting in ID before EX. */
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
}

const LOADS = new Set([Op.LB, Op.LBU, Op.LH, Op.LHU, Op.LW])
const STORES = new Set([Op.SB, Op.SH, Op.SW])
const JUMPS = new Set([Op.J, Op.JAL, Op.JR, Op.JALR])
const RA = 31

export interface RegisterEffects {
	reads: number[]
	/** Register written, or -1 for none.  $zero counts as none. */
	writes: number
	isLoad: boolean
	isBranch: boolean
	isJump: boolean
}

/**
 * Which general-purpose registers an instruction reads and writes.  Only the
 * integer file matters here: the coprocessors have their own, and no bypass
 * between the two exists to model.
 */
export function registerEffects(decoded: Decoded): RegisterEffects {
	const { op, rs, rt, rd, shape } = decoded
	const isLoad = LOADS.has(op)
	// cc,branch is bc1t/bc1f with an explicit condition code -
	// without it here, a non-zero-cc bc1t was not counted as a branch at all.
	const isBranch = shape === 'rs,rt,branch' || shape === 'rs,branch' || shape === 'branch' || shape === 'cc,branch'
	const isJump = JUMPS.has(op)
	const effects = (reads: number[], writes = -1): RegisterEffects => ({
		reads: reads.filter((register) => register !== 0),
		writes: writes === 0 ? -1 : writes,
		isLoad,
		isBranch,
		isJump,
	})

	switch (shape) {
		case 'rd,rs,rt': return effects([rs, rt], rd)
		case 'rd,rt,shamt': return effects([rt], rd)
		case 'rd,rt,rs': return effects([rt, rs], rd)
		case 'rd,rs': return effects([rs], rd)
		// movf/movt with an explicit condition code - same
		// register traffic as the plain 'rd,rs' form, the cc only picks whether it commits.
		case 'rd,rs,cc': return effects([rs], rd)
		case 'rs,rt': return effects([rs, rt])
		case 'rd': return effects([], rd)
		case 'rs': return effects([rs])
		case 'jr': return effects([rs])
		case 'jalr': return effects([rs], rd)
		case 'rt,rs,imm': return effects([rs], rt)
		case 'rt,rs,uimm': return effects([rs], rt)
		case 'rt,uimm': return effects([], rt)
		// A store reads the value it writes out; a load writes the register.
		case 'rt,offset(rs)': return STORES.has(op) ? effects([rs, rt]) : effects([rs], rt)
		// The coprocessor loads and stores touch only the base register here.
		case 'ft,offset(rs)': return effects([rs])
		// The twelve traps: rs,imm reads only the register
		// half, since the immediate is baked into the word, not carried in a register.
		case 'rs,imm': return effects([rs])
		case 'rs,rt,branch': return effects([rs, rt])
		// bgezal/bltzal write $ra like jal, in addition to reading rs.
		case 'rs,branch': return (op === Op.BGEZAL || op === Op.BLTZAL) ? effects([rs], RA) : effects([rs])
		case 'branch': return effects([])
		// bc1t/bc1f with an explicit condition code: no GPR is read, only the FP flag,
		// which this model does not track (see the module comment).
		case 'cc,branch': return effects([])
		// movz.s/movn.s/movz.d/movn.d: the condition is a GPR (rt); the moved value and
		// destination are both FP registers, which this model does not track.
		case 'fd,fs,rt': return effects([rt])
		case 'jump': return op === Op.JAL ? effects([], RA) : effects([])
		case 'rt,cp0': return op === Op.MFC0 ? effects([], rt) : effects([rt])
		case 'rt,fs': return op === Op.MFC1 ? effects([], rt) : effects([rt])
		// syscall reads its arguments; the CP1 operations use the other file.
		case 'none': return op === Op.SYSCALL ? effects([2, 4, 5, 6, 7]) : effects([])
		default: return effects([])
	}
}

interface InFlight {
	/** Index of the instruction, so a row can name what it waited for. */
	index: number
	writes: number
	isLoad: boolean
	ex: number
	mem: number
	wb: number
}

export class PipelineModel implements ExecutionObserver, Replayable {
	private settings: PipelineSettings
	private rows: PipelineRow[] = []
	private recent: InFlight[] = []
	private index = 0
	/** Cycles the instruction before this one occupies each stage. */
	private previous: [number, number, number, number, number] | null = null
	private lastCycle = 0
	private firstCycle = 1
	private dataStalls = 0
	private loadUseStalls = 0
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
	replayStep(address: number, decoded: Decoded, instructionCount: number) {
		this.apply(address, decoded, instructionCount)
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
		this.lastCycle = 0
		this.firstCycle = 1
		this.dataStalls = 0
		this.loadUseStalls = 0
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
		this.replay.configure(machine)
	}

	private statsFor(address: number) {
		const key = address >>> 0
		let stats = this.addresses.get(key)
		if (!stats) {
			stats = { executions: 0, stalls: 0, loadUseStalls: 0, flushed: 0, branches: 0, mispredictions: 0 }
			this.addresses.set(key, stats)
		}
		return stats
	}

	onInstruction(address: number, decoded: Decoded, instructionCount = 0) {
		this.replay.watch(instructionCount)
		// Running on from a step back leaves a future that did not happen, and
		// the machine's history drops the oldest instructions as it fills.
		this.branches.dropFrom(instructionCount)
		const oldest = this.replay.oldest
		if (oldest !== undefined) this.branches.dropBefore(oldest)
		this.apply(address, decoded, instructionCount)
	}

	/** One instruction through the model, live or replayed. */
	private apply(address: number, decoded: Decoded, instructionCount: number) {
		const effects = registerEffects(decoded)
		const flushed = this.pendingFlush
		this.pendingFlush = 0

		// An instruction may enter a stage only once the one ahead has left it, so
		// a stall anywhere backs the whole front end up behind it.
		const [priorIf, priorId, priorEx, priorMem] = this.previous ?? [0, 0, 0, 0]
		const ifCycle = Math.max(priorIf + 1, priorId) + flushed
		const idCycle = Math.max(ifCycle + 1, priorEx)

		// Enter EX as soon as the stage is free and every operand has arrived.
		let exCycle = Math.max(idCycle + 1, priorMem)
		let cause: StallCause = null
		let blockedOn: number | null = null
		let blockedBy: number | null = null

		const forwarding = this.settings.dataHazards === 'forwarding'
		for (const register of effects.reads) {
			const producer = this.producerOf(register)
			if (!producer) continue
			// Forwarding: an ALU result is ready after EX, a load after MEM.
			// Split decode: ID reads in the same cycle write-back writes.
			// Neither: ID has to wait for the cycle after write-back.
			const ready = forwarding
				? (producer.isLoad ? producer.mem : producer.ex) + 1
				: producer.wb + (this.settings.dataHazards === 'split-decode' ? 1 : 2)
			if (ready > exCycle) {
				exCycle = ready
				cause = forwarding && producer.isLoad ? 'load-use' : 'data'
				blockedOn = register
				blockedBy = producer.index
			}
		}

		const stalls = exCycle - (idCycle + 1)
		if (stalls > 0) {
			if (cause === 'load-use') this.loadUseStalls += stalls
			else this.dataStalls += stalls
		}

		const memCycle = exCycle + 1
		const wbCycle = memCycle + 1

		// An unconditional jump always redirects; a branch reports itself below.
		if (effects.isJump) this.redirect(RESOLUTION_PENALTY[this.settings.resolveJumpIn])

		const stats = this.statsFor(address)
		stats.executions += 1
		stats.stalls += Math.max(0, stalls)
		if (cause === 'load-use') stats.loadUseStalls += stalls
		stats.flushed += flushed
		this.lastStats = stats

		this.index += 1
		this.previous = [ifCycle, idCycle, exCycle, memCycle, wbCycle]
		this.lastCycle = Math.max(this.lastCycle, wbCycle)

		this.recent.push({ index: this.index, writes: effects.writes, isLoad: effects.isLoad, ex: exCycle, mem: memCycle, wb: wbCycle })
		if (this.recent.length > 8) this.recent.shift()

		this.rows.push({
			index: this.index,
			address: address >>> 0,
			op: OP_NAMES[decoded.op],
			cycles: [ifCycle, idCycle, exCycle, memCycle, wbCycle],
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
		const penalty = RESOLUTION_PENALTY[this.settings.resolveBranchIn]
		const row = this.rows[this.rows.length - 1]

		// With no predictor the front end simply falls through, so only a taken
		// branch costs anything.  With one, only a wrong guess does.
		const stats = this.lastStats
		if (stats) stats.branches += 1

		if (this.settings.prediction === 'none') {
			if (taken) this.redirect(penalty)
			if (row) row.mispredicted = taken
			if (stats && taken) stats.mispredictions += 1
			return
		}

		const predicted = this.predicts(address)
		this.predictions += 1
		if (predicted !== taken) {
			this.mispredictions += 1
			if (stats) stats.mispredictions += 1
			this.redirect(penalty)
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
		const state = this.predictor.get(address >>> 0) ?? 0
		return scheme === 'two-bit' ? state >= 2 : state >= 1
	}

	/** Moves the counter one step toward what actually happened, and stops there. */
	private learn(address: number, taken: boolean) {
		const scheme = this.settings.prediction
		if (scheme !== 'one-bit' && scheme !== 'two-bit') return
		const top = scheme === 'two-bit' ? 3 : 1
		const state = this.predictor.get(address >>> 0) ?? 0
		this.predictor.set(address >>> 0, Math.max(0, Math.min(top, state + (taken ? 1 : -1))))
	}

	/**
	 * Charges the front end for instructions fetched down the wrong path.  A
	 * delay slot is one of them that the machine runs anyway, so it costs nothing.
	 */
	private redirect(penalty: number) {
		const cost = Math.max(0, penalty - (this.delaySlots ? 1 : 0))
		this.pendingFlush = cost
		this.controlFlushes += cost
	}

	/** The most recent still-relevant instruction writing `register`. */
	private producerOf(register: number): InFlight | null {
		for (let i = this.recent.length - 1; i >= 0; i--) {
			if (this.recent[i].writes === register) return this.recent[i]
		}
		return null
	}

	snapshot(): PipelineSnapshot {
		this.replay.settle()
		const cycles = this.lastCycle
		return {
			settings: this.settings,
			instructions: this.index,
			cycles,
			cpi: this.index === 0 ? 0 : cycles / this.index,
			steadyStateCpi: this.index === 0 ? 0 : (cycles - (STAGES.length - 1)) / this.index,
			idealCycles: this.index === 0 ? 0 : this.index + STAGES.length - 1,
			dataStalls: this.dataStalls,
			loadUseStalls: this.loadUseStalls,
			controlFlushes: this.controlFlushes,
			predictions: this.predictions,
			mispredictions: this.mispredictions,
			rows: this.rows,
			firstCycle: this.rows.length > 0 ? this.rows[0].cycles[0] : 1,
			byAddress: new Map([...this.addresses].map(([address, stats]) => [address, { ...stats }])),
		}
	}
}
