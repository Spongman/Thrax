import type { DescribedEffect, HistoryRecord, HistoryRetention, MachineHistory } from '../architectures/contracts'
import { formatRegister } from './format'
import type { HistoryLog } from './historyLog'
import { historyNeighbour } from './historyCursor'
import type { HistoryBuffer } from './historyBuffers'

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

/** Display-only comparisons over native columns; recording and replay never use this. */
class SnapshotEffects {
	readonly effects: DescribedEffect[] = []
	private readonly row
	private readonly next
	private readonly slot

	constructor(private readonly log: HistoryLog, cursor: number, readonly index: number, private readonly applied: boolean, private readonly bits: number) {
		const position = log.first + index
		this.row = log.entries.block(position)
		this.slot = position % log.entries.capacity
		this.next = historyNeighbour(log, cursor, index)
	}

	private column(column: string | number, next = false): HistoryBuffer | undefined {
		if (next) return typeof column === 'number' ? this.next?.arrays[column] : this.next?.columns[column]
		return typeof column === 'number' ? this.row.arrays[column] : this.row.buffers.columns[column]
	}

	before(column: string | number, element = 0, stride = 1): number {
		return this.column(column)![this.slot * stride + element]
	}

	after(column: string | number, live: number, element = 0, stride = 1): number {
		return this.column(column, true)?.[(this.next?.slot ?? 0) * stride + element] ?? live
	}

	add(parts: EffectParts) { this.effects.push(describeValueEffect(this.applied, parts, this.bits)) }

	registers(column: string | number, stride: number, first: number, count: number, live: (index: number) => number, describe: (index: number, value: number) => EffectParts) {
		const before = this.column(column)!, after = this.column(column, true)
		const base = this.slot * stride, nextBase = (this.next?.slot ?? 0) * stride
		for (let index = first; index < first + count; index++) {
			const value = before[base + index]
			if (value !== (after ? after[nextBase + index] : live(index))) this.add(describe(index, value))
		}
	}

	memory(addressColumn: string | number, valueColumn: string | number, subject: (address: number) => string = address => `[0x${address.toString(16)}]`, include?: (address: number) => boolean) {
		const end = this.log.effectStart(this.index) + this.log.effectCount(this.index)
		for (let position = this.log.effectStart(this.index); position < end; position++) {
			const block = this.log.effects.block(position), slot = position % this.log.effects.capacity
			const addresses = typeof addressColumn === 'number' ? block.arrays[addressColumn] : block.buffers.columns[addressColumn]
			const values = typeof valueColumn === 'number' ? block.arrays[valueColumn] : block.buffers.columns[valueColumn]
			const address = addresses[slot]
			if (include && !include(address)) continue
			this.add({ subject: subject(address), address, value: values[slot] })
		}
	}

	text(column: string, liveLength: number, text: string) {
		const before = this.before(column), after = this.after(column, liveLength)
		if (before !== after) this.add({ subject: 'console', detail: textChange(text, before, after) })
	}

	halted(live: boolean) {
		if (this.before('halted') !== this.after('halted', +live)) this.add({ subject: 'halted' })
	}
}

export function snapshotEffects(log: HistoryLog, cursor: number, id: number, applied: boolean, bits: number, describe: (effects: SnapshotEffects) => void): DescribedEffect[] {
	const index = log.indexOfId(id)
	if (index < 0) return []
	const effects = new SnapshotEffects(log, cursor, index, applied, bits)
	describe(effects)
	return effects.effects
}
