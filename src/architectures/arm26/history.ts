/**
 * ARM26 execution history: one entry per state-changing step, each owning a
 * run of effects that hold the values the step replaced, in the shared
 * HistoryLog. Steps that change only fetch/cache/clock state are kept as edits
 * without retiring an instruction. Rewinding to entry `index` undoes it and every
 * later one, leaving the machine about to run that entry's instruction again.
 */

import { HistoryBufferLayout, type HistoryBufferSchema } from '../../core/historyBuffers'
import { ReversibleHistory } from '../../core/reversibleHistory'
import { HistoryText, exchangeHistoryArray } from '../../core/historyCursor'
import type { Arm26CallStack, Arm26CallStackSink } from './callStack'
import { FAULT_NONE, type Arm26Cpu, type Arm26EffectSink } from './cpu'
import type { Arm26Keyboard } from './keyboard'
import type { Arm26Os } from './os'

const column = (name: string, type: 'u8' | 'i32' | 'u32' | 'f64', elements = 1) => Object.freeze({ name, type, elements })

/** Entry: the instruction's address and word (the vector, for an interrupt), its kind and the count before it. */
export const arm26HistorySchema: HistoryBufferSchema = Object.freeze({
	entry: Object.freeze([
		column('pc', 'u32'), column('word', 'i32'), column('kind', 'u8'), column('count', 'f64'), column('controlCount', 'f64'),
		column('cyclesBefore', 'f64'), column('executeCycles', 'u32'), column('passed', 'u8'), column('redirected', 'u8'),
		column('prefetch', 'u32', 7), column('prefetchTimes', 'f64', 6),
		column('clock', 'f64', 7), column('timing', 'f64', 6),
	]),
	effect: Object.freeze([column('kind', 'u8'), column('a', 'i32'), column('b', 'i32')]),
})

/** Effect kinds; `b` holds the value exchanged with live state when navigating. `a` is the physical register. */
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
export const EFFECT_CACHE = 13

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
const CONTROL_COUNT = layout.column('entry', 'controlCount', 'f64')
const CYCLES = layout.column('entry', 'cyclesBefore', 'f64')
const EXECUTE = layout.column('entry', 'executeCycles', 'u32')
const PREFETCH = layout.column('entry', 'prefetch', 'u32', 7)
const PREFETCH_TIMES = layout.column('entry', 'prefetchTimes', 'f64', 6)
const CLOCK = layout.column('entry', 'clock', 'f64', 7)
const TIMING = layout.column('entry', 'timing', 'f64', 6)
const PASSED = layout.column('entry', 'passed', 'u8')
const REDIRECTED = layout.column('entry', 'redirected', 'u8')
const EFFECT_KIND = layout.column('effect', 'kind', 'u8')
const EFFECT_A = layout.column('effect', 'a', 'i32')
const EFFECT_B = layout.column('effect', 'b', 'i32')

export class Arm26History extends ReversibleHistory implements Arm26EffectSink, Arm26CallStackSink {
	private cyclesBefore = 0
	readonly outputText = new HistoryText()
	readonly displayText = new HistoryText()
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
		super(layout, limit)
	}

	/** Opens an entry; call before the CPU steps, or before an edit with ENTRY_EDIT. */
	begin(kind = ENTRY_INSTRUCTION) {
		this.timeline.branch()
		const { cpu, os, keyboard } = this.target
		this.kind = kind
		this.instructionCount = this.target.instructionCount
		this.log.openEntryWith(this.log.end)
		this.start = this.log.openEffectStart
		this.pcBefore = cpu.pc
		this.cyclesBefore = cpu.cycles
		const position = this.log.openEntry
		if (position >= 0) {
			const columns = this.log.entries.block(position).arrays
			const slot = position % this.log.entries.capacity
			columns[PREFETCH].set(cpu.prefetch.words, slot * 7)
			columns[PREFETCH_TIMES].set(cpu.prefetch.times, slot * 6)
			columns[CLOCK].set(cpu.clock.state, slot * 7)
		}
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

	/** Waiting or a rejected instruction may change cache/input state without retiring. */
	notRetired() {
		this.kind = ENTRY_EDIT
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
		if (log.effects.end === this.start && cpu.cycles === this.cyclesBefore) {
			log.discard()
			return false
		}
		const columns = log.entries.block(position).arrays
		const slot = position % log.entries.capacity
		columns[PC][slot] = this.pcBefore
		columns[WORD][slot] = this.kind === ENTRY_INTERRUPT ? this.vector : cpu.instruction
		columns[KIND][slot] = this.kind
		columns[COUNT][slot] = this.instructionCount
		columns[CONTROL_COUNT][slot] = this.instructionCount
		columns[CYCLES][slot] = this.cyclesBefore
		columns[EXECUTE][slot] = cpu.executeCycles
		columns[PASSED][slot] = +cpu.passed
		columns[REDIRECTED][slot] = +cpu.redirected
		columns[TIMING].set(cpu.timing, slot * 6)
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

	cache(index: number, old: number) {
		this.push(EFFECT_CACHE, index, old)
	}

	executeCyclesAt(index: number): number { return this.column(index, EXECUTE) }
	passedAt(index: number): boolean { return this.column(index, PASSED) !== 0 }
	redirectedAt(index: number): boolean { return this.column(index, REDIRECTED) !== 0 }
	timingAt(index: number): number[] {
		const position = this.log.first + index
		const slot = position % this.log.entries.capacity
		return Array.from(this.log.entries.block(position).arrays[TIMING].subarray(slot * 6, slot * 6 + 6))
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

	protected exchange = (index: number, forward: boolean) => {
		const log = this.log
		const { cpu, os, keyboard, callStack } = this.target
		const start = log.effectStart(index), count = log.effectCount(index)
		for (let offset = 0; offset < count; offset++) {
			const position = start + (forward ? offset : count - offset - 1)
			const columns = log.effects.block(position).arrays, slot = position % log.effects.capacity
			const a = columns[EFFECT_A][slot], b = columns[EFFECT_B][slot]
			switch (columns[EFFECT_KIND][slot]) {
				case EFFECT_REGISTER: columns[EFFECT_B][slot] = cpu.registers[a]; cpu.setPhysical(a, b); break
				case EFFECT_CACHE: columns[EFFECT_B][slot] = cpu.cache!.state[a]; cpu.cache!.state[a] = b; break
				case EFFECT_MEMORY: columns[EFFECT_B][slot] = cpu.readWord(a); cpu.writeWord(a, b); break
				case EFFECT_PC: columns[EFFECT_B][slot] = cpu.pc; cpu.pc = b >>> 0; break
				case EFFECT_PSR: columns[EFFECT_B][slot] = cpu.psr; cpu.psr = b; break
				case EFFECT_OUTPUT: columns[EFFECT_B][slot] = os.output.length; columns[EFFECT_A][slot] = b; os.output = this.outputText.exchange(os.output, b); break
				case EFFECT_INPUT: columns[EFFECT_B][slot] = os.inputIndex; os.inputIndex = b; break
				case EFFECT_WAITING: columns[EFFECT_B][slot] = +os.waiting; os.waiting = b !== 0; break
				case EFFECT_HALTED: columns[EFFECT_B][slot] = +this.target.halted; this.target.halted = b !== 0; break
				case EFFECT_FRAME_WORD: columns[EFFECT_B][slot] = callStack.frameWordAt(a); callStack.setFrameWord(a, b); break
				case EFFECT_FRAME_DEPTH: columns[EFFECT_B][slot] = callStack.depth; callStack.setDepth(b); break
				case EFFECT_KEY: columns[EFFECT_B][slot] = keyboard.inputIndex; keyboard.inputIndex = b; break
				case EFFECT_DISPLAY: columns[EFFECT_B][slot] = keyboard.display.length; columns[EFFECT_A][slot] = b; keyboard.display = this.displayText.exchange(keyboard.display, b); break
				case EFFECT_KEY_INTERRUPT: columns[EFFECT_B][slot] = +keyboard.interruptEnable; keyboard.interruptEnable = b !== 0; break
			}
		}
		const entrySlot = (log.first + index) % log.entries.capacity
		const entries = log.entries.block(log.first + index).arrays
		exchangeHistoryArray(entries[PREFETCH] as Uint32Array, entrySlot * 7, cpu.prefetch.words)
		exchangeHistoryArray(entries[PREFETCH_TIMES] as Float64Array, entrySlot * 6, cpu.prefetch.times)
		exchangeHistoryArray(entries[CLOCK] as Float64Array, entrySlot * 7, cpu.clock.state)
		cpu.fault = FAULT_NONE
		cpu.faultAddress = 0
		{ const held = this.target.instructionCount; this.target.instructionCount = entries[CONTROL_COUNT][entrySlot]; entries[CONTROL_COUNT][entrySlot] = held }
	}

	private push(kind: number, a: number, b: number) {
		const slot = this.log.pushEffect()
		if (slot < 0) return
		const columns = this.log.effects.tail!.arrays
		columns[EFFECT_KIND][slot] = kind
		columns[EFFECT_A][slot] = a
		columns[EFFECT_B][slot] = b
	}

}
