/**
 * Rolling a tool back and forward with the machine, by running the instructions
 * through it again.
 *
 * The machine keeps no copy of itself per step: it writes down what an
 * instruction changed and exchanges those values to go back.  A tool's reading
 * cannot be exchanged that way, because a count and a replacement order do not
 * say what they were before.  What a tool's reading is, though, is a function
 * of the instructions that ran, and the machine already holds those.  So a tool
 * keeps no state of its own per step either: it clears what it worked out and
 * works it out again as far as the machine has moved to.
 *
 * What a replay cannot recover is anything the machine decided and did not
 * write down: which way a branch went, which address a load reached.  A tool
 * that needs those notes them in a StepLog as it watches, one small entry per
 * step, and only while it is watching.
 *
 * Going back means starting again from the first instruction the tool saw,
 * since an accumulation cannot be undone in place.  That is linear in the run
 * so far, and the reason it is affordable is that it happens when something
 * asks for the reading rather than on every step of the way: a key held down
 * on step-back seeks hundreds of times and replays once.
 */

import type { Decoded } from '../core/decoder'
import type { InstructionHistory, MachineConfig } from '../core/observer'
import { decode } from '../core/decoder'

export interface Replayable {
	/** Everything worked out from the instructions, which a replay redoes. */
	clear(): void
	/** One instruction again, with whatever the tool noted about it at the time. */
	replayStep(address: number, decoded: Decoded, instructionCount: number): void
}

export class Replay {
	private history: InstructionHistory | null = null
	/** Where the machine has moved to, until something asks for the reading. */
	private pending: number | null = null
	/** The instruction count the reading stands before. */
	private position = 0
	/** The first instruction the tool saw, which is as far back as it can go. */
	private first = -1

	constructor(private readonly tool: Replayable) {}

	/** The machine's own log, which is what there is to replay. */
	configure(machine: MachineConfig) {
		this.history = machine.history ?? null
	}

	get at() {
		return this.position
	}

	/** The oldest instruction still held, past which nothing can be rebuilt. */
	get oldest(): number | undefined {
		return this.history?.at(0)?.instructionCount
	}

	/** A new run: what was worked out and what was watched both go. */
	reset() {
		this.pending = null
		this.position = 0
		this.first = -1
	}

	seek(to: number) {
		this.pending = to
	}

	/** Before the tool folds in the instruction at `count`. */
	watch(count: number) {
		this.settle()
		if (this.first < 0) this.first = count
		this.position = count + 1
	}

	/** Rebuilds the reading where the machine now stands, if it has moved. */
	settle() {
		const to = this.pending
		if (to === null) return
		this.pending = null
		if (to === this.position) return
		if (to < this.position) this.rewind()
		this.replayTo(to)
	}

	/**
	 * Works the reading out again from the same instructions, for a tool whose
	 * model has changed under it rather than whose run has moved.
	 */
	rework() {
		this.settle()
		const to = this.position
		this.rewind()
		this.replayTo(to)
	}

	private rewind() {
		this.tool.clear()
		this.position = Math.max(0, this.first)
	}

	private replayTo(to: number) {
		const history = this.history
		if (!history) {
			// Nothing to replay from, so the reading can only be what it has.
			this.position = to
			return
		}
		for (let index = this.indexOf(this.position); index < history.length; index++) {
			const entry = history.at(index)
			if (!entry || entry.instructionCount >= to) break
			if (entry.kind !== 'instruction' || entry.word === null) continue
			const decoded = decode(entry.word)
			if (!decoded) continue
			this.tool.replayStep(entry.address, decoded, entry.instructionCount)
		}
		this.position = to
	}

	/** Where the instruction at `count` sits in the history, which is in order. */
	private indexOf(count: number): number {
		const history = this.history
		if (!history) return 0
		let low = 0
		let high = history.length
		while (low < high) {
			const middle = (low + high) >> 1
			if ((history.at(middle)?.instructionCount ?? 0) < count) low = middle + 1
			else high = middle
		}
		return low
	}
}
