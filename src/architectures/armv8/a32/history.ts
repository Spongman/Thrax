import type { PolledTerminal } from '../../../core/devices/polledTerminal'
/**
 * AArch32 execution history: one entry per state-changing step, each owning a
 * run of effects that hold the values the step replaced, in the shared
 * HistoryLog. A step that changes nothing (a read still waiting, a fault)
 * records no entry; rewinding to entry `index` leaves the machine about to
 * run that entry's instruction again.
 */

import { HistoryBufferLayout, type HistoryBufferSchema } from '../../../core/historyBuffers'
import { ReversibleHistory } from '../../../core/reversibleHistory'
import { HistoryText } from '../../../core/historyCursor'
import type { A32CallStack, A32CallStackSink } from './callStack'
import { FAULT_NONE, type A32Cpu, type A32EffectSink } from './cpu'
import type { A32Linux } from './machine'

const column = (name: string, type: 'u8' | 'u32' | 'f64') => Object.freeze({ name, type, elements: 1 })

/** Entry: the instruction's address and word, its kind and the count before it. Effect: a kind, a size and two values. */
export const a32HistorySchema: HistoryBufferSchema = Object.freeze({
	entry: Object.freeze([column('pc', 'u32'), column('word', 'u32'), column('kind', 'u8'), column('count', 'f64'), column('controlCount', 'f64'), column('passed', 'u8')]),
	effect: Object.freeze([column('kind', 'u8'), column('size', 'u8'), column('a', 'f64'), column('b', 'f64')]),
})

/** Effect kinds; `b` holds the value exchanged with live state when navigating. `a` is the register index. */
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
/** `a` is the S register index, `b` its bits. */
export const EFFECT_FP_REGISTER = 15
export const EFFECT_FPSCR = 16

export const ENTRY_INSTRUCTION = 0
export const ENTRY_EDIT = 1

/** What the history records and restores; A32Machine is one. */
export interface A32HistoryTarget {
	readonly cpu: A32Cpu
	readonly linux: A32Linux
	readonly keyboard: PolledTerminal
	readonly callStack: A32CallStack
	halted: boolean
	instructionCount: number
}

const layout = new HistoryBufferLayout(a32HistorySchema)
const PC = layout.column('entry', 'pc', 'u32')
const WORD = layout.column('entry', 'word', 'u32')
const KIND = layout.column('entry', 'kind', 'u8')
const COUNT = layout.column('entry', 'count', 'f64')
const CONTROL_COUNT = layout.column('entry', 'controlCount', 'f64')
const PASSED = layout.column('entry', 'passed', 'u8')
const EFFECT_KIND = layout.column('effect', 'kind', 'u8')
const EFFECT_SIZE = layout.column('effect', 'size', 'u8')
const EFFECT_A = layout.column('effect', 'a', 'f64')
const EFFECT_B = layout.column('effect', 'b', 'f64')

export class A32History extends ReversibleHistory implements A32EffectSink, A32CallStackSink {
	readonly outputText = new HistoryText()
	readonly displayText = new HistoryText()
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
		super(layout, limit)
	}

	/** Opens an entry; call before the CPU steps, or before an edit with ENTRY_EDIT. */
	begin(kind = ENTRY_INSTRUCTION) {
		this.timeline.branch()
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
		if (linux.output.length !== this.outputLength) this.push(EFFECT_OUTPUT, 0, linux.output.length, this.outputLength)
		if (linux.inputIndex !== this.inputIndex) this.push(EFFECT_INPUT, 0, 0, this.inputIndex)
		if (linux.waiting !== this.waiting) this.push(EFFECT_WAITING, 0, 0, this.waiting ? 1 : 0)
		if (linux.exitCode !== this.exitCode) this.push(EFFECT_EXIT, 0, 0, this.exitCode)
		if (linux.programBreak !== this.programBreak) this.push(EFFECT_BREAK, 0, 0, this.programBreak)
		if (keyboard.keyIndex !== this.keyIndex) this.push(EFFECT_KEY, 0, 0, this.keyIndex)
		if (keyboard.display.length !== this.displayLength) this.push(EFFECT_DISPLAY, 0, keyboard.display.length, this.displayLength)
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
		columns[CONTROL_COUNT][slot] = this.instructionCount
		columns[PASSED][slot] = Number(cpu.passed)
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

	fpRegister(index: number, old: number) {
		this.push(EFFECT_FP_REGISTER, 0, index, old)
	}

	fpscr(old: number) {
		this.push(EFFECT_FPSCR, 0, 0, old)
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

	passedAt(index: number): boolean {
		return this.column(index, PASSED) !== 0
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

	protected exchange = (index: number, forward: boolean) => {
		const log = this.log
		const { cpu, linux, keyboard, callStack } = this.target
		const start = log.effectStart(index), count = log.effectCount(index)
		for (let offset = 0; offset < count; offset++) {
			const position = start + (forward ? offset : count - offset - 1)
			const columns = log.effects.block(position).arrays, slot = position % log.effects.capacity
			const a = columns[EFFECT_A][slot], b = columns[EFFECT_B][slot]
			switch (columns[EFFECT_KIND][slot]) {
				case EFFECT_REGISTER: columns[EFFECT_B][slot] = cpu.r[a]; cpu.r[a] = b; break
				case EFFECT_PC: columns[EFFECT_B][slot] = cpu.pc; cpu.pc = b; break
				case EFFECT_CPSR: columns[EFFECT_B][slot] = cpu.cpsr; cpu.cpsr = b; break
				case EFFECT_MEMORY: columns[EFFECT_B][slot] = cpu.load(a, this.effect(position, EFFECT_SIZE)); cpu.restore(a, this.effect(position, EFFECT_SIZE), b); break
				case EFFECT_MONITOR: columns[EFFECT_B][slot] = cpu.exclusive; cpu.exclusive = b; break
				case EFFECT_FP_REGISTER: columns[EFFECT_B][slot] = cpu.s[a]; cpu.s[a] = b; break
				case EFFECT_FPSCR: columns[EFFECT_B][slot] = cpu.fpscr; cpu.fpscr = b; break
				case EFFECT_OUTPUT: columns[EFFECT_B][slot] = linux.output.length; columns[EFFECT_A][slot] = b; linux.output = this.outputText.exchange(linux.output, b); break
				case EFFECT_INPUT: columns[EFFECT_B][slot] = linux.inputIndex; linux.inputIndex = b; break
				case EFFECT_WAITING: columns[EFFECT_B][slot] = +linux.waiting; linux.waiting = b !== 0; break
				case EFFECT_HALTED: columns[EFFECT_B][slot] = +this.target.halted; this.target.halted = b !== 0; break
				case EFFECT_EXIT: columns[EFFECT_B][slot] = linux.exitCode; linux.exitCode = b; break
				case EFFECT_BREAK: columns[EFFECT_B][slot] = linux.programBreak; linux.programBreak = b; break
				case EFFECT_FRAME_WORD: columns[EFFECT_B][slot] = callStack.frameWordAt(a); callStack.setFrameWord(a, b); break
				case EFFECT_FRAME_DEPTH: columns[EFFECT_B][slot] = callStack.depth; callStack.setDepth(b); break
				case EFFECT_KEY: columns[EFFECT_B][slot] = keyboard.keyIndex; keyboard.keyIndex = b; break
				case EFFECT_DISPLAY: columns[EFFECT_B][slot] = keyboard.display.length; columns[EFFECT_A][slot] = b; keyboard.display = this.displayText.exchange(keyboard.display, b); break
			}
		}
		const entrySlot = (log.first + index) % log.entries.capacity
		const entries = log.entries.block(log.first + index).arrays
		cpu.fault = FAULT_NONE
		cpu.faultAddress = 0
		cpu.faultDetail = ''
		{ const held = this.target.instructionCount; this.target.instructionCount = entries[CONTROL_COUNT][entrySlot]; entries[CONTROL_COUNT][entrySlot] = held }
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

}
