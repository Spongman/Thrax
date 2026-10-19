/**
 * ARM26 execution history: one entry per state-changing step, each owning a
 * run of effects that hold the values the step replaced, in the shared
 * HistoryLog.  A step that changes nothing (an OS_ReadC still waiting, a
 * fault) records no entry.  Rewinding to entry `index` undoes it and every
 * later one, leaving the machine about to run that entry's instruction again.
 */

import { HistoryBufferLayout, type HistoryBufferSchema } from '../../core/historyBuffers'
import { HistoryLog } from '../../core/historyLog'
import type { Arm26CallStack, Arm26CallStackSink } from './callStack'
import { FAULT_NONE, type Arm26Cpu, type Arm26EffectSink } from './cpu'
import type { Arm26Keyboard } from './keyboard'
import type { Arm26Os } from './os'

const column = (name: string, type: 'u8' | 'i32' | 'u32' | 'f64') => Object.freeze({ name, type, elements: 1 })

/** Entry: the instruction's address and word (the vector, for an interrupt), its kind and the count before it. */
export const arm26HistorySchema: HistoryBufferSchema = Object.freeze({
	entry: Object.freeze([column('pc', 'u32'), column('word', 'i32'), column('kind', 'u8'), column('count', 'f64')]),
	effect: Object.freeze([column('kind', 'u8'), column('a', 'i32'), column('b', 'i32')]),
})

/** Effect kinds; `b` is always the old value. `a` is the physical register. */
export const EFFECT_REGISTER = 0
/** `a` is the word address. */
export const EFFECT_MEMORY = 1
export const EFFECT_PC = 2
export const EFFECT_PSR = 3
/** Console output length; `a` is the length after. */
export const EFFECT_OUTPUT = 4
/** Console input position. */
export const EFFECT_INPUT = 5
export const EFFECT_WAITING = 6
export const EFFECT_HALTED = 7
/** `a` is the index of a call-stack frame word. */
export const EFFECT_FRAME_WORD = 8
export const EFFECT_FRAME_DEPTH = 9
/** Keyboard input position. */
export const EFFECT_KEY = 10
/** Display output length; `a` is the length after. */
export const EFFECT_DISPLAY = 11
export const EFFECT_KEY_INTERRUPT = 12

export const ENTRY_INSTRUCTION = 0
export const ENTRY_EDIT = 1
export const ENTRY_INTERRUPT = 2

export interface Arm26HistoryTarget {
	readonly cpu: Arm26Cpu
	readonly os: Arm26Os
	readonly keyboard: Arm26Keyboard
	readonly callStack: Arm26CallStack
	halted: boolean
	instructionCount: number
}

const layout = new HistoryBufferLayout(arm26HistorySchema)
const PC = layout.column('entry', 'pc', 'u32')
const WORD = layout.column('entry', 'word', 'i32')
const KIND = layout.column('entry', 'kind', 'u8')
const COUNT = layout.column('entry', 'count', 'f64')
const EFFECT_KIND = layout.column('effect', 'kind', 'u8')
const EFFECT_A = layout.column('effect', 'a', 'i32')
const EFFECT_B = layout.column('effect', 'b', 'i32')

export class Arm26History implements Arm26EffectSink, Arm26CallStackSink {
	private readonly log = new HistoryLog(layout)
	private start = 0
	private pcBefore = 0
	private outputLength = 0
	private inputIndex = 0
	private waiting = false
	private halted = false
	private keyIndex = 0
	private displayLength = 0
	private keyInterrupt = false
	private kind = ENTRY_INSTRUCTION
	private vector = 0
	private instructionCount = 0

	constructor(private readonly target: Arm26HistoryTarget, limit: number) {
		this.log.limit = limit
	}

	get length(): number {
		return this.log.length
	}

	get firstId(): number {
		return this.log.first
	}

	/** Opens an entry; call before the CPU steps, or before an edit with ENTRY_EDIT. */
	begin(kind = ENTRY_INSTRUCTION) {
		const { cpu, os, keyboard } = this.target
		this.kind = kind
		this.instructionCount = this.target.instructionCount
		this.log.openEntryWith(this.log.end)
		this.start = this.log.openEffectStart
		this.pcBefore = cpu.pc
		this.outputLength = os.output.length
		this.inputIndex = os.inputIndex
		this.waiting = os.waiting
		this.keyIndex = keyboard.inputIndex
		this.displayLength = keyboard.display.length
		this.keyInterrupt = keyboard.interruptEnable
		this.halted = this.target.halted
	}

	interrupted(vector: number) {
		this.kind = ENTRY_INTERRUPT
		this.vector = vector
	}

	/** Closes the entry; returns whether the step changed anything and so was kept. */
	end(): boolean {
		const { cpu, os, keyboard } = this.target
		if (os.output.length !== this.outputLength) this.push(EFFECT_OUTPUT, os.output.length, this.outputLength)
		if (os.inputIndex !== this.inputIndex) this.push(EFFECT_INPUT, 0, this.inputIndex)
		if (os.waiting !== this.waiting) this.push(EFFECT_WAITING, 0, this.waiting ? 1 : 0)
		if (keyboard.inputIndex !== this.keyIndex) this.push(EFFECT_KEY, 0, this.keyIndex)
		if (keyboard.display.length !== this.displayLength) this.push(EFFECT_DISPLAY, keyboard.display.length, this.displayLength)
		if (keyboard.interruptEnable !== this.keyInterrupt) this.push(EFFECT_KEY_INTERRUPT, 0, this.keyInterrupt ? 1 : 0)
		if (this.target.halted !== this.halted) this.push(EFFECT_HALTED, 0, this.halted ? 1 : 0)
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
		columns[WORD][slot] = this.kind === ENTRY_INTERRUPT ? this.vector : cpu.instruction
		columns[KIND][slot] = this.kind
		columns[COUNT][slot] = this.instructionCount
		log.close()
		return true
	}

	register(physical: number, old: number) {
		this.push(EFFECT_REGISTER, physical, old)
	}

	memory(address: number, oldWord: number) {
		this.push(EFFECT_MEMORY, address, oldWord)
	}

	pc(old: number) {
		this.push(EFFECT_PC, 0, old)
	}

	psr(old: number) {
		this.push(EFFECT_PSR, 0, old)
	}

	frameWord(index: number, old: number) {
		this.push(EFFECT_FRAME_WORD, index, old)
	}

	depth(old: number) {
		this.push(EFFECT_FRAME_DEPTH, 0, old)
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
		const { cpu, os, keyboard, callStack } = this.target
		const stop = this.effectStartAt(index)
		const count = this.countAt(index)
		const capacity = log.effects.capacity
		for (let position = log.effects.end - 1; position >= stop; position--) {
			const columns = log.effects.block(position).arrays
			const slot = position % capacity
			const a = columns[EFFECT_A][slot]
			const b = columns[EFFECT_B][slot]
			switch (columns[EFFECT_KIND][slot]) {
				case EFFECT_REGISTER: cpu.setPhysical(a, b); break
				case EFFECT_MEMORY: cpu.writeWord(a, b); break
				case EFFECT_PC: cpu.pc = b >>> 0; break
				case EFFECT_PSR: cpu.psr = b; break
				case EFFECT_OUTPUT: os.output = os.output.slice(0, b); break
				case EFFECT_INPUT: os.inputIndex = b; break
				case EFFECT_WAITING: os.waiting = b !== 0; break
				case EFFECT_HALTED: this.target.halted = b !== 0; break
				case EFFECT_FRAME_WORD: callStack.setFrameWord(a, b); break
				case EFFECT_FRAME_DEPTH: callStack.setDepth(b); break
				case EFFECT_KEY: keyboard.inputIndex = b; break
				case EFFECT_DISPLAY: keyboard.display = keyboard.display.slice(0, b); break
				case EFFECT_KEY_INTERRUPT: keyboard.interruptEnable = b !== 0; break
			}
		}
		cpu.fault = FAULT_NONE
		cpu.faultAddress = 0
		this.target.instructionCount = count
		log.truncate(index)
	}

	clear() {
		this.log.clear()
	}

	private push(kind: number, a: number, b: number) {
		const slot = this.log.pushEffect()
		if (slot < 0) return
		const columns = this.log.effects.tail!.arrays
		columns[EFFECT_KIND][slot] = kind
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
