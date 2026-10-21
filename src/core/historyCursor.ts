import type { HistoryLog } from './historyLog'
import type { CallFrame, MachineHistory } from '../architectures/contracts'

/** Navigation keeps the recorded future; only an edit or new execution branches. */
export class HistoryCursor {
	private position: number | null = null

	constructor(private readonly log: HistoryLog) {}

	get index(): number { return (this.position ?? this.log.end) - this.log.first }
	get ahead(): boolean { return this.position !== null && this.position < this.log.end }

	back(exchange: (index: number, forward: boolean) => void): boolean {
		if (this.index <= 0) return false
		const position = (this.position ?? this.log.end) - 1
		exchange(position - this.log.first, false)
		this.position = position
		return true
	}

	forward(exchange: (index: number, forward: boolean) => void): boolean {
		if (!this.ahead) return false
		const position = this.position!
		exchange(position - this.log.first, true)
		this.position = position + 1 === this.log.end ? null : position + 1
		return true
	}

	rewindTo(index: number, exchange: (index: number, forward: boolean) => void) {
		if (!Number.isInteger(index) || index < 0 || index > this.log.length) throw new RangeError(`No history entry ${index}`)
		while (this.index > index) this.back(exchange)
	}

	/** Called before recording a change, never merely when moving through history. */
	branch(): boolean {
		if (this.position === null) return false
		this.log.truncate(this.index)
		this.position = null
		return true
	}

	reset() { this.position = null }
}

/** Exchange explicitly named state columns with the live values, without copying snapshots. */
export function exchangeHistoryValues(log: HistoryLog, index: number, values: Record<string, number | Int32Array>) {
	const position = log.first + index, slot = position % log.entries.capacity
	const columns = log.entries.block(position).buffers.columns
	for (const [name, value] of Object.entries(values)) {
		const column = columns[name]
		if (typeof value === 'number') {
			values[name] = column[slot]
			column[slot] = value
		} else {
			for (let i = 0; i < value.length; i++) {
				const held = value[i]
				value[i] = column[slot * value.length + i]
				column[slot * value.length + i] = held
			}
		}
	}
}

/** Byte effects exchange in execution order when replaying and inverse order when undoing. */
export function exchangeHistoryBytes(log: HistoryLog, index: number, forward: boolean, write: (address: number, value: number) => number) {
	const start = log.effectStart(index), count = log.effectCount(index)
	for (let offset = 0; offset < count; offset++) {
		const p = start + (forward ? offset : count - offset - 1)
		const c = log.effects.block(p).buffers.columns, slot = p % log.effects.capacity
		c.value[slot] = write(c.address[slot], c.value[slot])
	}
}

/** The common call/return inverse delta, stored in the architecture's declared columns. */
export function exchangeHistoryFrame(log: HistoryLog, index: number, frames: CallFrame[]) {
	const position = log.first + index, slot = position % log.entries.capacity
	const c = log.entries.block(position).buffers.columns
	if (c.frameAction[slot] === 1) {
		const frame = frames.pop()!
		c.frame.set([frame.callAddress, frame.returnAddress, frame.targetAddress], slot * 3)
		c.frameAction[slot] = 2
	} else if (c.frameAction[slot] === 2) {
		frames.push({ callAddress: c.frame[slot * 3], returnAddress: c.frame[slot * 3 + 1], targetAddress: c.frame[slot * 3 + 2] })
		c.frameAction[slot] = 1
	}
}

/** Append-only output retains its hidden suffix while the cursor is behind it. */
export class HistoryText {
	text = ''
	exchange(current: string, length: number): string {
		if (current.length >= length) this.text = current + this.text.slice(current.length)
		return this.text.slice(0, length)
	}
}

export function exchangeHistoryArray(stored: Uint32Array | Float64Array, offset: number, live: Uint32Array | Float64Array) {
	for (let i = 0; i < live.length; i++) {
		const value = live[i]
		live[i] = stored[offset + i]
		stored[offset + i] = value
	}
}

/** The neighbouring snapshot toward the cursor, or the live state at the boundary. */
export function historyNeighbour(log: HistoryLog, cursor: number, index: number) {
	const ahead = index >= cursor, neighbour = ahead ? index - 1 : index + 1
	if (ahead ? index === cursor : neighbour === cursor) return null
	const position = log.first + neighbour
	return { columns: log.entries.block(position).buffers.columns, slot: position % log.entries.capacity }
}

/** Shared row selection: only rows behind the cursor move it; later rows survive. */
export function rewindHistoryTo(
	history: MachineHistory,
	cursor: () => number,
	id: number,
	undo: () => boolean,
	after: () => void,
): boolean {
	const target = history.indexOfId(id)
	if (target < 0 || target >= cursor()) return false
	while (cursor() > target) if (!undo()) return false
	after()
	return true
}
