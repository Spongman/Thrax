import { LinuxConsole } from '../../../core/environments/linuxConsole'
import { deltaHistoryEdit } from '../../../core/editTransaction'
import { PolledTerminal } from '../../../core/devices/polledTerminal'
/**
 * An AArch64 user program as Linux would run it, at EL0 with no MMU: the
 * system calls a console program needs, entered by `svc #0` with the number
 * in X8, arguments in X0-X5 and the result in X0 (negative errno on failure):
 *
 * - 63 read(fd, buf, count): fd 0 only. Returns what typed input is queued,
 *   up to `count` bytes; with none it waits, the PC staying on the SVC.
 * - 64 write(fd, buf, count): fd 1 and 2 append to the console.
 * - 93 exit(status) and 94 exit_group(status): the program halts.
 * - 214 brk(addr): moves the program break, which starts after the data;
 *   brk(0) reads it. A break the stack has reached is refused.
 * Any other number stops the program with an error.
 *
 * MARS's keyboard and display registers answer at 0xFFFF0000 (see layout.ts)
 * for the Keyboard and Display tool.
 */

import type { ProgramImage } from '../../contracts'
import { A64CallStack } from './callStack'
import { A64Cpu, STEP_FAULT, STEP_HALT, STEP_OK, STEP_WAIT, SVC_HALT, SVC_NEXT, SVC_REFUSED, SVC_WAIT, type A64Supervisor } from './cpu'
import { decode } from './decode'
import { A64History, ENTRY_EDIT } from './history'
import { MASK32, R_SP } from './isa'
import { DATA_BASE, MMIO_BASE, TEXT_BASE } from './layout'

export const SYS_READ = 63
export const SYS_WRITE = 64
export const SYS_EXIT = 93
export const SYS_EXIT_GROUP = 94
export const SYS_BRK = 214

/** Room left between the program break and the stack pointer. */
const BREAK_GUARD = 4096

/** The Linux system calls, attached to the CPU as its supervisor. */
export class A64Linux extends LinuxConsole implements A64Supervisor {
	call(cpu: A64Cpu): number {
		const number = Number(cpu.read(8))
		const [a0, a1, a2] = [cpu.read(0), cpu.read(1), cpu.read(2)]
		const count = Number(a2 > 0xffff_ffffn ? 0xffff_ffffn : a2)
		const memory = {
			valid: (address: number, size: number) => cpu.offsetOf(address, size) >= 0,
			byte: (address: number) => cpu.memory[address - cpu.base],
			store: (address: number, value: number) => cpu.store(address, 1, BigInt(value)),
		}
		switch (number) {
			case SYS_WRITE: return this.result(cpu, this.write(Number(a0), Number(a1), count, memory))
			case SYS_READ: {
				const result = this.read(Number(a0), Number(a1), count, memory)
				return result === null ? SVC_WAIT : this.result(cpu, result)
			}
			case SYS_EXIT: case SYS_EXIT_GROUP:
				this.exitCode = Number(a0 & 0xffn)
				return SVC_HALT
			case SYS_BRK:
				return this.result(cpu, this.brk(Number(a0), Number(cpu.sp) - BREAK_GUARD))
		}
		cpu.faultDetail = `Unsupported system call ${number} (x8)`
		return SVC_REFUSED
	}

	private result(cpu: A64Cpu, value: number): number {
		cpu.writeX(0, BigInt.asUintN(64, BigInt(value)))
		return SVC_NEXT
	}
}

export interface A64MachineOptions {
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

/**
 * A CPU with its system calls, devices, halt state, shadow call stack and
 * optional history. Every state change goes through the history, so it can
 * rewind any of them.
 */
export class A64Machine {
	readonly cpu: A64Cpu
	readonly linux = new A64Linux()
	readonly keyboard = new PolledTerminal(MMIO_BASE)
	readonly callStack = new A64CallStack()
	readonly history: A64History | null
	halted = false
	instructionCount = 0

	constructor(options: A64MachineOptions) {
		this.cpu = new A64Cpu({ base: TEXT_BASE, bytes: options.memoryBytes })
		this.cpu.supervisor = this.linux
		this.cpu.device = this.keyboard
		const limit = options.historyLimit ?? 0
		this.history = limit > 0 ? new A64History(this, limit) : null
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
		cpu.sp = BigInt(this.top)
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
		const cpu = this.cpu
		const history = this.history
		history?.begin()
		const pc = cpu.pc
		const status = cpu.step()
		if (status === STEP_OK) this.callStack.observe(decode(cpu.instruction), pc, cpu.pc, Number(cpu.sp))
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

	/** A user's change to X0-X30 (31 is SP), recorded as an edit entry. */
	editRegister(index: number, value: bigint): boolean {
		if (index < 0 || index > 31) return false
		return this.edit(() => {
			const masked = BigInt.asUintN(64, value)
			if (index === R_SP) this.cpu.writeSp(31, masked)
			else this.cpu.writeX(index, masked)
		})
	}

	/** A W register write, which clears the upper half as an instruction's would. */
	editW(index: number, value: number): boolean {
		return this.editRegister(index, BigInt(value >>> 0) & MASK32)
	}

	editFlags(nzcv: number): boolean {
		return this.edit(() => this.cpu.setFlags(nzcv & 15))
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
			for (let index = 0; index < bytes.length; index++) this.cpu.store(address + index, 1, BigInt(bytes[index] & 0xFF))
		})
	}

	private edit(change: () => void): boolean {
		return deltaHistoryEdit(change, this.history, () => { this.history?.begin(ENTRY_EDIT) })
	}
}
