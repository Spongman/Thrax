import type { HistoryBufferLayout } from './historyBuffers'
import { HistoryCursor } from './historyCursor'
import { HistoryLog } from './historyLog'

/** Shared storage and navigation; a codec supplies only the state exchange. */
export abstract class ReversibleHistory {
	protected readonly log: HistoryLog
	readonly timeline: HistoryCursor

	constructor(layout: HistoryBufferLayout, limit: number) {
		this.log = new HistoryLog(layout)
		this.log.limit = limit
		this.timeline = new HistoryCursor(this.log)
	}

	get length(): number { return this.log.length }
	get firstId(): number { return this.log.first }
	get retention() { return this.log.retention }

	stepBack(): boolean { return this.timeline.back(this.exchange) }
	stepForward(): boolean { return this.timeline.forward(this.exchange) }

	/** Entry `index` becomes the next to run; later entries remain replayable. */
	rewindTo(index: number) { this.timeline.rewindTo(index, this.exchange) }

	clear() {
		this.timeline.reset()
		this.log.clear()
	}

	protected abstract exchange(index: number, forward: boolean): void

	protected column(index: number, column: number): number {
		if (!(index >= 0 && index < this.log.length)) throw new RangeError(`No history entry ${index}`)
		const position = this.log.first + index
		return this.log.entries.block(position).arrays[column][position % this.log.entries.capacity]
	}

	protected effect(position: number, column: number): number {
		return this.log.effects.block(position).arrays[column][position % this.log.effects.capacity]
	}
}
