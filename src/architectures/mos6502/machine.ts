/**
 * A 6502 with its I/O page, interrupt lines, shadow call stack and optional
 * history.
 *
 * Interrupts are taken at instruction boundaries, an NMI first: the timer
 * raises one each time it fires with ENABLE_TIMER_NMI set, and `nmi()` raises
 * one by hand. IRQ is a level: it is taken whenever an enabled source holds it
 * and I is clear. Each takes seven cycles and counts as no instruction.
 *
 * Loading copies the image into a cleared memory and resets the CPU through
 * the RESET vector. When the image leaves the IRQ/BRK vector unwritten, BRK
 * halts instead, as a program with no handler expects.
 */

import type { ProgramImage } from '../contracts'
import { Mos6502CallStack } from './callStack'
import { Mos6502Cpu, STEP_FAULT, STEP_HALT, STEP_INTERRUPT, STEP_OK, STEP_WAIT, VECTOR_IRQ, VECTOR_NMI, FLAG_I } from './cpu'
import { ENABLE_TIMER, ENABLE_TIMER_NMI, Mos6502Device } from './device'
import { ENTRY_EDIT, Mos6502History } from './history'
import type { CpuModel } from './isa'

export interface Mos6502MachineOptions {
	model?: CpuModel
	/** D takes effect; off models the NES 2A03. */
	decimal?: boolean
	/** Entries of history to keep; 0 for none. */
	historyLimit?: number
}

/** Whether `image` writes the byte at `address`. */
const covers = (image: ProgramImage, address: number) =>
	image.sections.some((section) => address >= section.address && address < section.address + section.bytes.length)

export class Mos6502Machine {
	readonly cpu: Mos6502Cpu
	readonly device: Mos6502Device
	readonly callStack = new Mos6502CallStack()
	readonly history: Mos6502History | null
	halted = false
	/** The byte written to $F003, or -1 while the program has not exited that way. */
	exitCode = -1
	nmiPending = false
	/** Instructions retired since the program loaded. */
	instructionCount = 0

	constructor(options: Mos6502MachineOptions = {}) {
		this.cpu = new Mos6502Cpu(options.model)
		this.cpu.decimal = options.decimal ?? true
		this.device = new Mos6502Device(this.cpu)
		this.cpu.io = this.device
		const limit = options.historyLimit ?? 0
		this.history = limit > 0 ? new Mos6502History(this, limit) : null
		this.cpu.sink = this.history
		this.callStack.sink = this.history
	}

	/** Loads an image into cleared memory and resets; forgets history, call stack and halt. */
	load(image: ProgramImage) {
		const cpu = this.cpu
		cpu.memory.fill(0)
		for (const section of image.sections) cpu.loadBytes(section.address, section.bytes)
		cpu.brkHalts = !covers(image, VECTOR_IRQ) && !covers(image, VECTOR_IRQ + 1)
		cpu.reset()
		this.device.reset()
		this.halted = false
		this.exitCode = -1
		this.nmiPending = false
		this.instructionCount = 0
		this.callStack.clear()
		this.history?.clear()
	}

	/** Raises an NMI, taken before the next instruction. */
	nmi() {
		this.nmiPending = true
	}

	/**
	 * One step: an interrupt taken, or one instruction run; returns a STEP_*
	 * code. Once halted, stays halted.
	 */
	step(): number {
		if (this.halted) return STEP_HALT
		const cpu = this.cpu
		const device = this.device
		const history = this.history
		history?.begin()
		device.waiting = false
		if (cpu.sleeping && !this.nmiPending && !device.irq) {
			// The clock/device timer continues while WAI suspends instruction fetch.
			if (device.period > 0 && (device.control & (ENABLE_TIMER | ENABLE_TIMER_NMI))) {
				const clocks = Math.max(1, device.timer)
				cpu.cycles += clocks
				this.tick(clocks)
			} else {
				history?.end()
				return STEP_WAIT
			}
		}
		if (cpu.sleeping && device.irq) cpu.sleeping = false
		if (this.nmiPending || (device.irq && !(cpu.p & FLAG_I))) {
			const vector = this.nmiPending ? VECTOR_NMI : VECTOR_IRQ
			this.nmiPending = false
			history?.interrupted(vector)
			const before = cpu.cycles
			cpu.interrupt(vector)
			this.tick(cpu.cycles - before)
			history?.end()
			return STEP_INTERRUPT
		}
		const pc = cpu.pc
		const before = cpu.cycles
		const status = cpu.step()
		if (status === STEP_OK) {
			this.callStack.observe(cpu.opcode, pc, cpu.pc, cpu.sp)
			this.instructionCount++
			if (cpu.stopped) this.halted = true
			this.tick(cpu.cycles - before)
			if (device.haltRequest >= 0) {
				this.exitCode = device.haltRequest
				device.haltRequest = -1
				this.halted = true
			}
		} else if (status === STEP_HALT) {
			this.halted = true
		}
		history?.end()
		return status
	}

	private tick(cycles: number) {
		if (this.device.tick(cycles) && (this.device.control & ENABLE_TIMER_NMI)) this.nmiPending = true
	}

	/** Steps while each runs or interrupts, or `limit` steps; returns the last code. */
	run(limit: number): number {
		let status = STEP_OK
		for (let steps = 0; steps < limit && (status === STEP_OK || status === STEP_INTERRUPT); steps++) status = this.step()
		return status
	}

	/** A user's change to a register, flag bits included in P; recorded as an edit entry. */
	editRegister(change: (cpu: Mos6502Cpu) => void): boolean {
		return this.edit(() => change(this.cpu))
	}

	/** Moves the PC by hand; leaves halt, so the program can carry on from there. */
	editPc(value: number): boolean {
		return this.edit(() => {
			this.cpu.pc = value & 0xFFFF
			this.halted = false
			this.cpu.sleeping = false
			this.cpu.stopped = false
		})
	}

	/** Rewrites `bytes` of memory from `address` as one edit; false when any lies outside memory. */
	editBytes(address: number, bytes: ArrayLike<number>): boolean {
		const memory = this.cpu.memory
		if (address < 0 || address + bytes.length > memory.length) return false
		return this.edit(() => {
			for (let index = 0; index < bytes.length; index++) {
				this.history?.memory(address + index, memory[address + index])
				memory[address + index] = bytes[index] & 0xFF
			}
		})
	}

	private edit(change: () => void): boolean {
		this.history?.begin(ENTRY_EDIT)
		change()
		this.history?.end()
		return true
	}
}

export { STEP_FAULT, STEP_HALT, STEP_INTERRUPT, STEP_OK, STEP_WAIT }
