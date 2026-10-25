/**
 * A memory-mapped keyboard and display above RAM, for the shared Keyboard and
 * Display tool.  Four words, at the top of the 26-bit address space:
 *
 *   KBD_STATUS  0x03FF0000  bit 0: a key is waiting; bit 1: interrupt enable (R/W)
 *   KBD_DATA    0x03FF0004  the next key; reading takes it
 *   TTY_STATUS  0x03FF0008  bit 0: always ready
 *   TTY_DATA    0x03FF000C  writing shows the low byte on the display
 *
 * With bit 1 of KBD_STATUS set, a waiting key holds IRQ asserted until it is
 * read, taken when I is clear and the IRQ vector is programmed.
 */

import type { KeyboardDisplayDevice, KeyboardDisplayState } from '../../contracts'
import type { Arm26Io } from './cpu'

export const KBD_BASE = 0x03FF0000
export const KBD_STATUS = KBD_BASE
export const KBD_DATA = KBD_BASE + 4
export const TTY_STATUS = KBD_BASE + 8
export const TTY_DATA = KBD_BASE + 12

const READY = 1
const INTERRUPT_ENABLE = 2

export class Arm26Keyboard implements Arm26Io, KeyboardDisplayDevice {
	readonly base = KBD_BASE
	readonly size = 16
	/** Everything ever typed; `inputIndex` is the next key. */
	input = ''
	inputIndex = 0
	display = ''
	interruptEnable = false

	/** Whether the keyboard is asking for an interrupt. */
	get irq(): boolean {
		return this.interruptEnable && this.inputIndex < this.input.length
	}

	read(address: number): number {
		switch (address) {
			case KBD_STATUS: return (this.inputIndex < this.input.length ? READY : 0) | (this.interruptEnable ? INTERRUPT_ENABLE : 0)
			case KBD_DATA: return this.inputIndex < this.input.length ? this.input.charCodeAt(this.inputIndex++) & 0xFF : 0
			case TTY_STATUS: return READY
			default: return 0
		}
	}

	write(address: number, value: number) {
		if (address === KBD_STATUS) this.interruptEnable = (value & INTERRUPT_ENABLE) !== 0
		else if (address === TTY_DATA) this.display += String.fromCharCode(value & 0xFF)
	}

	state(): KeyboardDisplayState {
		return { queuedInput: this.input.slice(this.inputIndex), displayOutput: this.display }
	}

	queue(text: string) {
		this.input += text
	}
}
