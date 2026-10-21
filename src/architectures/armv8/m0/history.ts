import { historyCount, historySlice } from '../../../core/historyView'
import { HistoryBufferLayout } from '../../../core/historyBuffers'
import { HistoryLog } from '../../../core/historyLog'
import { HistoryCursor, exchangeHistoryValues, exchangeHistoryBytes, exchangeHistoryFrame } from '../../../core/historyCursor'
import type { CallFrame, HistoryRecord, MachineHistory } from '../../contracts'

/** The architecture declares all additional storage; shared log handles blocks and limits. */
export const HISTORY_SCHEMA = {
	entry: [
		{ name: 'pc', type: 'u32', elements: 1 },
		{ name: 'controlPc', type: 'u32', elements: 1 },
		{ name: 'count', type: 'f64', elements: 1 },
		{ name: 'word', type: 'u32', elements: 1 },
		{ name: 'kind', type: 'u8', elements: 1 },
		{ name: 'registers', type: 'i32', elements: 22 },
		{ name: 'halted', type: 'u8', elements: 1 },
		{ name: 'outputLength', type: 'u32', elements: 1 },
		{ name: 'pending', type: 'u8', elements: 1 },
		{ name: 'frameAction', type: 'u8', elements: 1 },
		{ name: 'frame', type: 'u32', elements: 3 },
	],
	effect: [
		{ name: 'address', type: 'u32', elements: 1 },
		{ name: 'value', type: 'u8', elements: 1 },
		{ name: 'next', type: 'u8', elements: 1 },
	],
} as const
export interface M0Record extends HistoryRecord {
	word: number
}
export interface SavedState {
	pc: number
	count: number
	registers: Int32Array
	halted: boolean
	outputLength: number
	frameAction?: number
	frame?: CallFrame
	pending: boolean
}
export class M0History implements MachineHistory {
	readonly log = new HistoryLog(new HistoryBufferLayout(HISTORY_SCHEMA))
	readonly timeline = new HistoryCursor(this.log)
	private nextId = 0
	constructor(limit: number) {
		this.log.limit = limit
	}
	get retention() { return this.log.retention }

	get length() {
		return this.log.length
	}
	begin(state: SavedState, word: number, edit = false) {
		this.timeline.branch()
		const slot = this.log.openEntryWith(this.nextId++),
			c = this.log.entries.tail!.buffers.columns
		c.pc[slot] = state.pc
		c.controlPc[slot] = state.pc
		c.count[slot] = state.count
		c.word[slot] = word
		c.kind[slot] = +edit
		c.halted[slot] = +state.halted
		c.registers.set(state.registers, slot * 22)
		c.outputLength[slot] = state.outputLength
		c.pending[slot] = +state.pending
		c.frameAction[slot] = 0
	}
	frame(push: boolean, popped?: CallFrame) {
		if (this.log.openEntry < 0) return
		const slot = this.log.openEntry % this.log.entries.capacity,
			c = this.log.entries.tail!.buffers.columns
		c.frameAction[slot] = push ? 1 : 2
		if (popped) {
			c.frame[slot * 3] = popped.callAddress
			c.frame[slot * 3 + 1] = popped.returnAddress
			c.frame[slot * 3 + 2] = popped.targetAddress
		}
	}
	memory(address: number, value: number, next: number) {
		const slot = this.log.pushEffect()
		if (slot < 0) return
		const c = this.log.effects.tail!.buffers.columns
		c.address[slot] = address
		c.value[slot] = value
		c.next[slot] = next
	}
	close() {
		this.log.close()
	}
	at(index: number): M0Record | undefined {
		if (!Number.isInteger(index) || index < 0 || index >= this.length) return undefined
		const pos = this.log.first + index,
			c = this.log.entries.block(pos).buffers.columns,
			slot = pos % this.log.entries.capacity
		return {
			id: this.log.id(index),
			instructionCount: c.count[slot],
			address: c.pc[slot],
			word: c.word[slot],
			kind: c.kind[slot] ? 'edit' : 'instruction',
		}
	}
	instructionCountAt(index: number) { return historyCount(this.log, index, 'count') }
	slice(from: number, to: number) { return historySlice(this, from, to) }
	indexOfId(id: number) {
		return this.log.indexOfId(id)
	}
	undo(restore: (state: SavedState) => void, write: (address: number, value: number) => number, state: SavedState, frames: CallFrame[], forward = false): boolean {
		const exchange = (index: number, replay: boolean) => {
			const values = { controlPc: state.pc, registers: state.registers, halted: +state.halted, pending: +state.pending, outputLength: state.outputLength }
			exchangeHistoryBytes(this.log, index, replay, write)
			exchangeHistoryValues(this.log, index, values)
			exchangeHistoryFrame(this.log, index, frames)
			const position = this.log.first + index, slot = position % this.log.entries.capacity
			const c = this.log.entries.block(position).buffers.columns
			restore({
				pc: values.controlPc, registers: state.registers, halted: !!values.halted,
				pending: !!values.pending, outputLength: values.outputLength,
				count: c.count[slot] + (replay && !c.kind[slot] ? 1 : 0),
			})
		}
		return forward ? this.timeline.forward(exchange) : this.timeline.back(exchange)
	}
}
