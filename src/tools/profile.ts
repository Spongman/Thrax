/**
 * Instruction profile: how often each instruction ran, and how its branches
 * turned out.
 *
 * The source editor paints the counts as a heat map over the line numbers and
 * reports them on hover, so the snapshot carries the hottest count as well,
 * which is the top of that scale.
 */

import type { ExecutionObserver, MachineConfig } from '../core/observer'
import { Replay, type Replayable } from './replay'
import { StepLog } from './stepLog'

export interface AddressProfile {
	/** Times the instruction at this address ran. */
	count: number
	/** Conditional branches resolved here, by outcome. */
	taken: number
	notTaken: number
}

export interface ProfileSnapshot {
	byAddress: Map<number, AddressProfile>
	total: number
	/** Executions of the hottest instruction. */
	max: number
}

/** Heat steps the editor colours, coldest first. */
export const HEAT_LEVELS = 6

/**
 * Heat step for `count` against the hottest instruction of the run, or -1 for
 * an instruction that never ran.  The scale is logarithmic: an inner loop runs
 * orders of magnitude more often than the setup around it, and a linear scale
 * would leave everything but that loop the same cold colour.
 */
export function heatLevel(count: number, max: number) {
	if (count <= 0 || max <= 0) return -1
	if (count >= max) return HEAT_LEVELS - 1
	const share = Math.log(count) / Math.log(max)
	return Math.min(HEAT_LEVELS - 1, Math.floor(share * HEAT_LEVELS))
}

/**
 * What the tool held for the one address an instruction touches, which is all
 * an instruction can change.
 *
 * Copying the whole address map on every instruction cost more than the run
 * itself: a map of the addresses a program touches, rebuilt a hundred thousand
 * times.  Like the machine's own effects, this holds the values that are **not**
 * in the tool, so exchanging it serves both directions.
 */
export class ExecutionProfile implements ExecutionObserver, Replayable {
	private addresses = new Map<number, AddressProfile>()
	private total = 0
	private max = 0
	/**
	 * Which way each branch went, which is the only thing here that the
	 * instructions alone do not say.  Everything else is a tally of them, so a
	 * step back counts them again rather than putting a copy back.
	 */
	private readonly branches = new StepLog<boolean>()
	private readonly replay = new Replay(this)

	onSeek(to: number) {
		this.replay.seek(to)
	}

	onConfigure(machine: MachineConfig) {
		this.replay.configure(machine)
	}

	replayStep(address: number, _decoded: unknown, instructionCount: number) {
		this.count(address)
		const index = this.branches.indexFrom(instructionCount)
		if (this.branches.countAt(index) === instructionCount) {
			this.resolve(address, this.branches.valueAt(index)!)
		}
	}

	private entryFor(address: number) {
		const key = address >>> 0
		let entry = this.addresses.get(key)
		if (!entry) {
			entry = { count: 0, taken: 0, notTaken: 0 }
			this.addresses.set(key, entry)
		}
		return entry
	}

	onInstruction(address: number, _decoded?: unknown, instructionCount = 0) {
		this.replay.watch(instructionCount)
		// Running on from a step back leaves a future that did not happen, and
		// the machine's history drops the oldest instructions as it fills.
		this.branches.dropFrom(instructionCount)
		const oldest = this.replay.oldest
		if (oldest !== undefined) this.branches.dropBefore(oldest)
		this.count(address)
	}

	/** One instruction counted, live or replayed. */
	private count(address: number) {
		const entry = this.entryFor(address)
		entry.count += 1
		this.total += 1
		if (entry.count > this.max) this.max = entry.count
	}

	onBranch(address: number, taken: boolean) {
		// The branch resolves at the address of the instruction just counted.
		this.branches.record(this.replay.at - 1, taken)
		this.resolve(address, taken)
	}

	/** One branch outcome counted, live or replayed. */
	private resolve(address: number, taken: boolean) {
		const entry = this.entryFor(address)
		if (taken) entry.taken += 1
		else entry.notTaken += 1
	}

	/** Everything worked out from the instructions, which a replay redoes. */
	clear() {
		this.addresses.clear()
		this.total = 0
		this.max = 0
	}

	reset() {
		this.clear()
		this.branches.clear()
		this.replay.reset()
	}

	onReset() {
		this.reset()
	}

	snapshot(): ProfileSnapshot {
		this.replay.settle()
		const byAddress = new Map<number, AddressProfile>()
		for (const [address, entry] of this.addresses) byAddress.set(address, { ...entry })
		return { byAddress, total: this.total, max: this.max }
	}
}
