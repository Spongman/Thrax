import { historyCount, historySlice } from '../../core/historyView'
import { HistoryBufferLayout } from '../../core/historyBuffers'
import { HistoryLog } from '../../core/historyLog'
import { HistoryCursor, exchangeHistoryValues, exchangeHistoryBytes, exchangeHistoryFrame } from '../../core/historyCursor'
import type { CallFrame, HistoryRecord, MachineHistory } from '../contracts'
import type { Decoded } from './decode'
import { FP_WORDS } from './fpuIsa'

const FPU_COLUMN = { name: 'fp', type: 'i32', elements: FP_WORDS } as const
export const HISTORY_SCHEMA = {
	entry: [
		{ name: 'pc', type: 'u32', elements: 1 },
		{ name: 'controlPc', type: 'u32', elements: 1 },
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
	fp?: Int32Array
	sr: number
	halted: boolean
	pending: boolean
	outputLength: number
	frameAction?: number
	frame?: CallFrame
}
export class M68kHistory implements MachineHistory {
	readonly log: HistoryLog
	readonly timeline: HistoryCursor
	private nextId = 0
	/** With a coprocessor each entry also keeps the whole FPU state. */
	constructor(limit: number, readonly fpu = false) {
		this.log = new HistoryLog(new HistoryBufferLayout(fpu ? { ...HISTORY_SCHEMA, entry: [...HISTORY_SCHEMA.entry, FPU_COLUMN] } : HISTORY_SCHEMA))
		this.timeline = new HistoryCursor(this.log)
		this.log.limit = limit
	}
	get retention() { return this.log.retention }

	get length() {
		return this.log.length
	}
	begin(state: SavedState, instruction?: Decoded) {
		this.timeline.branch()
		const slot = this.log.openEntryWith(this.nextId++),
			c = this.log.entries.tail!.buffers.columns
		c.pc[slot] = state.pc
		c.controlPc[slot] = state.pc
		c.count[slot] = state.count
		c.sr[slot] = state.sr
		c.registers.set(state.registers, slot * 16)
		if (this.fpu) c.fp.set(state.fp!, slot * FP_WORDS)
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
		if (!Number.isInteger(index) || index < 0 || index >= this.length) return undefined
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
	instructionCountAt(index: number) { return historyCount(this.log, index, 'count') }
	slice(from: number, to: number) { return historySlice(this, from, to) }
	indexOfId(id: number) {
		return this.log.indexOfId(id)
	}
	undo(restore: (state: SavedState) => void, write: (address: number, value: number) => number, state: SavedState, frames: CallFrame[], forward = false): boolean {
		const exchange = (index: number, replay: boolean) => {
			const values: Record<string, number | Int32Array> = { controlPc: state.pc, registers: state.registers, halted: +state.halted, pending: +state.pending, outputLength: state.outputLength, sr: state.sr }
			if (this.fpu) values.fp = state.fp!
			exchangeHistoryBytes(this.log, index, replay, write)
			exchangeHistoryValues(this.log, index, values)
			exchangeHistoryFrame(this.log, index, frames)
			const position = this.log.first + index, slot = position % this.log.entries.capacity
			const c = this.log.entries.block(position).buffers.columns
			restore({
				pc: values.controlPc as number, registers: state.registers, fp: state.fp, halted: !!values.halted,
				pending: !!values.pending, outputLength: values.outputLength as number,
				sr: values.sr as number,
				count: c.count[slot] + (replay && !c.edit[slot] ? 1 : 0),
			})
		}
		return forward ? this.timeline.forward(exchange) : this.timeline.back(exchange)
	}
}
