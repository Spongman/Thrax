import { HistoryBufferLayout } from '../../core/historyBuffers'
import { HistoryLog } from '../../core/historyLog'
import type { CallFrame, HistoryRecord, MachineHistory } from '../contracts'
import type { Decoded } from './decode'

export const HISTORY_SCHEMA = {
	entry: [
		{ name: 'pc', type: 'u32', elements: 1 },
		{ name: 'count', type: 'f64', elements: 1 },
		{ name: 'registers', type: 'i32', elements: 16 },
		{ name: 'sr', type: 'u16', elements: 1 },
		{ name: 'words', type: 'u16', elements: 6 },
		{ name: 'length', type: 'u8', elements: 1 },
		{ name: 'edit', type: 'u8', elements: 1 },
		{ name: 'halted', type: 'u8', elements: 1 },
		{ name: 'pending', type: 'u8', elements: 1 },
		{ name: 'outputLength', type: 'u32', elements: 1 },
		{ name: 'frameAction', type: 'u8', elements: 1 },
		{ name: 'frame', type: 'u32', elements: 3 }
	],
	effect: [
		{ name: 'address', type: 'u32', elements: 1 },
		{ name: 'value', type: 'u8', elements: 1 }
	]
} as const
export interface M68kRecord extends HistoryRecord {
	words: number[]
	length: number
}
export interface SavedState {
	pc: number
	count: number
	registers: Int32Array
	sr: number
	halted: boolean
	pending: boolean
	outputLength: number
	frameAction?: number
	frame?: CallFrame
}
export class M68kHistory implements MachineHistory {
	readonly log = new HistoryLog(new HistoryBufferLayout(HISTORY_SCHEMA))
	private nextId = 0
	constructor(limit: number) {
		this.log.limit = limit
	}
	get length() {
		return this.log.length
	}
	begin(state: SavedState, instruction?: Decoded) {
		const slot = this.log.openEntryWith(this.nextId++),
			c = this.log.entries.tail!.buffers.columns
		c.pc[slot] = state.pc
		c.count[slot] = state.count
		c.sr[slot] = state.sr
		c.registers.set(state.registers, slot * 16)
		c.words.fill(0, slot * 6, slot * 6 + 6)
		if (instruction) c.words.set(instruction.words, slot * 6)
		c.length[slot] = instruction?.length ?? 0
		c.edit[slot] = instruction ? 0 : 1
		c.halted[slot] = +state.halted
		c.pending[slot] = +state.pending
		c.outputLength[slot] = state.outputLength
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
	memory(address: number, value: number) {
		const slot = this.log.pushEffect()
		if (slot < 0) return
		const c = this.log.effects.tail!.buffers.columns
		c.address[slot] = address
		c.value[slot] = value
	}
	at(index: number): M68kRecord | undefined {
		if (index < 0 || index >= this.length) return undefined
		const pos = this.log.first + index,
			slot = pos % this.log.entries.capacity,
			c = this.log.entries.block(pos).buffers.columns
		return {
			id: this.log.id(index),
			instructionCount: c.count[slot],
			address: c.pc[slot],
			kind: c.edit[slot] ? 'edit' : 'instruction',
			words: Array.from(c.words.subarray(slot * 6, slot * 6 + c.length[slot] / 2)),
			length: c.length[slot]
		}
	}
	instructionCountAt(index: number) {
		const pos = this.log.first + index
		return this.log.entries.block(pos).buffers.columns.count[pos % this.log.entries.capacity]
	}
	slice(from: number, to: number) {
		const entries: M68kRecord[] = []
		for (let i = Math.max(0, from); i < Math.min(to, this.length); i++) entries.push(this.at(i)!)
		return entries
	}
	indexOfId(id: number) {
		return this.log.indexOfId(id)
	}
	undo(restore: (state: SavedState) => void, write: (address: number, value: number) => void) {
		if (!this.length) return false
		const index = this.length - 1,
			pos = this.log.first + index,
			slot = pos % this.log.entries.capacity,
			c = this.log.entries.block(pos).buffers.columns
		for (let p = this.log.effectStart(index) + this.log.effectCount(index) - 1; p >= this.log.effectStart(index); p--) {
			const e = this.log.effects.block(p).buffers.columns,
				s = p % this.log.effects.capacity
			write(e.address[s], e.value[s])
		}
		restore({
			pc: c.pc[slot],
			count: c.count[slot],
			sr: c.sr[slot],
			registers: c.registers.subarray(slot * 16, slot * 16 + 16) as Int32Array,
			halted: !!c.halted[slot],
			pending: !!c.pending[slot],
			outputLength: c.outputLength[slot],
			frameAction: c.frameAction[slot],
			frame:
				c.frameAction[slot] === 2
					? {
							callAddress: c.frame[slot * 3],
							returnAddress: c.frame[slot * 3 + 1],
							targetAddress: c.frame[slot * 3 + 2]
						}
					: undefined
		})
		this.log.truncate(index)
		return true
	}
}
