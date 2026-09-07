/**
 * Branch history table.
 *
 * Each conditional branch indexes a saturating counter by its address.  A
 * one-bit entry predicts whatever happened last time; a two-bit entry has to be
 * wrong twice in a row before it changes its mind, which is what makes it hold
 * a prediction through the last iteration of a loop.
 */

import type { ExecutionObserver, MachineConfig } from '../core/observer'
import { Replay, type Replayable } from './replay'
import { StepLog } from './stepLog'

export interface BranchHistorySettings {
	/** Entries in the table; the branch address indexes it modulo this. */
	entryCount: number
	/** Bits per counter: 1 or 2. */
	historyBits: 1 | 2
	/** The state every entry starts in. */
	initiallyTaken: boolean
}

export const DEFAULT_BHT_SETTINGS: BranchHistorySettings = {
	entryCount: 16,
	historyBits: 2,
	initiallyTaken: false,
}

export interface BranchHistoryEntry {
	index: number
	/** Counter value: 0..1 for one bit, 0..3 for two. */
	state: number
	predictTaken: boolean
	predictions: number
	correct: number
	/** Branch addresses that map to this entry. */
	addresses: number[]
}

export interface BranchHistorySnapshot {
	settings: BranchHistorySettings
	predictions: number
	correct: number
	accuracy: number
	entries: BranchHistoryEntry[]
}

interface Counter {
	state: number
	predictions: number
	correct: number
	addresses: Set<number>
}

export class BranchHistoryTable implements ExecutionObserver, Replayable {
	private settings: BranchHistorySettings
	private counters: Counter[] = []
	private predictions = 0
	private correct = 0
	/**
	 * Which way each branch went.  The counters are a function of that sequence,
	 * so stepping back runs the sequence again from the start of what was
	 * watched rather than putting a copy of the table back.
	 */
	private readonly branches = new StepLog<boolean>()
	private readonly replay = new Replay(this)

	onInstruction(_address: number, _decoded: unknown, instructionCount = 0) {
		this.replay.watch(instructionCount)
		// Running on from a step back leaves a future that did not happen, and
		// the machine's history drops the oldest instructions as it fills.
		this.branches.dropFrom(instructionCount)
		const oldest = this.replay.oldest
		if (oldest !== undefined) this.branches.dropBefore(oldest)
	}

	onSeek(to: number) {
		this.replay.seek(to)
	}

	onConfigure(machine: MachineConfig) {
		this.replay.configure(machine)
	}

	replayStep(address: number, _decoded: unknown, instructionCount: number) {
		const index = this.branches.indexFrom(instructionCount)
		if (this.branches.countAt(index) === instructionCount) {
			this.resolve(address, this.branches.valueAt(index)!)
		}
	}

	constructor(settings: BranchHistorySettings = DEFAULT_BHT_SETTINGS) {
		this.settings = settings
		this.configure(settings)
	}

	configure(settings: BranchHistorySettings) {
		this.settings = { ...settings, entryCount: Math.max(1, settings.entryCount) }
		// A different table over the same branches, so it is filled again rather
		// than emptied.
		this.replay.rework()
	}

	/** Everything worked out from the branches, which a replay redoes. */
	clear() {
		const { historyBits, initiallyTaken } = this.settings
		const start = initiallyTaken ? (historyBits === 2 ? 3 : 1) : 0
		this.counters = Array.from({ length: this.settings.entryCount }, () => ({
			state: start,
			predictions: 0,
			correct: 0,
			addresses: new Set<number>(),
		}))
		this.predictions = 0
		this.correct = 0
	}

	reset() {
		this.clear()
		this.branches.clear()
		this.replay.reset()
	}

	onReset() {
		this.reset()
	}

	onBranch(address: number, taken: boolean) {
		// The branch belongs to the instruction just taken on.
		this.branches.record(this.replay.at - 1, taken)
		this.resolve(address, taken)
	}

	/** One branch outcome through the table, live or replayed. */
	private resolve(address: number, taken: boolean) {
		const counter = this.counters[this.indexOf(address)]
		const predicted = this.predictsTaken(counter.state)

		counter.addresses.add(address >>> 0)
		counter.predictions += 1
		this.predictions += 1
		if (predicted === taken) {
			counter.correct += 1
			this.correct += 1
		}

		counter.state = this.nextState(counter.state, taken)
	}

	/** The table is indexed by the branch's own word address. */
	private indexOf(address: number): number {
		return ((address >>> 2) % this.settings.entryCount + this.settings.entryCount) % this.settings.entryCount
	}

	private predictsTaken(state: number): boolean {
		return this.settings.historyBits === 2 ? state >= 2 : state >= 1
	}

	/** Saturating: the counter moves one step toward the outcome and stops. */
	private nextState(state: number, taken: boolean): number {
		const top = this.settings.historyBits === 2 ? 3 : 1
		return Math.max(0, Math.min(top, state + (taken ? 1 : -1)))
	}

	snapshot(): BranchHistorySnapshot {
		this.replay.settle()
		return {
			settings: this.settings,
			predictions: this.predictions,
			correct: this.correct,
			accuracy: this.predictions === 0 ? 0 : this.correct / this.predictions,
			entries: this.counters.map((counter, index) => ({
				index,
				state: counter.state,
				predictTaken: this.predictsTaken(counter.state),
				predictions: counter.predictions,
				correct: counter.correct,
				addresses: [...counter.addresses].sort((left, right) => left - right),
			})),
		}
	}
}
