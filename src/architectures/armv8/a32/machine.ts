import { LinuxConsole } from '../../../core/environments/linuxConsole'
import { deltaHistoryEdit } from '../../../core/editTransaction'
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

import { conditionPassed } from '../shared/a32/alu'
import { FPSCR_WRITABLE } from '../shared/a32/vfp'
import type { ProgramImage } from '../../contracts'
import { DATA_BASE, MMIO_BASE, TEXT_BASE } from '../a64/layout'
import { PolledTerminal } from '../../../core/devices/polledTerminal'
import { A32CallStack } from './callStack'
import { A32Cpu, STEP_FAULT, STEP_HALT, STEP_OK, STEP_WAIT, SVC_HALT, SVC_NEXT, SVC_REFUSED, SVC_WAIT, type A32Supervisor } from './cpu'
import { A32History, ENTRY_EDIT } from './history'

export const SYS_EXIT = 1
export const SYS_READ = 3
export const SYS_WRITE = 4
export const SYS_BRK = 45
export const SYS_EXIT_GROUP = 248

const R_SP = 13

/** Room left between the program break and the stack pointer. */
const BREAK_GUARD = 4096

/** The Linux system calls, attached to the CPU as its supervisor. */
export class A32Linux extends LinuxConsole implements A32Supervisor {
	call(cpu: A32Cpu): number {
		const number = cpu.r[7]
		const [a0, a1, a2] = [cpu.r[0] >>> 0, cpu.r[1] >>> 0, cpu.r[2] >>> 0]
		const count = a2
		const memory = {
			valid: (address: number, size: number) => cpu.offsetOf(address, size) >= 0,
			byte: (address: number) => cpu.memory[address - cpu.base],
			store: (address: number, value: number) => cpu.store(address, 1, value),
		}
		switch (number) {
			case SYS_WRITE: return this.result(cpu, this.write(Number(a0), Number(a1), count, memory))
			case SYS_READ: {
				const result = this.read(Number(a0), Number(a1), count, memory)
				return result === null ? SVC_WAIT : this.result(cpu, result)
			}
			case SYS_EXIT: case SYS_EXIT_GROUP:
				this.exitCode = Number(a0 & 0xff)
				return SVC_HALT
			case SYS_BRK:
				return this.result(cpu, this.brk(Number(a0), (cpu.r[R_SP] >>> 0) - BREAK_GUARD))
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
	/** VFP on; on when absent. */
	floatingPoint?: boolean
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
	readonly keyboard = new PolledTerminal(MMIO_BASE)
	readonly callStack = new A32CallStack()
	readonly history: A32History | null
	halted = false
	instructionCount = 0

	constructor(options: A32MachineOptions) {
		this.cpu = new A32Cpu({ base: TEXT_BASE, bytes: options.memoryBytes, floatingPoint: options.floatingPoint })
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

	/** A user's change to S0-S31, as raw bits. */
	editSingle(index: number, bits: number): boolean {
		if (!(index >= 0 && index < 32)) return false
		return this.edit(() => this.cpu.writeSingle(index, bits >>> 0))
	}

	/** FPSCR as VMSR may set it. */
	editFpscr(value: number): boolean {
		return this.edit(() => this.cpu.setFpscr((this.cpu.fpscr & ~FPSCR_WRITABLE) | (value & FPSCR_WRITABLE)))
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
		return deltaHistoryEdit(change, this.history, () => { this.history?.begin(ENTRY_EDIT) })
	}
}
