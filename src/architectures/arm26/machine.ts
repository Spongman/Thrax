import { deltaHistoryEdit } from '../../core/editTransaction'
/**
 * The 26-bit machine: a CPU with RAM from address 0, the RISC OS-style SWI
 * console, the memory-mapped keyboard, a shadow call stack and history.
 *
 * Loading: a program with bytes at address 0 owns the reset vector and starts
 * there as reset leaves the CPU (SVC, I and F set).  Any other starts at its
 * entry in USR mode with interrupts enabled, as an application would.  Either
 * way the stacks start out set: R13_usr at the top of RAM, R13_svc at 0x8000,
 * R13_irq at 0x7000 and R13_fiq at 0x6000, each growing down.
 */

import { conditionPassed } from '../arm/a32/alu'
import type { ProgramImage } from '../contracts'
import { Arm26CallStack } from './callStack'
import {
	Arm26Cpu, BANKS, MODE_FIQ, MODE_IRQ, MODE_SVC, MODE_USR, PC_MASK, PSR_I, PSR_MASK, STEP_FAULT, STEP_HALT, STEP_INTERRUPT, STEP_WAIT, VECTOR_IRQ,
} from './cpu'
import { Arm26History, ENTRY_EDIT } from './history'
import { Arm26Keyboard } from './keyboard'
import { Arm26Os } from './os'
import type { Arm26Model } from './arm3'
import type { Arm26BusTiming } from './busTiming'

/** Where each mode's stack starts. */
export const SVC_STACK = 0x8000
export const IRQ_STACK = 0x7000
export const FIQ_STACK = 0x6000

/** Where programs start unless they say otherwise, as RISC OS loads applications. */
export const TEXT_BASE = 0x8000

/** Where the Bitmap Display looks first, past a program of 32 KB. */
export const DISPLAY_BASE = 0x10000

export interface Arm26MachineOptions {
	memoryBytes: number
	cpuModel?: Arm26Model
	timing?: Readonly<Arm26BusTiming>
	/** Entries of history to keep; 0 for none. */
	historyLimit?: number
}

export class Arm26Machine {
	readonly cpu: Arm26Cpu
	readonly os = new Arm26Os()
	readonly keyboard = new Arm26Keyboard()
	readonly callStack = new Arm26CallStack()
	readonly history: Arm26History | null
	halted = false
	instructionCount = 0

	constructor(options: Arm26MachineOptions) {
		this.cpu = new Arm26Cpu(options.memoryBytes, options.cpuModel, options.timing)
		this.cpu.swi = this.os
		this.cpu.io = this.keyboard
		const limit = options.historyLimit ?? 0
		this.history = limit > 0 ? new Arm26History(this, limit) : null
		this.cpu.sink = this.history
		this.callStack.sink = this.history
	}

	/** Resets, copies the image into memory and starts it. */
	load(image: ProgramImage) {
		const cpu = this.cpu
		cpu.reset()
		cpu.memory.fill(0)
		for (const section of image.sections) cpu.loadBytes(section.address, section.bytes)
		cpu.setPhysical(BANKS[MODE_USR][13], cpu.memory.length)
		cpu.setPhysical(BANKS[MODE_SVC][13], SVC_STACK)
		cpu.setPhysical(BANKS[MODE_IRQ][13], IRQ_STACK)
		cpu.setPhysical(BANKS[MODE_FIQ][13], FIQ_STACK)
		const ownsReset = image.sections.some((section) => section.address === 0 && section.bytes.length > 0)
		if (!ownsReset) {
			cpu.pc = (image.entryAddress ?? TEXT_BASE) & PC_MASK
			cpu.psr = MODE_USR
		}
		this.halted = false
		this.instructionCount = 0
		const { os, keyboard } = this
		os.output = ''
		os.input = ''
		os.inputIndex = 0
		os.waiting = false
		keyboard.input = ''
		keyboard.inputIndex = 0
		keyboard.display = ''
		keyboard.interruptEnable = false
		this.callStack.clear()
		this.history?.clear()
	}

	/** One instruction, or the keyboard's interrupt taken instead; returns a STEP_* code. */
	step(): number {
		if (this.halted) return STEP_HALT
		const { cpu, history } = this
		history?.begin()
		if (this.keyboard.irq && !(cpu.psr & PSR_I) && cpu.vectorSet(VECTOR_IRQ)) {
			history?.interrupted(VECTOR_IRQ)
			cpu.interrupt(VECTOR_IRQ)
			history?.end()
			return STEP_INTERRUPT
		}
		const pc = cpu.pc
		const psr = cpu.psr
		const status = cpu.step()
		if (status === STEP_HALT) {
			this.halted = true
		} else if (status !== STEP_WAIT && status !== STEP_FAULT) {
			const word = cpu.instruction
			const call = (word & 0x0F000000) === 0x0B000000 && conditionPassed(word >>> 28, psr)
			this.callStack.observe(call, pc, cpu.pc, cpu.register(13))
		}
		if (status !== STEP_WAIT && status !== STEP_FAULT) {
			this.instructionCount++
		} else history?.notRetired()
		history?.end()
		return status
	}

	/** Steps while each runs or interrupts, or `limit` steps; returns the last code. */
	run(limit: number): number {
		let status = STEP_INTERRUPT
		for (let steps = 0; steps < limit && (status === STEP_INTERRUPT || status < STEP_FAULT); steps++) status = this.step()
		return status
	}

	/** A user's change to a physical register, recorded as an edit. */
	editRegister(physical: number, value: number): boolean {
		return this.edit(() => {
			this.history?.register(physical, this.cpu.registers[physical])
			this.cpu.setPhysical(physical, value | 0)
		})
	}

	/** Moves the PC by hand; leaves halt, so the program can carry on from there. */
	editPc(address: number): boolean {
		return this.edit(() => {
			this.history?.pc(this.cpu.pc)
			this.cpu.pc = address & PC_MASK
			this.cpu.prefetch.invalidate()
			this.halted = false
		})
	}

	/** Sets the status bits of R15. */
	editPsr(value: number): boolean {
		return this.edit(() => {
			this.history?.psr(this.cpu.psr)
			this.cpu.psr = (value & PSR_MASK) | 0
			this.cpu.prefetch.invalidate()
		})
	}

	/** Rewrites `bytes` of memory from `address` as one edit; false outside memory. */
	editBytes(address: number, bytes: ArrayLike<number>): boolean {
		const memory = this.cpu.memory
		if (address < 0 || address + bytes.length > memory.length) return false
		return this.edit(() => {
			const first = address & ~3
			const last = (address + bytes.length - 1) & ~3
			for (let word = first; word <= last; word += 4) this.history?.memory(word, this.cpu.readWord(word))
			memory.set(Array.from(bytes, (byte) => byte & 0xFF), address)
			this.cpu.cache?.flush()
			this.cpu.prefetch.invalidate()
		})
	}

	private edit(change: () => void): boolean {
		return deltaHistoryEdit(change, this.history, () => { this.history?.begin(ENTRY_EDIT) })
	}
}
