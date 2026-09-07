/**
 * Digital Lab Simulator.
 *
 * A memory-mapped device with three parts, each a byte in the memory-mapped
 * region: two seven-segment displays a program lights segment by segment, a
 * hexadecimal keypad it scans a row at a time, and a counter that raises a
 * timer interrupt every so many instructions.
 *
 * It reads what the program wrote and writes what the program will read, so it
 * needs the device port rather than the observer interface alone.
 */

import type { DevicePort, ExecutionObserver, MachineConfig } from '../core/observer'
import type { MachineService, ServiceRecorder, ServiceState } from '../core/service'

/** Offsets from the memory-mapped region's base, as the exercises use them. */
export const DISPLAY_RIGHT_OFFSET = 0x10
export const DISPLAY_LEFT_OFFSET = 0x11
export const KEYPAD_ROW_OFFSET = 0x12
export const COUNTER_OFFSET = 0x13
export const KEYPAD_OUT_OFFSET = 0x14

/**
 * Cause codes the two interrupts raise.  Shifted two places into the cause
 * register they land on bits 10 and 11, past the bits the keyboard and display
 * claim, so a handler can tell all four apart.
 */
export const TIMER_INTERRUPT = 0x00000100
export const KEYPAD_INTERRUPT = 0x00000200

/** Instructions between timer interrupts, as MARS counts them. */
export const COUNTER_PERIOD = 30

/** The seven segments and the point, by the bit that lights each. */
export const SEGMENTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'point'] as const

export interface DigitalLabState {
	/** Segment bits of the right and left displays. */
	displays: [number, number]
	/** The row the program last selected, and whether it enabled the interrupt. */
	keypadRow: number
	keypadInterruptEnabled: boolean
	/** Which key is held, 0-15, or null. */
	pressedKey: number | null
	/** What the program reads back: row and column of the key, or 0. */
	keypadOut: number
	counterEnabled: boolean
	counterRemaining: number
	/** Interrupts raised so far, which is what a program under test counts. */
	timerInterrupts: number
	keypadInterrupts: number
}

/**
 * What the program reads back for a held key: the row it is in, and the column
 * shifted into the high nibble.  Key 2 sits in column 3 of row 1 and so reads
 * back as 0x41.
 */
export function keypadCode(key: number): number {
	return (1 << Math.floor(key / 4)) | (1 << (4 + (key % 4)))
}

/** Whether the row the program selected is the one the held key is in. */
export function keyInRow(key: number, row: number): boolean {
	return (1 << Math.floor(key / 4)) === (row & 0xf)
}

/**
 * What the lab calls the parts of itself in the records it keeps.  Every one of
 * them is a number or reads as one, so a change costs a row of the machine's
 * columns and nothing is copied.
 */
const SLOT_DISPLAY_RIGHT = 0
const SLOT_DISPLAY_LEFT = 1
const SLOT_KEYPAD_ROW = 2
const SLOT_KEYPAD_INTERRUPT = 3
const SLOT_PRESSED_KEY = 4
const SLOT_KEYPAD_OUT = 5
const SLOT_COUNTER_ENABLED = 6
const SLOT_COUNTER_REMAINING = 7
const SLOT_TIMER_INTERRUPTS = 8
const SLOT_KEYPAD_INTERRUPTS = 9

/** No key held, as a number, since a slot holds one. */
const NO_KEY = -1

export class DigitalLabSim implements ExecutionObserver, MachineService {
	readonly name = 'Digital Lab'
	/** Where changes are filed, once the machine has offered somewhere. */
	private recorder: ServiceRecorder | null = null
	private port: DevicePort | null = null
	private base = 0xffff0000
	private state: DigitalLabState = freshState()
	/**
	 * The last cause the machine accepted, which is what a panel shows.  The
	 * interrupt itself is the machine's, not the tool's: this is a record of it.
	 */
	lastInterrupt: number | null = null

	onConfigure(machine: MachineConfig & { memoryMapBase?: number }) {
		this.port = machine.device ?? null
		if (machine.memoryMapBase !== undefined) this.base = machine.memoryMapBase
		this.recorder = machine.services?.register(this) ?? null
	}

	/** What one slot holds now. */
	private read(slot: number): number {
		const state = this.state
		switch (slot) {
			case SLOT_DISPLAY_RIGHT: return state.displays[0]
			case SLOT_DISPLAY_LEFT: return state.displays[1]
			case SLOT_KEYPAD_ROW: return state.keypadRow
			case SLOT_KEYPAD_INTERRUPT: return state.keypadInterruptEnabled ? 1 : 0
			case SLOT_PRESSED_KEY: return state.pressedKey ?? NO_KEY
			case SLOT_KEYPAD_OUT: return state.keypadOut
			case SLOT_COUNTER_ENABLED: return state.counterEnabled ? 1 : 0
			case SLOT_COUNTER_REMAINING: return state.counterRemaining
			case SLOT_TIMER_INTERRUPTS: return state.timerInterrupts
			default: return state.keypadInterrupts
		}
	}

	private write(slot: number, value: number) {
		const state = this.state
		switch (slot) {
			case SLOT_DISPLAY_RIGHT: state.displays[0] = value; return
			case SLOT_DISPLAY_LEFT: state.displays[1] = value; return
			case SLOT_KEYPAD_ROW: state.keypadRow = value; return
			case SLOT_KEYPAD_INTERRUPT: state.keypadInterruptEnabled = value !== 0; return
			case SLOT_PRESSED_KEY: state.pressedKey = value === NO_KEY ? null : value; return
			case SLOT_KEYPAD_OUT: state.keypadOut = value; return
			case SLOT_COUNTER_ENABLED: state.counterEnabled = value !== 0; return
			case SLOT_COUNTER_REMAINING: state.counterRemaining = value; return
			case SLOT_TIMER_INTERRUPTS: state.timerInterrupts = value; return
			default: state.keypadInterrupts = value
		}
	}

	/** Changes a slot, having first said what it held. */
	private set(slot: number, value: number) {
		if (this.read(slot) === value) return
		this.recorder?.keep(slot, this.read(slot))
		this.write(slot, value)
	}

	/**
	 * Puts one slot back and hands over what it held instead, so the same record
	 * serves going back and going forward.
	 */
	exchange(slot: number, value: number): ServiceState {
		const held = this.read(slot)
		this.write(slot, value)
		return { value: held }
	}

	onReset() {
		this.state = freshState()
		this.lastInterrupt = null
	}

	/** The program writing one of the device's bytes is how it drives the device. */
	onMemoryWrite(address: number, _size: number, value: number) {
		const offset = (address >>> 0) - this.base
		const byte = value & 0xff
		switch (offset) {
			case DISPLAY_RIGHT_OFFSET: this.set(SLOT_DISPLAY_RIGHT, byte); return
			case DISPLAY_LEFT_OFFSET: this.set(SLOT_DISPLAY_LEFT, byte); return
			case KEYPAD_ROW_OFFSET: this.scanRow(byte); return
			case COUNTER_OFFSET: this.setCounter(byte); return
		}
	}

	/** The counter runs on instructions, which is the clock MARS gives it. */
	onInstruction() {
		if (!this.state.counterEnabled) return
		if (this.state.counterRemaining > 0) {
			this.set(SLOT_COUNTER_REMAINING, this.state.counterRemaining - 1)
			return
		}
		this.set(SLOT_COUNTER_REMAINING, COUNTER_PERIOD)
		this.raise(TIMER_INTERRUPT, SLOT_TIMER_INTERRUPTS)
	}

	/**
	 * Selects a keypad row.  The high nibble enables the interrupt, and the
	 * answer goes where the program reads it.
	 */
	private scanRow(row: number) {
		this.set(SLOT_KEYPAD_ROW, row)
		this.set(SLOT_KEYPAD_INTERRUPT, (row & 0xf0) !== 0 ? 1 : 0)
		this.publishKeypad()
	}

	private setCounter(value: number) {
		const enabled = value !== 0
		if (enabled && !this.state.counterEnabled) this.set(SLOT_COUNTER_REMAINING, COUNTER_PERIOD)
		this.set(SLOT_COUNTER_ENABLED, enabled ? 1 : 0)
	}

	/** A key is held until it is released, so a scan of its row finds it. */
	pressKey(key: number | null) {
		this.set(SLOT_PRESSED_KEY, key ?? NO_KEY)
		this.publishKeypad()
		if (key !== null && this.state.keypadInterruptEnabled) this.raise(KEYPAD_INTERRUPT, SLOT_KEYPAD_INTERRUPTS)
	}

	/**
	 * Hands a cause to the machine, which takes it in place of its next
	 * instruction.  Counted only when it is accepted: one the machine refused
	 * because it is already in a handler never reaches the program.
	 */
	private raise(cause: number, counter: number) {
		if (this.port?.interrupt(cause) !== true) return
		this.set(counter, this.read(counter) + 1)
		this.lastInterrupt = cause
	}

	private publishKeypad() {
		const { pressedKey, keypadRow } = this.state
		const answer = pressedKey !== null && keyInRow(pressedKey, keypadRow) ? keypadCode(pressedKey) : 0
		this.set(SLOT_KEYPAD_OUT, answer)
		this.port?.write(this.base + KEYPAD_OUT_OFFSET, answer)
	}

	snapshot(): DigitalLabState {
		return { ...this.state, displays: [...this.state.displays] }
	}
}

function freshState(): DigitalLabState {
	return {
		displays: [0, 0],
		keypadRow: 0,
		keypadInterruptEnabled: false,
		pressedKey: null,
		keypadOut: 0,
		counterEnabled: false,
		counterRemaining: COUNTER_PERIOD,
		timerInterrupts: 0,
		keypadInterrupts: 0,
	}
}
