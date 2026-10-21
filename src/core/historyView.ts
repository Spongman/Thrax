import type { DescribedEffect, HistoryRecord, HistoryRetention, MachineHistory } from '../architectures/contracts'
import { formatRegister } from './format'
import type { HistoryLog } from './historyLog'

/** A codec explicitly selects its count column; querying it allocates no record. */
export function historyCount(log: HistoryLog, index: number, column: string | number): number {
	if (!Number.isInteger(index) || index < 0 || index >= log.length) return 0
	const position = log.first + index, block = log.entries.block(position)
	const values = typeof column === 'number' ? block.arrays[column] : block.buffers.columns[column]
	return values[position % log.entries.capacity]
}

/** A view reads columns on demand; it never stores a second collection of rows. */
export interface HistoryColumns {
	readonly retention?: HistoryRetention
	readonly length: number
	readonly firstId: number
	countAt(index: number): number
}

export function historySlice<R extends HistoryRecord>(history: Pick<MachineHistory, 'length'> & { at(index: number): R | undefined }, from: number, to: number): R[] {
	const records: R[] = []
	for (let index = Math.max(0, Math.trunc(from)); index < Math.min(to, history.length); index++) {
		const record = history.at(index)
		if (record) records.push(record)
	}
	return records
}

export abstract class HistoryView<L extends HistoryColumns, R extends HistoryRecord> implements MachineHistory {
	constructor(protected readonly log: L | null) {}
	get length(): number { return this.log?.length ?? 0 }
	get retention() { return this.log?.retention }
	at(index: number): R | undefined {
		return this.log && Number.isInteger(index) && index >= 0 && index < this.length ? this.record(this.log, index) : undefined
	}
	instructionCountAt(index: number): number {
		return this.log && Number.isInteger(index) && index >= 0 && index < this.length ? this.log.countAt(index) : 0
	}
	slice(from: number, to: number): R[] { return historySlice(this, from, to) }
	indexOfId(id: number): number {
		const index = id - (this.log?.firstId ?? 0)
		return this.log && Number.isInteger(index) && index >= 0 && index < this.length ? index : -1
	}
	protected abstract record(log: L, index: number): R
}

export type EffectParts = Omit<DescribedEffect, 'applied' | 'label'>

/** Direction and chip layout are shared; native decoders supply values and widths. */
export function describeEffect(applied: boolean, parts: EffectParts, held = parts.text): DescribedEffect {
	const label = held !== undefined
		? (applied ? `${parts.subject} → ${held}` : `${parts.subject} ${held} →`)
		: parts.detail !== undefined ? `${parts.subject} ${parts.detail}` : parts.subject
	return { ...parts, applied, label }
}

export function describeValueEffect(applied: boolean, parts: EffectParts, bits: number): DescribedEffect {
	return describeEffect(applied, parts, parts.text ?? (parts.value === undefined ? undefined : formatRegister(parts.value, bits)))
}

export const textChange = (text: string, from: number, to: number) => JSON.stringify(text.slice(Math.min(from, to), Math.max(from, to)))
