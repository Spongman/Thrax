/**
 * AArch32 execution history: one entry per state-changing step, each owning a
 * run of effects that hold the values the step replaced, in the shared
 * HistoryLog. A step that changes nothing (a read still waiting, a fault)
 * records no entry; rewinding to entry `index` leaves the machine about to
 * run that entry's instruction again.
 */

import { HistoryBufferLayout, type HistoryBufferSchema } from '../../../core/historyBuffers'
import { HistoryLog } from '../../../core/historyLog'
import type { A64Keyboard } from '../a64/machine'
import type { A32CallStack, A32CallStackSink } from './callStack'
import { FAULT_NONE, type A32Cpu, type A32EffectSink } from './cpu'
import type { A32Linux } from './machine'

const column = (name: string, type: 'u8' | 'u32' | 'f64') => Object.freeze({ name, type, elements: 1 })

/** Entry: the instruction's address and word, its kind and the count before it. Effect: a kind, a size and two values. */
export const a32HistorySchema: HistoryBufferSchema = Object.freeze({
	entry: Object.freeze([column('pc', 'u32'), column('word', 'u32'), column('kind', 'u8'), column('count', 'f64')]),
	effect: Object.freeze([column('kind', 'u8'), column('size', 'u8'), column('a', 'f64'), column('b', 'f64')]),
})

/** Effect kinds; `b` is always the old value. `a` is the register index. */
export const EFFECT_REGISTER = 0
export const EFFECT_PC = 1
export const EFFECT_CPSR = 2
/** `a` is the address, `size` the bytes. */
export const EFFECT_MEMORY = 3
/** The exclusive monitor's address, -1 when open. */
export const EFFECT_MONITOR = 4
/** Console output length. */
export const EFFECT_OUTPUT = 5
/** Console input position. */
export const EFFECT_INPUT = 6
export const EFFECT_WAITING = 7
export const EFFECT_HALTED = 8
/** The exit status, or -1 before exit. */
export const EFFECT_EXIT = 9
/** The program break. */
export const EFFECT_BREAK = 10
/** `a` is the index of a call-stack frame word. */
export const EFFECT_FRAME_WORD = 11
export const EFFECT_FRAME_DEPTH = 12
/** Keyboard characters consumed. */
export const EFFECT_KEY = 13
/** Display output length. */
export const EFFECT_DISPLAY = 14

export const ENTRY_INSTRUCTION = 0
export const ENTRY_EDIT = 1

/** What the history records and restores; A32Machine is one. */
export interface A32HistoryTarget {
	readonly cpu: A32Cpu
	readonly linux: A32Linux
	readonly keyboard: A64Keyboard
	readonly callStack: A32CallStack
	halted: boolean
	instructionCount: number
}

const layout = new HistoryBufferLayout(a32HistorySchema)
const PC = layout.column('entry', 'pc', 'u32')
const WORD = layout.column('entry', 'word', 'u32')
const KIND = layout.column('entry', 'kind', 'u8')
const COUNT = layout.column('entry', 'count', 'f64')
const EFFECT_KIND = layout.column('effect', 'kind', 'u8')
const EFFECT_SIZE = layout.column('effect', 'size', 'u8')
const EFFECT_A = layout.column('effect', 'a', 'f64')
const EFFECT_B = layout.column('effect', 'b', 'f64')

export class A32History implements A32EffectSink, A32CallStackSink {
	private readonly log = new HistoryLog(layout)
	// The open entry's starting state.
	private start = 0
	private pcBefore = 0
	private outputLength = 0
	private inputIndex = 0
	private waiting = false
	private halted = false
	private exitCode = -1
	private programBreak = 0
	private keyIndex = 0
	private displayLength = 0
	private kind = ENTRY_INSTRUCTION
	private instructionCount = 0

	constructor(private readonly target: A32HistoryTarget, limit: number) {
		this.log.limit = limit
	}

	get length(): number {
		return this.log.length
	}

	/** Id of the oldest entry held; ids count entries since the program loaded. */
	get firstId(): number {
		return this.log.first
	}

	/** Opens an entry; call before the CPU steps, or before an edit with ENTRY_EDIT. */
	begin(kind = ENTRY_INSTRUCTION) {
		const { cpu, linux, keyboard } = this.target
		this.kind = kind
		this.instructionCount = this.target.instructionCount
		this.log.openEntryWith(this.log.end)
		this.start = this.log.openEffectStart
		this.pcBefore = cpu.pc
		this.outputLength = linux.output.length
		this.inputIndex = linux.inputIndex
		this.waiting = linux.waiting
		this.exitCode = linux.exitCode
		this.programBreak = linux.programBreak
		this.keyIndex = keyboard.keyIndex
		this.displayLength = keyboard.display.length
		this.halted = this.target.halted
	}

	/** Closes the entry; returns whether the step changed anything and so was kept. */
	end(): boolean {
		const { cpu, linux, keyboard } = this.target
		if (linux.output.length !== this.outputLength) this.push(EFFECT_OUTPUT, 0, 0, this.outputLength)
		if (linux.inputIndex !== this.inputIndex) this.push(EFFECT_INPUT, 0, 0, this.inputIndex)
		if (linux.waiting !== this.waiting) this.push(EFFECT_WAITING, 0, 0, this.waiting ? 1 : 0)
		if (linux.exitCode !== this.exitCode) this.push(EFFECT_EXIT, 0, 0, this.exitCode)
		if (linux.programBreak !== this.programBreak) this.push(EFFECT_BREAK, 0, 0, this.programBreak)
		if (keyboard.keyIndex !== this.keyIndex) this.push(EFFECT_KEY, 0, 0, this.keyIndex)
		if (keyboard.display.length !== this.displayLength) this.push(EFFECT_DISPLAY, 0, 0, this.displayLength)
		if (this.target.halted !== this.halted) this.push(EFFECT_HALTED, 0, 0, this.halted ? 1 : 0)
		const log = this.log
		const position = log.openEntry
		if (position < 0) return false
		if (log.effects.end === this.start) {
			log.discard()
			return false
		}
		const columns = log.entries.block(position).arrays
		const slot = position % log.entries.capacity
		columns[PC][slot] = this.pcBefore
		columns[WORD][slot] = this.kind === ENTRY_EDIT ? 0 : cpu.instruction >>> 0
		columns[KIND][slot] = this.kind
		columns[COUNT][slot] = this.instructionCount
		log.close()
		return true
	}

	register(index: number, old: number) {
		this.push(EFFECT_REGISTER, 0, index, old)
	}

	pc(old: number) {
		this.push(EFFECT_PC, 0, 0, old)
	}

	cpsr(old: number) {
		this.push(EFFECT_CPSR, 0, 0, old)
	}

	memory(address: number, size: number, old: number) {
		this.push(EFFECT_MEMORY, size, address, old)
	}

	monitor(old: number) {
		this.push(EFFECT_MONITOR, 0, 0, old)
	}

	frameWord(index: number, old: number) {
		this.push(EFFECT_FRAME_WORD, 0, index, old)
	}

	depth(old: number) {
		this.push(EFFECT_FRAME_DEPTH, 0, 0, old)
	}

	idAt(index: number): number {
		return this.log.id(index)
	}

	pcAt(index: number): number {
		return this.column(index, PC)
	}

	wordAt(index: number): number {
		return this.column(index, WORD)
	}

	kindAt(index: number): number {
		return this.column(index, KIND)
	}

	countAt(index: number): number {
		return this.column(index, COUNT)
	}

	effectStartAt(index: number): number {
		return this.log.effectStart(index)
	}

	effectCountAt(index: number): number {
		return this.log.effectCount(index)
	}

	effectKind(position: number): number {
		return this.effect(position, EFFECT_KIND)
	}

	effectSize(position: number): number {
		return this.effect(position, EFFECT_SIZE)
	}

	effectA(position: number): number {
		return this.effect(position, EFFECT_A)
	}

	effectB(position: number): number {
		return this.effect(position, EFFECT_B)
	}

	stepBack(): boolean {
		if (this.log.length === 0) return false
		this.rewindTo(this.log.length - 1)
		return true
	}

	/** Undoes entry `index` and every later one, then forgets them. */
	rewindTo(index: number) {
		const log = this.log
		if (!Number.isInteger(index) || index < 0 || index > log.length) throw new RangeError(`No history entry ${index}`)
		if (index === log.length) return
		const { cpu, linux, keyboard, callStack } = this.target
		const stop = this.effectStartAt(index)
		const count = this.countAt(index)
		for (let position = log.effects.end - 1; position >= stop; position--) {
			const a = this.effect(position, EFFECT_A)
			const b = this.effect(position, EFFECT_B)
			switch (this.effect(position, EFFECT_KIND)) {
				case EFFECT_REGISTER: cpu.r[a] = b; break
				case EFFECT_PC: cpu.pc = b; break
				case EFFECT_CPSR: cpu.cpsr = b; break
				case EFFECT_MEMORY: cpu.restore(a, this.effect(position, EFFECT_SIZE), b); break
				case EFFECT_MONITOR: cpu.exclusive = b; break
				case EFFECT_OUTPUT: linux.output = linux.output.slice(0, b); break
				case EFFECT_INPUT: linux.inputIndex = b; break
				case EFFECT_WAITING: linux.waiting = b !== 0; break
				case EFFECT_HALTED: this.target.halted = b !== 0; break
				case EFFECT_EXIT: linux.exitCode = b; break
				case EFFECT_BREAK: linux.programBreak = b; break
				case EFFECT_FRAME_WORD: callStack.setFrameWord(a, b); break
				case EFFECT_FRAME_DEPTH: callStack.setDepth(b); break
				case EFFECT_KEY: keyboard.keyIndex = b; break
				case EFFECT_DISPLAY: keyboard.display = keyboard.display.slice(0, b); break
			}
		}
		cpu.fault = FAULT_NONE
		cpu.faultAddress = 0
		cpu.faultDetail = ''
		this.target.instructionCount = count
		log.truncate(index)
	}

	clear() {
		this.log.clear()
	}

	private push(kind: number, size: number, a: number, b: number) {
		const slot = this.log.pushEffect()
		if (slot < 0) return
		const columns = this.log.effects.tail!.arrays
		columns[EFFECT_KIND][slot] = kind
		columns[EFFECT_SIZE][slot] = size
		columns[EFFECT_A][slot] = a
		columns[EFFECT_B][slot] = b
	}

	private column(index: number, column: number): number {
		if (!(index >= 0 && index < this.log.length)) throw new RangeError(`No history entry ${index}`)
		const position = this.log.first + index
		return this.log.entries.block(position).arrays[column][position % this.log.entries.capacity]
	}

	private effect(position: number, column: number): number {
		return this.log.effects.block(position).arrays[column][position % this.log.effects.capacity]
	}
}
