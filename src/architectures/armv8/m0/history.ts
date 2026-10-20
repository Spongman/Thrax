import { HistoryBufferLayout } from '../../../core/historyBuffers'
import { HistoryLog } from '../../../core/historyLog'
import type { CallFrame, HistoryRecord, MachineHistory } from '../../contracts'

/** The architecture declares all additional storage; shared log handles blocks and limits. */
export const HISTORY_SCHEMA = {
	entry: [
		{ name: 'pc', type: 'u32', elements: 1 },
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
	private nextId = 0
	constructor(limit: number) {
		this.log.limit = limit
	}
	get length() {
		return this.log.length
	}
	begin(state: SavedState, word: number, edit = false) {
		const slot = this.log.openEntryWith(this.nextId++),
			c = this.log.entries.tail!.buffers.columns
		c.pc[slot] = state.pc
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
		if (index < 0 || index >= this.length) return undefined
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
	instructionCountAt(index: number) {
		return this.at(index)?.instructionCount ?? 0
	}
	slice(from: number, to: number) {
		return Array.from({ length: Math.max(0, Math.min(to, this.length) - Math.max(0, from)) }, (_, i) =>
			this.at(Math.max(0, from) + i)!,
		)
	}
	indexOfId(id: number) {
		return this.log.indexOfId(id)
	}
	undo(restore: (state: SavedState) => void, write: (address: number, value: number) => void): boolean {
		if (!this.length) return false
		const index = this.length - 1,
			pos = this.log.first + index,
			c = this.log.entries.block(pos).buffers.columns,
			slot = pos % this.log.entries.capacity
		for (
			let p = this.log.effectStart(index) + this.log.effectCount(index) - 1;
			p >= this.log.effectStart(index);
			p--
		) {
			const e = this.log.effects.block(p).buffers.columns,
				s = p % this.log.effects.capacity
			write(e.address[s], e.value[s])
		}
		restore({
			pc: c.pc[slot],
			count: c.count[slot],
			registers: c.registers.subarray(slot * 22, slot * 22 + 22) as Int32Array,
			halted: !!c.halted[slot],
			outputLength: c.outputLength[slot],
			pending: !!c.pending[slot],
			frameAction: c.frameAction[slot],
			frame:
				c.frameAction[slot] === 2
					? {
							callAddress: c.frame[slot * 3],
							returnAddress: c.frame[slot * 3 + 1],
							targetAddress: c.frame[slot * 3 + 2],
						}
					: undefined,
		})
		this.log.truncate(index)
		return true
	}
}
