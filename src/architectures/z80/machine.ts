import { BufferedConsole } from '../../core/console'
import { deltaHistoryEdit } from '../../core/editTransaction'
/**
 * A bare Z80 with 64 KiB of RAM and a small console device, reached both as
 * memory at 0xFF00-0xFF07 and as I/O ports 0x00-0x07 (the low byte of the
 * port address; the high byte is ignored):
 *
 *   +0  write: print the character        read: 0
 *   +1  read: the next typed character, or 0 when there is none
 *   +2  read: status: bit 0 a character is waiting, bit 1 output ready (always),
 *             bit 2 the timer has fired since the last status read
 *       write: interrupt enables: bit 0 keyboard, bit 1 timer
 *   +3  write: end the program with this exit code
 *   +4  read/write: timer period in units of 256 T-states; 0 stops it
 *   +5  read: the next typed character, waiting until there is one
 *
 * Other addresses in that page, and the rest of memory, are plain RAM.
 *
 * Interrupts: typing queues characters, which arrive one at a time, each at
 * least KEY_INTERVAL T-states after the last; an arrival requests the keyboard
 * interrupt when it is enabled. The timer requests its interrupt every period.
 * A request is taken before an instruction when IFF1 is set and no EI has just
 * run: the timer first, then the keyboard. The keyboard puts 0xF7 (RST 30h) on
 * the bus and the timer 0xFF (RST 38h), which IM 0 runs, IM 1 ignores for RST
 * 38h, and IM 2 uses as the low byte of the vector table address. NMI goes to
 * 0x0066; nothing in this machine raises it but `nmi()`.
 *
 * HALT waits for an interrupt, skipping ahead to the next timer tick or typed
 * character. With interrupts disabled, or no source enabled that could raise
 * one, it ends the program.
 */

import type { ProgramImage } from '../contracts'
import { Z80CallStack } from './callStack'
import { SLOT_COUNT, SLOT_PC, Z80Cpu, type Z80Bus } from './cpu'
import { Z80History } from './history'

export const DEVICE_BASE = 0xFF00
export const DEVICE_SIZE = 8

/** Device register offsets. */
export const DEVICE_OUTPUT = 0
export const DEVICE_INPUT = 1
export const DEVICE_STATUS = 2
export const DEVICE_EXIT = 3
export const DEVICE_TIMER = 4
export const DEVICE_READ_WAIT = 5

/** Interrupt request and enable bits. */
export const IRQ_KEYBOARD = 1
export const IRQ_TIMER = 2

/** What each source puts on the data bus. */
export const KEYBOARD_DATA = 0xF7
export const TIMER_DATA = 0xFF

/** T-states between typed characters arriving. */
export const KEY_INTERVAL = 2000
/** T-states in one unit of the timer period. */
export const TIMER_UNIT = 256

export const STEP_OK = 0
/** The program has ended. */
export const STEP_HALT = 1
/** Waiting for input; nothing ran. */
export const STEP_WAIT = 2
/** An interrupt was taken in place of an instruction. */
export const STEP_INTERRUPT = 3

/** Small machine fields the history records by index; see Z80Machine.field. */
export const FIELD_HALTED = 0
export const FIELD_NMI = 1
export const FIELD_INPUT_INDEX = 2
export const FIELD_KEY = 3
export const FIELD_PENDING = 4
export const FIELD_CONTROL = 5
export const FIELD_PERIOD = 6
export const FIELD_WAITING = 7
export const FIELD_LISTENING = 8
export const FIELD_EXIT = 9
export const FIELD_TICKED = 10
export const FIELD_SLEEPING = 11
export const FIELD_COUNT = 12

/** The console, keyboard and timer. */
export class Z80Console extends BufferedConsole {
	/** The character that arrived and is not yet read, or -1. */
	key = -1
	/** IRQ_* bits requested and not yet taken. */
	pending = 0
	/** IRQ_* bits enabled. */
	control = 0
	/** Timer period in TIMER_UNITs; 0 is stopped. */
	period = 0
	/** T-state the timer fires at next. */
	timerDue = 0
	/** T-state the next typed character may arrive at. */
	keyDue = 0
	/** The program has looked for input, so typing is worth offering. */
	listening = false
	/** The exit code written to +3, or -1. */
	exitCode = -1
	/** The timer fired since the status was last read. */
	ticked = false

	constructor(private readonly clock: () => number) { super() }

	clear() {
		this.output = this.input = ''
		this.inputIndex = this.pending = this.control = this.period = this.timerDue = this.keyDue = 0
		this.key = this.exitCode = -1
		this.waiting = this.listening = this.ticked = false
	}


	/** Typed characters not yet arrived. */
	get queued(): boolean {
		return this.inputIndex < this.input.length
	}

	/** Typed characters waiting to be read, arrived or not. */
	get typed(): boolean {
		return this.key >= 0 || this.queued
	}

	/** Lets a character arrive and the timer fire, as of now. */
	tick() {
		const now = this.clock()
		if (this.key < 0 && this.queued && now >= this.keyDue) {
			this.key = this.input.charCodeAt(this.inputIndex++) & 0xFF
			if (this.control & IRQ_KEYBOARD) this.pending |= IRQ_KEYBOARD
			this.keyDue = now + KEY_INTERVAL
		}
		if (this.period && now >= this.timerDue) {
			const span = this.period * TIMER_UNIT
			this.timerDue += Math.ceil((now - this.timerDue + 1) / span) * span
			this.ticked = true
			if (this.control & IRQ_TIMER) this.pending |= IRQ_TIMER
		}
	}

	/** The next character: the one that arrived, else the next typed; -1 when none. */
	private take(): number {
		let code = this.key
		if (code >= 0) {
			this.key = -1
			this.pending &= ~IRQ_KEYBOARD
		} else if (this.queued) {
			code = this.input.charCodeAt(this.inputIndex++) & 0xFF
			this.keyDue = this.clock() + KEY_INTERVAL
		}
		return code
	}

	read(offset: number): number {
		switch (offset) {
			case DEVICE_INPUT: {
				this.listening = true
				return Math.max(0, this.take())
			}
			case DEVICE_STATUS: {
				this.listening = true
				const status = (this.typed ? 1 : 0) | 2 | (this.ticked ? 4 : 0)
				this.ticked = false
				return status
			}
			case DEVICE_TIMER: return this.period
			case DEVICE_READ_WAIT: {
				const code = this.take()
				this.waiting = code < 0
				return Math.max(0, code)
			}
			default: return 0
		}
	}

	write(offset: number, value: number) {
		switch (offset) {
			case DEVICE_OUTPUT:
				this.output += String.fromCharCode(value)
				return
			case DEVICE_STATUS:
				this.control = value & (IRQ_KEYBOARD | IRQ_TIMER)
				this.pending &= this.control
				if (this.control & IRQ_KEYBOARD) {
					this.listening = true
					// A character that arrived while it was off asks now.
					if (this.key >= 0) this.pending |= IRQ_KEYBOARD
				}
				return
			case DEVICE_EXIT:
				this.exitCode = value
				return
			case DEVICE_TIMER:
				this.period = value
				this.timerDue = this.clock() + value * TIMER_UNIT
				return
		}
	}
}

/** Resets `cpu` and copies the image into memory; the PC starts at the image's entry. */
export function loadProgram(cpu: Z80Cpu, image: ProgramImage) {
	cpu.reset()
	for (const section of image.sections) cpu.loadBytes(section.address, section.bytes)
	cpu.pc = (image.entryAddress ?? 0) & 0xFFFF
}

export interface Z80MachineOptions {
	/** Entries of history to keep; 0 for none. */
	historyLimit?: number
}

const isDevice = (address: number) => (address & 0xFFF8) === DEVICE_BASE

/**
 * The CPU with its console, halt state, shadow call stack and optional
 * history. Every state change of a step goes through the history, so it can
 * rewind any of them.
 */
export class Z80Machine {
	readonly cpu = new Z80Cpu()
	readonly console = new Z80Console(() => this.cpu.cycles)
	readonly callStack = new Z80CallStack()
	readonly history: Z80History | null
	/** The program has ended. */
	halted = false
	/** A non-maskable interrupt is waiting to be taken. */
	nmiPending = false
	/** HALT is waiting for a character to be typed. */
	sleeping = false
	/** Instructions retired since the program loaded. */
	instructionCount = 0
	/** The CPU state before the instruction running, for a read that has to wait. */
	private readonly before = new Int32Array(SLOT_COUNT)

	constructor(options: Z80MachineOptions = {}) {
		const console = this.console
		const bus: Z80Bus = {
			readDevice: (address) => isDevice(address) ? console.read(address & 7) : undefined,
			writeDevice: (address, value) => {
				if (!isDevice(address)) return false
				console.write(address & 7, value)
				return true
			},
			input: (port) => (port & 0xF8) === 0 ? console.read(port & 7) : 0xFF,
			output: (port, value) => {
				if ((port & 0xF8) === 0) console.write(port & 7, value)
			},
		}
		this.cpu.bus = bus
		const limit = options.historyLimit ?? 0
		this.history = limit > 0 ? new Z80History(this, limit) : null
		this.cpu.sink = this.history
		this.callStack.sink = this.history
	}

	/** Loads an image and forgets history, call stack, halt and console. */
	load(image: ProgramImage) {
		loadProgram(this.cpu, image)
		this.halted = this.nmiPending = this.sleeping = false
		this.instructionCount = 0
		this.console.clear()
		this.callStack.clear()
		this.history?.clear()
	}

	/** One of the FIELD_* values, as a number. */
	field(field: number): number {
		const console = this.console
		switch (field) {
			case FIELD_HALTED: return this.halted ? 1 : 0
			case FIELD_NMI: return this.nmiPending ? 1 : 0
			case FIELD_INPUT_INDEX: return console.inputIndex
			case FIELD_KEY: return console.key
			case FIELD_PENDING: return console.pending
			case FIELD_CONTROL: return console.control
			case FIELD_PERIOD: return console.period
			case FIELD_WAITING: return console.waiting ? 1 : 0
			case FIELD_LISTENING: return console.listening ? 1 : 0
			case FIELD_EXIT: return console.exitCode
			case FIELD_TICKED: return console.ticked ? 1 : 0
			case FIELD_SLEEPING: return this.sleeping ? 1 : 0
		}
		throw new RangeError(`No machine field ${field}`)
	}

	setField(field: number, value: number) {
		const console = this.console
		switch (field) {
			case FIELD_HALTED: this.halted = value !== 0; return
			case FIELD_NMI: this.nmiPending = value !== 0; return
			case FIELD_INPUT_INDEX: console.inputIndex = value; return
			case FIELD_KEY: console.key = value; return
			case FIELD_PENDING: console.pending = value; return
			case FIELD_CONTROL: console.control = value; return
			case FIELD_PERIOD: console.period = value; return
			case FIELD_WAITING: console.waiting = value !== 0; return
			case FIELD_LISTENING: console.listening = value !== 0; return
			case FIELD_EXIT: console.exitCode = value; return
			case FIELD_TICKED: console.ticked = value !== 0; return
			case FIELD_SLEEPING: this.sleeping = value !== 0; return
		}
		throw new RangeError(`No machine field ${field}`)
	}

	/** Whether anything could ever end a HALT. */
	private canWake(): boolean {
		const { control, period } = this.console
		return this.nmiPending || (this.cpu.iff1 !== 0 && ((control & IRQ_TIMER) !== 0 && period > 0 || (control & IRQ_KEYBOARD) !== 0))
	}

	/** Asks for a non-maskable interrupt, taken before the next instruction. */
	nmi() {
		this.history?.begin()
		this.nmiPending = true
		this.halted = false
		this.history?.end()
	}

	/** One step: an interrupt, an instruction, or a stretch of HALT; returns a STEP_* code. */
	step(): number {
		if (this.halted) return STEP_HALT
		const cpu = this.cpu
		const console = this.console
		const history = this.history
		history?.begin()
		console.tick()
		this.sleeping = false
		const status = this.nmiPending || (cpu.interruptible && (console.pending & console.control))
			? this.takeInterrupt()
			: cpu.halted ? this.sleep() : this.execute()
		history?.end()
		return status
	}

	private takeInterrupt(): number {
		const cpu = this.cpu
		const console = this.console
		const site = cpu.pc
		const returnAddress = (site + cpu.halted) & 0xFFFF
		let data = -1
		if (this.nmiPending) {
			this.nmiPending = false
			cpu.nmi()
		} else {
			const requests = console.pending & console.control
			const source = requests & IRQ_TIMER ? IRQ_TIMER : IRQ_KEYBOARD
			console.pending &= ~source
			data = source === IRQ_TIMER ? TIMER_DATA : KEYBOARD_DATA
			cpu.interrupt(data)
		}
		this.history?.interrupted(data)
		this.callStack.push(site, returnAddress, cpu.pc, cpu.sp)
		return STEP_INTERRUPT
	}

	/** HALT: skip to the next event that could interrupt, wait for typing, or end. */
	private sleep(): number {
		const cpu = this.cpu
		const console = this.console
		if (!this.canWake()) {
			this.halted = true
			return STEP_HALT
		}
		let due = Infinity
		if ((console.control & IRQ_TIMER) && console.period) due = console.timerDue
		if ((console.control & IRQ_KEYBOARD) && console.queued) due = Math.min(due, console.keyDue)
		if (due === Infinity) {
			this.sleeping = true
			return STEP_WAIT
		}
		// The NOPs HALT runs until then: four T-states and one R each.
		const nops = Math.max(1, Math.ceil((due - cpu.cycles) / 4))
		cpu.cycles += nops * 4
		cpu.r = (cpu.r & 0x80) | ((cpu.r + nops) & 0x7F)
		return STEP_OK
	}

	private execute(): number {
		const cpu = this.cpu
		const console = this.console
		const before = this.before
		const pc = cpu.pc
		cpu.snapshot(before)
		const cycles = cpu.cycles
		cpu.step()
		if (console.waiting) {
			// The read found nothing, so the instruction has not run.
			for (let slot = 0; slot < SLOT_COUNT; slot++) cpu.setSlot(slot, before[slot])
			cpu.cycles = cycles
			return STEP_WAIT
		}
		this.instructionCount++
		this.observeCall(pc)
		if (console.exitCode >= 0 || (cpu.halted && !this.canWake())) {
			this.halted = true
			return STEP_HALT
		}
		return STEP_OK
	}

	/** Pushes or pops the shadow call stack for the instruction just run at `pc`. */
	private observeCall(pc: number) {
		const cpu = this.cpu
		const memory = cpu.memory
		let at = pc
		let opcode = memory[at]
		while (opcode === 0xDD || opcode === 0xFD) opcode = memory[at = (at + 1) & 0xFFFF]
		const next = cpu.pc
		if (opcode === 0xCD || (opcode & 0xC7) === 0xC4) {
			const after = (at + 3) & 0xFFFF
			if (next !== after) this.callStack.push(pc, after, next, cpu.sp)
		} else if ((opcode & 0xC7) === 0xC7) {
			this.callStack.push(pc, (at + 1) & 0xFFFF, next, cpu.sp)
		} else if (opcode === 0xC9 || (opcode & 0xC7) === 0xC0 || (opcode === 0xED && (memory[(at + 1) & 0xFFFF] & 0xC7) === 0x45)) {
			this.callStack.returnTo(next)
		}
	}

	/** A user's change to a register slot, recorded as an edit entry. */
	editSlot(slot: number, value: number): boolean {
		return this.edit(() => {
			this.cpu.setSlot(slot, value)
			// Moving the PC lets an ended program carry on from there.
			if (slot === SLOT_PC) this.halted = false
		})
	}

	/** Rewrites `bytes` of memory from `address` as one edit; false past the end of memory. */
	editBytes(address: number, bytes: ArrayLike<number>): boolean {
		if (address < 0 || address + bytes.length > this.cpu.memory.length) return false
		return this.edit(() => {
			for (let offset = 0; offset < bytes.length; offset++) this.cpu.poke(address + offset, bytes[offset])
		})
	}

	private edit(change: () => void): boolean {
		return deltaHistoryEdit(change, this.history, () => { this.history?.beginEdit() })
	}
}
