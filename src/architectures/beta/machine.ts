/**
 * BSim-compatible machine profile: the privileged operations on opcode 0x00
 * that console programs need, and program loading.
 *
 * Semantics follow BSim (course labs/tools/bsim_workbook.min.js, PRIV_OP and
 * executeCycle) and its documentation (labs/tool_docs/bsim.html):
 * - The all-zero word is HALT() in either mode; the PC stays on it.
 * - Every other privileged op is illegal in user mode.
 * - PRIV_OP(0) HALT, PRIV_OP(1) RDCHAR, PRIV_OP(2) WRCHAR; RDCHAR and WRCHAR
 *   need `.options tty` and are illegal without it.
 * - RDCHAR puts the typed character in R0, CR read as LF. With none waiting
 *   BSim re-executes it; here that is STEP_WAIT with the PC unchanged, and no
 *   cycle passes while it waits.
 * - WRCHAR prints the character in Ra (R0 for the WRCHAR() macro). BSim
 *   prints the low 16 bits as UTF-16; THRAX prints the low byte.
 * - CLICK reads -1, BSim's "no click": THRAX has no mouse, so it never raises
 *   the mouse interrupt either.
 * Codes 3, 4 and 6 to 8 (CYCLE, TIME, RANDOM, SEED, SERVER) are not
 * implemented and are illegal, as is every other code.
 *
 * Interrupts, as executeCycle takes them: each cycle the clock counts first
 * (with `.options clock` it requests an interrupt every 10,000 cycles), then,
 * in user mode only, a requested interrupt is taken instead of an instruction:
 * clock, then keyboard, then mouse. XP <- PC+4, PC <- 0x80000000 | vector.
 * Requests wait while the CPU is in supervisor mode.
 *
 * The keyboard (`.options tty`): BSim holds one typed character, and each key
 * pressed overwrites it and requests a keyboard interrupt. THRAX queues what
 * is typed and hands it over a character at a time, each once the last was
 * read and KEY_INTERVAL cycles have passed, standing in for a typist; RDCHAR
 * takes from the queue directly when nothing has arrived, so a program that
 * only polls reads typed text at once.
 */

import type { ProgramImage } from '../contracts'
import { BetaCallStack } from './callStack'
import { BetaCpu, PRIV_HALT, PRIV_ILLEGAL, PRIV_NEXT, PRIV_WAIT, PRIV_WRITE_R0, R_ZERO, STEP_FAULT, STEP_HALT, STEP_INTERRUPT, STEP_OK, STEP_WAIT, SUPERVISOR, VEC_ILLOP, VEC_RESET, type BetaPrivilegedHandler } from './cpu'
import { BetaHistory, ENTRY_EDIT } from './history'
import { R_SP } from './registers'

export const PRIV_CODE_HALT = 0
export const PRIV_CODE_RDCHAR = 1
export const PRIV_CODE_WRCHAR = 2
export const PRIV_CODE_CLICK = 5

/** Interrupt request bits, as BSim numbers them. */
export const IRQ_CLOCK = 2
export const IRQ_KEYBOARD = 4
export const IRQ_MOUSE = 8

/** Cycles between clock interrupts. */
export const CLOCK_PERIOD = 10_000
/** Cycles between typed characters arriving. */
export const KEY_INTERVAL = 10_000

/** Exception vectors, as offsets entered at 0x80000000 | vector. */
export interface BetaVectorTable {
	reset: number
	/** Illegal opcodes and SVC. */
	illegal: number
	/** User-mode access outside memory, or -1 where the profile faults instead. */
	segfault: number
	clock: number
	keyboard: number
	mouse: number
}

/** A machine profile: what the CPU core leaves to the simulator it runs in. */
export interface BetaProfile {
	id: string
	name: string
	vectors: Readonly<BetaVectorTable>
}

/**
 * BSim's table, matching the course beta.uasm and the lab TinyOS kernel.
 * Interrupts save XP = PC + 4; a segfault saves XP = PC on a fetch, PC + 4 on
 * a load or store.
 */
export const BSIM_PROFILE: BetaProfile = Object.freeze({
	id: 'bsim',
	name: 'BSim',
	vectors: Object.freeze({ reset: 0, illegal: 4, segfault: 8, clock: 12, keyboard: 16, mouse: 20 }),
})

/** Points the CPU at the profile's vectors; the ISA fixes reset and illegal. */
export function applyProfile(cpu: BetaCpu, profile: BetaProfile) {
	if (profile.vectors.reset !== VEC_RESET || profile.vectors.illegal !== VEC_ILLOP) throw new Error(`Profile ${profile.id} moves a vector the ISA fixes`)
	cpu.segfaultVector = profile.vectors.segfault
}

const CR = 13
const LF = 10

export interface BetaConsoleOptions {
	/** `.options tty`; BSim's default is notty. */
	tty?: boolean
}

/** Console I/O and HALT for a BetaCpu, attached as its `privileged` handler. */
export class BetaConsole implements BetaPrivilegedHandler {
	value = 0
	tty: boolean
	output = ''
	/** True while a RDCHAR waits for feed(). */
	waiting = false
	/** Everything ever typed, kept so a rewound run reads the same characters again. */
	input = ''
	/** Next character to hand over. */
	inputIndex = 0
	/** The character that arrived and is not yet read, or -1. */
	key = -1
	/** IRQ_* bits requested and not yet taken. */
	pending = 0
	/** Cycles before the next character may arrive. */
	keyWait = 0

	constructor(options: BetaConsoleOptions = {}) {
		this.tty = options.tty ?? false
	}

	/** Queues typed characters. */
	feed(text: string) {
		this.input += text
	}

	/** Whether typed characters are queued or arrived and unread. */
	get typed(): boolean {
		return this.key >= 0 || this.inputIndex < this.input.length
	}

	/** One cycle of the keyboard: the next queued character arrives when it may. */
	cycle() {
		if (this.keyWait > 0) this.keyWait--
		else if (this.key < 0 && this.inputIndex < this.input.length) {
			this.key = this.input.charCodeAt(this.inputIndex++) & 0xFF
			this.pending |= IRQ_KEYBOARD
			this.keyWait = KEY_INTERVAL
		}
	}

	execute(word: number, a: number, supervisor: boolean): number {
		if (word === 0) return PRIV_HALT
		if (!supervisor) return PRIV_ILLEGAL
		switch ((word << 16) >> 16) {
			case PRIV_CODE_HALT: return PRIV_HALT
			case PRIV_CODE_RDCHAR: {
				if (!this.tty) return PRIV_ILLEGAL
				let code = this.key
				if (code >= 0) this.key = -1
				else if (this.inputIndex < this.input.length) code = this.input.charCodeAt(this.inputIndex++) & 0xFF
				else {
					this.waiting = true
					return PRIV_WAIT
				}
				this.waiting = false
				this.value = code === CR ? LF : code
				return PRIV_WRITE_R0
			}
			case PRIV_CODE_WRCHAR:
				if (!this.tty) return PRIV_ILLEGAL
				this.output += String.fromCharCode(a & 0xFF)
				return PRIV_NEXT
			case PRIV_CODE_CLICK:
				if (!this.tty) return PRIV_ILLEGAL
				this.value = -1
				return PRIV_WRITE_R0
			default: return PRIV_ILLEGAL
		}
	}
}

/** Resets `cpu`, copies the image into memory and starts at its entry in supervisor mode. */
export function loadProgram(cpu: BetaCpu, image: ProgramImage) {
	cpu.reset()
	for (const section of image.sections) cpu.loadBytes(section.address, section.bytes)
	cpu.pc = (SUPERVISOR | (image.entryAddress ?? 0)) >>> 0
}

export interface BetaMachineOptions {
	memoryBytes?: number
	tty?: boolean
	/** `.options clock`: a clock interrupt every CLOCK_PERIOD cycles. */
	clock?: boolean
	/** `.options segmentation`: the base-and-bounds MMU. */
	segmentation?: boolean
	profile?: BetaProfile
	/** Entries of history to keep; 0 for none. */
	historyLimit?: number
}

/**
 * A CPU with its BSim console, halt state, shadow call stack and optional
 * history. Every state change of step() and interrupt() goes through the
 * history, so it can rewind any of them.
 */
export class BetaMachine {
	readonly cpu: BetaCpu
	readonly console: BetaConsole
	readonly callStack = new BetaCallStack()
	readonly profile: BetaProfile
	readonly history: BetaHistory | null
	readonly clock: boolean
	halted = false
	/** Instructions retired since the program loaded. */
	instructionCount = 0
	/** Cycles since the last clock tick, as BSim's executeCycle counts them. */
	tick = 0
	/** Set once the CPU has been in user mode, where interrupts are taken. */
	userMode = false

	constructor(options: BetaMachineOptions = {}) {
		this.cpu = new BetaCpu({ memoryBytes: options.memoryBytes })
		this.cpu.segmentation = options.segmentation ?? false
		this.clock = options.clock ?? false
		this.console = new BetaConsole({ tty: options.tty })
		this.cpu.privileged = this.console
		this.profile = options.profile ?? BSIM_PROFILE
		applyProfile(this.cpu, this.profile)
		const limit = options.historyLimit ?? 0
		this.history = limit > 0 ? new BetaHistory(this, limit) : null
		this.cpu.sink = this.history
		this.callStack.sink = this.history
	}

	/** Loads an image and forgets history, call stack and halt. */
	load(image: ProgramImage) {
		loadProgram(this.cpu, image)
		this.halted = false
		this.instructionCount = 0
		this.tick = 0
		this.userMode = false
		const tty = this.console
		tty.output = ''
		tty.input = ''
		tty.inputIndex = 0
		tty.waiting = false
		tty.key = -1
		tty.pending = 0
		tty.keyWait = 0
		this.callStack.clear()
		this.history?.clear()
	}

	/**
	 * One cycle: an interrupt taken, or one instruction run; returns a STEP_*
	 * code. Once halted, stays halted.
	 */
	step(): number {
		if (this.halted) return STEP_HALT
		const cpu = this.cpu
		const tty = this.console
		const history = this.history
		history?.begin()
		const tick = this.tick
		const pending = tty.pending
		const keyWait = tty.keyWait
		this.tick = tick + 1 === CLOCK_PERIOD ? 0 : tick + 1
		if (this.tick === 0 && this.clock) tty.pending |= IRQ_CLOCK
		if (tty.tty) tty.cycle()
		const pc = cpu.pc
		if (!(pc & SUPERVISOR)) {
			this.userMode = true
			if (tty.pending !== 0) {
				this.takeInterrupt()
				history?.end()
				return STEP_INTERRUPT
			}
		}
		const status = cpu.step()
		if (status === STEP_OK) this.callStack.observe(cpu.instruction, pc, cpu.pc, cpu.registers[R_SP])
		else if (status === STEP_HALT) this.halted = true
		if (status === STEP_WAIT || status === STEP_FAULT) {
			// Nothing ran, so no cycle passed; nothing arrived either, as RDCHAR found nothing.
			this.tick = tick
			tty.pending = pending
			tty.keyWait = keyWait
		} else {
			this.instructionCount++
		}
		history?.end()
		return status
	}

	/** Takes the highest priority request: clock, keyboard, then mouse. */
	private takeInterrupt() {
		const tty = this.console
		const { clock, keyboard, mouse } = this.profile.vectors
		const pending = tty.pending
		const bit = pending & IRQ_CLOCK ? IRQ_CLOCK : pending & IRQ_KEYBOARD ? IRQ_KEYBOARD : IRQ_MOUSE
		tty.pending = pending & ~bit
		const vector = bit === IRQ_CLOCK ? clock : bit === IRQ_KEYBOARD ? keyboard : mouse
		this.history?.interrupted(vector)
		this.cpu.interrupt(vector)
	}

	/** Steps while each cycle runs or interrupts, or `limit` steps; returns the last code. */
	run(limit: number): number {
		let status = STEP_OK
		for (let steps = 0; steps < limit && (status === STEP_OK || status === STEP_INTERRUPT); steps++) status = this.step()
		return status
	}

	/** A user's change to a register, recorded as an edit entry. R31 refuses. */
	editRegister(index: number, value: number): boolean {
		if (index < 0 || index >= R_ZERO) return false
		return this.edit(() => {
			this.history?.register(index, this.cpu.registers[index])
			this.cpu.setRegister(index, value | 0)
		})
	}

	/** Moves the PC by hand; leaves halt, so the program can carry on from there. */
	editPc(value: number): boolean {
		return this.edit(() => {
			this.history?.pc(this.cpu.pc)
			this.cpu.pc = value >>> 0
			this.halted = false
		})
	}

	/**
	 * Rewrites `bytes` of memory from `address` as one edit; false when any of
	 * them lies outside memory.
	 */
	editBytes(address: number, bytes: ArrayLike<number>): boolean {
		const memory = this.cpu.memory
		if (address < 0 || address + bytes.length > memory.length) return false
		return this.edit(() => {
			const first = address & ~3
			const last = (address + bytes.length - 1) & ~3
			for (let word = first; word <= last; word += 4) this.history?.memory(word, this.cpu.readWord(word))
			memory.set(Array.from(bytes, (byte) => byte & 0xFF), address)
		})
	}

	private edit(change: () => void): boolean {
		this.history?.begin(ENTRY_EDIT)
		change()
		this.history?.end()
		return true
	}

	/** Takes an interrupt at a profile vector now, recorded like a step. */
	interrupt(vector: number): boolean {
		this.history?.begin()
		if (!this.cpu.supervisor) this.history?.interrupted(vector)
		const taken = this.cpu.interrupt(vector)
		this.history?.end()
		return taken
	}
}
