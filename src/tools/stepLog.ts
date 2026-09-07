/**
 * A tool's own note of what a step did, kept the way the machine keeps its
 * effects: one small entry per step that concerned it, appended in order and
 * walked linearly.
 *
 * A tool that can work its reading out again from the instructions that ran
 * needs no log at all.  What it cannot work out is anything the machine
 * decided and did not write down: whether a branch was taken, which address a
 * load reached.  That is what this holds, and only that, so a step costs one
 * number and one value rather than a copy of everything the tool knows.
 *
 * It is filled only while the tool is watching.  A tool nobody has opened is
 * not in the observer list, so nothing reaches it and nothing is recorded: the
 * machine carries no cost for a tool that is not in use.
 */
export class StepLog<T> {
	/** The instruction count each record belongs to, in order. */
	private counts: number[] = []
	private values: T[] = []

	get length() {
		return this.counts.length
	}

	/**
	 * Keeps `value` against the instruction at `at`.  One instruction may note
	 * more than one thing, so this only ever appends: what a run that is no
	 * longer happening left behind is dropped by the tool as it takes the
	 * instruction on, which is the point it knows the run has diverged.
	 */
	record(at: number, value: T) {
		this.counts.push(at)
		this.values.push(value)
	}

	/** Gives up records for instructions that have not now run. */
	dropFrom(at: number) {
		let end = this.counts.length
		while (end > 0 && this.counts[end - 1] >= at) end--
		if (end === this.counts.length) return
		this.counts.length = end
		this.values.length = end
	}

	/** Gives up records the machine's own history no longer covers. */
	dropBefore(at: number) {
		const start = this.indexFrom(at)
		if (start === 0) return
		this.counts.splice(0, start)
		this.values.splice(0, start)
	}

	/** Where the first record at or after `at` sits; the log is in order. */
	indexFrom(at: number): number {
		let low = 0
		let high = this.counts.length
		while (low < high) {
			const middle = (low + high) >> 1
			if (this.counts[middle] < at) low = middle + 1
			else high = middle
		}
		return low
	}

	countAt(index: number): number | undefined {
		return this.counts[index]
	}

	valueAt(index: number): T | undefined {
		return this.values[index]
	}

	clear() {
		this.counts = []
		this.values = []
	}
}
