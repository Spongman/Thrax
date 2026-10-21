import { BufferedConsole } from '../../core/console'
/**
 * The console, keyboard and timer in the I/O page at $F000-$F0FF:
 *
 * | address | read                                   | write                                   |
 * |---------|----------------------------------------|-----------------------------------------|
 * | $F000   | 0                                      | print the byte as a character           |
 * | $F001   | next typed character; waits for one    | ignored                                 |
 * | $F002   | status: bit 0 key ready, bit 1 timer   | any value acknowledges the timer        |
 * | $F003   | 0                                      | halt, the byte the exit code            |
 * | $F004   | interrupt enables                      | bit 0 keyboard IRQ, bit 1 timer IRQ,    |
 * |         |                                        | bit 2 timer raises NMI instead          |
 * | $F005   | timer period, low byte                 | sets it and restarts the countdown      |
 * | $F006   | timer period, high byte                | sets it and restarts the countdown      |
 *
 * Every other address of the page reads 0 and ignores writes. A typed CR
 * reads as LF. The timer counts CPU cycles; with a period it sets its flag
 * every `period` cycles, which stays set until acknowledged. The keyboard IRQ
 * is asserted while a key is ready and enabled, the timer's while its flag is
 * set and enabled.
 */

import type { Mos6502Cpu, Mos6502Io } from './cpu'

export const IO_OUT = 0xF000
export const IO_IN = 0xF001
export const IO_STATUS = 0xF002
export const IO_HALT = 0xF003
export const IO_ENABLE = 0xF004
export const IO_PERIOD_LOW = 0xF005
export const IO_PERIOD_HIGH = 0xF006

export const STATUS_KEY = 0x01
export const STATUS_TIMER = 0x02

export const ENABLE_KEYBOARD = 0x01
export const ENABLE_TIMER = 0x02
export const ENABLE_TIMER_NMI = 0x04

const CR = 13
const LF = 10

export class Mos6502Device extends BufferedConsole implements Mos6502Io {
	/** The program looked for input and found none, so typing is worth offering. */
	polled = false
	control = 0
	period = 0
	/** Cycles until the timer next fires. */
	timer = 0
	timerFlag = false
	/** The exit code a write to $F003 asked for, or -1. */
	haltRequest = -1

	constructor(private readonly cpu: Mos6502Cpu) { super() }


	get keyReady(): boolean {
		return this.inputIndex < this.input.length
	}

	/** Whether the IRQ line is held low by an enabled source. */
	get irq(): boolean {
		const control = this.control
		return ((control & ENABLE_KEYBOARD) !== 0 && this.keyReady)
			|| ((control & (ENABLE_TIMER | ENABLE_TIMER_NMI)) === ENABLE_TIMER && this.timerFlag)
	}

	/** Lets `cycles` pass; returns whether the timer fired. */
	tick(cycles: number): boolean {
		if (this.period === 0) return false
		this.timer -= cycles
		if (this.timer > 0) return false
		while (this.timer <= 0) this.timer += this.period
		this.timerFlag = true
		return true
	}

	read(address: number): number {
		switch (address) {
			case IO_IN: {
				if (!this.keyReady) {
					this.waiting = true
					this.polled = true
					this.cpu.waiting = true
					return 0
				}
				const code = this.input.charCodeAt(this.inputIndex++) & 0xFF
				this.waiting = false
				return code === CR ? LF : code
			}
			case IO_STATUS: {
				const status = (this.keyReady ? STATUS_KEY : 0) | (this.timerFlag ? STATUS_TIMER : 0)
				if (!this.keyReady) this.polled = true
				return status
			}
			case IO_ENABLE: return this.control
			case IO_PERIOD_LOW: return this.period & 0xFF
			case IO_PERIOD_HIGH: return this.period >> 8
			default: return 0
		}
	}

	write(address: number, value: number) {
		switch (address) {
			case IO_OUT: this.output += String.fromCharCode(value); break
			case IO_STATUS: this.timerFlag = false; break
			case IO_HALT: this.haltRequest = value; break
			case IO_ENABLE: this.control = value & (ENABLE_KEYBOARD | ENABLE_TIMER | ENABLE_TIMER_NMI); break
			case IO_PERIOD_LOW:
				this.period = (this.period & 0xFF00) | value
				this.timer = this.period
				break
			case IO_PERIOD_HIGH:
				this.period = (this.period & 0xFF) | (value << 8)
				this.timer = this.period
				break
		}
	}

	reset() {
		this.output = ''
		this.input = ''
		this.inputIndex = 0
		this.waiting = false
		this.polled = false
		this.control = 0
		this.period = 0
		this.timer = 0
		this.timerFlag = false
		this.haltRequest = -1
	}
}
