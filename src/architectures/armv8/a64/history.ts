import type { PolledTerminal } from '../../../core/devices/polledTerminal'
/**
 * AArch64 execution history: one entry per state-changing step, each owning a
 * run of effects that hold the values the step replaced. 64-bit values are
 * kept as two halves, so every bit comes back on a rewind.
 *
 * As in the Beta history, the shared HistoryLog owns blocks, eviction and
 * truncation; a step that changes nothing (a read still waiting, a fault)
 * records no entry; and rewinding to entry `index` leaves the machine about
 * to run that entry's instruction again.
 */

import { HistoryBufferLayout, type HistoryBufferSchema } from '../../../core/historyBuffers'
import { ReversibleHistory } from '../../../core/reversibleHistory'
import { HistoryText } from '../../../core/historyCursor'
import type { A64CallStack, A64CallStackSink } from './callStack'
import { FAULT_NONE, type A64Cpu, type A64EffectSink } from './cpu'
import { MASK32 } from './isa'
import type { A64Linux } from './machine'

const column = (name: string, type: 'u8' | 'u32' | 'f64') => Object.freeze({ name, type, elements: 1 })

/**
 * Entry: the instruction's address and word, its kind and the instruction
 * count before it. Effect: a kind, a size, and up to three values.
 */
export const a64HistorySchema: HistoryBufferSchema = Object.freeze({
	entry: Object.freeze([column('pc', 'f64'), column('word', 'u32'), column('kind', 'u8'), column('count', 'f64'), column('controlCount', 'f64')]),
	effect: Object.freeze([column('kind', 'u8'), column('size', 'u8'), column('a', 'f64'), column('b', 'f64'), column('hi', 'u32')]),
})

/** Effect kinds; `b` (and `hi` for 64-bit values) exchanges with live state when navigating. */
export const EFFECT_REGISTER = 0
export const EFFECT_SP = 1
export const EFFECT_PC = 2
export const EFFECT_FLAGS = 3
/** `a` is the address, `size` the bytes. */
export const EFFECT_MEMORY = 4
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

export const DEFAULT_HISTORY_LIMIT = 100_000

export const ENTRY_INSTRUCTION = 0
export const ENTRY_EDIT = 1

/** What the history records and restores; A64Machine is one. */
export interface A64HistoryTarget {
	readonly cpu: A64Cpu
	readonly linux: A64Linux
	readonly keyboard: PolledTerminal
	readonly callStack: A64CallStack
	halted: boolean
	instructionCount: number
}

const layout = new HistoryBufferLayout(a64HistorySchema)
const PC = layout.column('entry', 'pc', 'f64')
const WORD = layout.column('entry', 'word', 'u32')
const KIND = layout.column('entry', 'kind', 'u8')
const COUNT = layout.column('entry', 'count', 'f64')
const CONTROL_COUNT = layout.column('entry', 'controlCount', 'f64')
const EFFECT_KIND = layout.column('effect', 'kind', 'u8')
const EFFECT_SIZE = layout.column('effect', 'size', 'u8')
const EFFECT_A = layout.column('effect', 'a', 'f64')
const EFFECT_B = layout.column('effect', 'b', 'f64')
const EFFECT_HI = layout.column('effect', 'hi', 'u32')

const low = (value: bigint) => Number(value & MASK32)
const high = (value: bigint) => Number((value >> 32n) & MASK32)
const join = (lo: number, hi: number) => (BigInt(hi) << 32n) | BigInt(lo >>> 0)

export class A64History extends ReversibleHistory implements A64EffectSink, A64CallStackSink {
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

	constructor(private readonly target: A64HistoryTarget, limit = DEFAULT_HISTORY_LIMIT) {
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
		columns[WORD][slot] = this.kind === ENTRY_EDIT ? 0 : cpu.instruction
		columns[KIND][slot] = this.kind
		columns[COUNT][slot] = this.instructionCount
		columns[CONTROL_COUNT][slot] = this.instructionCount
		log.close()
		return true
	}

	register(index: number, old: bigint) {
		this.push(EFFECT_REGISTER, 0, index, low(old), high(old))
	}

	sp(old: bigint) {
		this.push(EFFECT_SP, 0, 0, low(old), high(old))
	}

	pc(old: number) {
		this.push(EFFECT_PC, 0, 0, old)
	}

	flags(old: number) {
		this.push(EFFECT_FLAGS, 0, 0, old)
	}

	memory(address: number, size: number, old: bigint) {
		this.push(EFFECT_MEMORY, size, address, low(old), high(old))
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

	/** The old 64-bit value of a register, SP or memory effect. */
	effectValue(position: number): bigint {
		return join(this.effect(position, EFFECT_B), this.effect(position, EFFECT_HI))
	}

	protected exchange = (index: number, forward: boolean) => {
		const log = this.log
		const { cpu, linux, keyboard, callStack } = this.target
		const start = log.effectStart(index), count = log.effectCount(index)
		for (let offset = 0; offset < count; offset++) {
			const position = start + (forward ? offset : count - offset - 1)
			const columns = log.effects.block(position).arrays, slot = position % log.effects.capacity
			const a = columns[EFFECT_A][slot], b = columns[EFFECT_B][slot]
			const held = this.effectValue(position)
			switch (columns[EFFECT_KIND][slot]) {
				case EFFECT_REGISTER: {
					const current = cpu.x[a]
					columns[EFFECT_B][slot] = low(current)
					columns[EFFECT_HI][slot] = high(current)
					cpu.x[a] = held; break
				}
				case EFFECT_SP: {
					const current = cpu.sp
					columns[EFFECT_B][slot] = low(current)
					columns[EFFECT_HI][slot] = high(current)
					cpu.sp = held; break
				}
				case EFFECT_PC: columns[EFFECT_B][slot] = cpu.pc; cpu.pc = b; break
				case EFFECT_FLAGS: columns[EFFECT_B][slot] = cpu.nzcv; cpu.nzcv = b; break
				case EFFECT_MEMORY: {
					const current = cpu.load(a, this.effect(position, EFFECT_SIZE))!
					columns[EFFECT_B][slot] = low(current)
					columns[EFFECT_HI][slot] = high(current)
					cpu.restore(a, this.effect(position, EFFECT_SIZE), held); break
				}
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
		{ const held = this.target.instructionCount; this.target.instructionCount = entries[CONTROL_COUNT][entrySlot]; entries[CONTROL_COUNT][entrySlot] = held }
	}

	private push(kind: number, size: number, a: number, b: number, hi = 0) {
		const slot = this.log.pushEffect()
		if (slot < 0) return
		const columns = this.log.effects.tail!.arrays
		columns[EFFECT_KIND][slot] = kind
		columns[EFFECT_SIZE][slot] = size
		columns[EFFECT_A][slot] = a
		columns[EFFECT_B][slot] = b
		columns[EFFECT_HI][slot] = hi
	}

}
