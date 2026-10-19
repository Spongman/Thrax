/**
 * An AArch32 user program as Linux would run it under the ARM EABI, in User
 * mode with no MMU: `svc #0` with the number in R7, arguments in R0-R2 and
 * the result in R0 (negative errno on failure):
 *
 * - 3 read(fd, buf, count): fd 0 only. Returns what typed input is queued,
 *   up to `count` bytes; with none it waits, the PC staying on the SVC.
 * - 4 write(fd, buf, count): fd 1 and 2 append to the console.
 * - 1 exit(status) and 248 exit_group(status): the program halts.
 * - 45 brk(addr): moves the program break, which starts after the data;
 *   brk(0) reads it. A break the stack has reached is refused.
 * Any other number stops the program with an error.
 *
 * Memory, the stack and MARS's keyboard and display at 0xFFFF0000 are laid
 * out as for the AArch64 state (see ../a64/layout.ts).
 */

import { conditionPassed } from '../../arm/a32/alu'
import type { ProgramImage } from '../../contracts'
import { DATA_BASE, TEXT_BASE } from '../a64/layout'
import { A64Keyboard } from '../a64/machine'
import { A32CallStack } from './callStack'
import { A32Cpu, STEP_FAULT, STEP_HALT, STEP_OK, STEP_WAIT, SVC_HALT, SVC_NEXT, SVC_REFUSED, SVC_WAIT, type A32Supervisor } from './cpu'
import { A32History, ENTRY_EDIT } from './history'

export const SYS_EXIT = 1
export const SYS_READ = 3
export const SYS_WRITE = 4
export const SYS_BRK = 45
export const SYS_EXIT_GROUP = 248

const EBADF = 9
const EFAULT = 14
const CR = 13
const LF = 10
const R_SP = 13

/** Room left between the program break and the stack pointer. */
const BREAK_GUARD = 4096

/** The Linux system calls, attached to the CPU as its supervisor. */
export class A32Linux implements A32Supervisor {
	output = ''
	/** Everything ever typed, kept so a rewound run reads the same characters again. */
	input = ''
	inputIndex = 0
	/** True while a read waits for input. */
	waiting = false
	/** The exit status, once the program has exited; -1 before. */
	exitCode = -1
	/** The first address past the heap. */
	programBreak = 0
	/** Where the break started: the end of the data, rounded up. */
	initialBreak = 0

	feed(text: string) {
		this.input += text
	}

	call(cpu: A32Cpu): number {
		const number = cpu.r[7]
		const [a0, a1, a2] = [cpu.r[0], cpu.r[1] >>> 0, cpu.r[2] >>> 0]
		switch (number) {
			case SYS_WRITE: {
				if (a0 !== 1 && a0 !== 2) return this.result(cpu, -EBADF)
				const at = cpu.offsetOf(a1, a2)
				if (a2 > 0 && at < 0) return this.result(cpu, -EFAULT)
				let text = ''
				for (let index = 0; index < a2; index++) text += String.fromCharCode(cpu.memory[at + index])
				this.output += text
				return this.result(cpu, a2)
			}
			case SYS_READ: {
				if (a0 !== 0) return this.result(cpu, -EBADF)
				if (a2 === 0) return this.result(cpu, 0)
				const available = this.input.length - this.inputIndex
				if (available === 0) {
					this.waiting = true
					return SVC_WAIT
				}
				const count = Math.min(a2, available)
				if (cpu.offsetOf(a1, count) < 0) return this.result(cpu, -EFAULT)
				for (let index = 0; index < count; index++) {
					const code = this.input.charCodeAt(this.inputIndex++) & 0xFF
					cpu.store(a1 + index, 1, code === CR ? LF : code)
				}
				this.waiting = false
				return this.result(cpu, count)
			}
			case SYS_EXIT: case SYS_EXIT_GROUP:
				this.exitCode = a0 & 0xFF
				return SVC_HALT
			case SYS_BRK: {
				const limit = (cpu.r[R_SP] >>> 0) - BREAK_GUARD
				const wanted = a0 >>> 0
				if (wanted >= this.initialBreak && wanted <= limit) this.programBreak = wanted
				return this.result(cpu, this.programBreak)
			}
		}
		cpu.faultDetail = `Unsupported system call ${number} (r7)`
		return SVC_REFUSED
	}

	private result(cpu: A32Cpu, value: number): number {
		cpu.writeRegister(0, value | 0)
		return SVC_NEXT
	}
}

export interface A32MachineOptions {
	/** Bytes of memory from TEXT_BASE. */
	memoryBytes: number
	/** Entries of history to keep; 0 for none. */
	historyLimit?: number
}

/** The end of the image's data, rounded up to 16: where the program break starts. */
function breakOf(image: ProgramImage): number {
	const end = Math.max(DATA_BASE, ...image.sections.map((section) => section.address + section.bytes.length))
	return Math.ceil(end / 16) * 16
}

/** Whether `word`, run under the flags `cpsr`, was a BL or BLX to a register that ran. */
function isCall(word: number, cpsr: number): boolean {
	const call = (word & 0x0F000000) === 0x0B000000 || (word & 0x0FFFFFF0) === 0x012FFF30
	return call && word >>> 28 !== 15 && conditionPassed(word >>> 28, cpsr)
}

/**
 * A CPU with its system calls, devices, halt state, shadow call stack and
 * optional history. Every state change goes through the history, so it can
 * rewind any of them.
 */
export class A32Machine {
	readonly cpu: A32Cpu
	readonly linux = new A32Linux()
	readonly keyboard = new A64Keyboard()
	readonly callStack = new A32CallStack()
	readonly history: A32History | null
	halted = false
	instructionCount = 0

	constructor(options: A32MachineOptions) {
		this.cpu = new A32Cpu({ base: TEXT_BASE, bytes: options.memoryBytes })
		this.cpu.supervisor = this.linux
		this.cpu.device = this.keyboard
		const limit = options.historyLimit ?? 0
		this.history = limit > 0 ? new A32History(this, limit) : null
		this.cpu.sink = this.history
		this.callStack.sink = this.history
	}

	/** One past the last byte of memory, where SP starts. */
	get top(): number {
		return this.cpu.base + this.cpu.memory.length
	}

	/** Loads an image, points SP at the top of memory, and forgets history, call stack and halt. */
	load(image: ProgramImage) {
		const cpu = this.cpu
		cpu.memory.fill(0)
		cpu.reset()
		for (const section of image.sections) cpu.loadBytes(section.address, section.bytes)
		cpu.pc = image.entryAddress ?? TEXT_BASE
		cpu.r[R_SP] = this.top
		this.halted = false
		this.instructionCount = 0
		const linux = this.linux
		linux.output = ''
		linux.input = ''
		linux.inputIndex = 0
		linux.waiting = false
		linux.exitCode = -1
		linux.initialBreak = linux.programBreak = breakOf(image)
		this.keyboard.keyIndex = 0
		this.keyboard.queued = ''
		this.keyboard.display = ''
		this.callStack.clear()
		this.history?.clear()
	}

	/** One instruction; returns a STEP_* code. Once halted, stays halted. */
	step(): number {
		if (this.halted) return STEP_HALT
		const { cpu, history } = this
		history?.begin()
		const pc = cpu.pc
		const cpsr = cpu.cpsr
		const status = cpu.step()
		if (status === STEP_OK) this.callStack.observe(isCall(cpu.instruction, cpsr), pc, cpu.pc, cpu.r[R_SP] >>> 0)
		else if (status === STEP_HALT) this.halted = true
		if (status !== STEP_WAIT && status !== STEP_FAULT) this.instructionCount++
		history?.end()
		return status
	}

	/** Steps while each runs, or `limit` steps; returns the last code. */
	run(limit: number): number {
		let status = STEP_OK
		for (let steps = 0; steps < limit && status === STEP_OK; steps++) status = this.step()
		return status
	}

	/** A user's change to R0-R14, recorded as an edit entry. */
	editRegister(index: number, value: number): boolean {
		if (!(index >= 0 && index < 15)) return false
		return this.edit(() => this.cpu.writeRegister(index, value | 0))
	}

	/** The CPSR as a user may set it: the flags, Q and GE; the mode stays USR. */
	editCpsr(value: number): boolean {
		return this.edit(() => this.cpu.setCpsr((this.cpu.cpsr & 0x07F0FFFF) | (value & 0xF80F0000)))
	}

	/** Moves the PC by hand; leaves halt, so the program can carry on from there. */
	editPc(value: number): boolean {
		return this.edit(() => {
			this.cpu.setPc(value)
			this.halted = false
		})
	}

	/** Rewrites `bytes` of memory from `address` as one edit; false when any lies outside memory. */
	editBytes(address: number, bytes: ArrayLike<number>): boolean {
		if (bytes.length === 0 || this.cpu.offsetOf(address, bytes.length) < 0) return false
		return this.edit(() => {
			for (let index = 0; index < bytes.length; index++) this.cpu.store(address + index, 1, bytes[index] & 0xFF)
		})
	}

	private edit(change: () => void): boolean {
		this.history?.begin(ENTRY_EDIT)
		change()
		this.history?.end()
		return true
	}
}
