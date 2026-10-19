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

import type { KeyboardDisplayDevice, ProgramImage } from '../../contracts'
import { A64CallStack } from './callStack'
import { A64Cpu, STEP_FAULT, STEP_HALT, STEP_OK, STEP_WAIT, SVC_HALT, SVC_NEXT, SVC_REFUSED, SVC_WAIT, type A64Device, type A64Supervisor } from './cpu'
import { decode } from './decode'
import { A64History, ENTRY_EDIT } from './history'
import { MASK32, MASK64, R_SP } from './isa'
import { DATA_BASE, MMIO_BASE, MMIO_RECEIVER_CONTROL, MMIO_RECEIVER_DATA, MMIO_TRANSMITTER_CONTROL, MMIO_TRANSMITTER_DATA, TEXT_BASE } from './layout'

export const SYS_READ = 63
export const SYS_WRITE = 64
export const SYS_EXIT = 93
export const SYS_EXIT_GROUP = 94
export const SYS_BRK = 214

const EBADF = 9n
const EFAULT = 14n
const CR = 13
const LF = 10

/** Room left between the program break and the stack pointer. */
const BREAK_GUARD = 4096

/** The Linux system calls, attached to the CPU as its supervisor. */
export class A64Linux implements A64Supervisor {
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

	call(cpu: A64Cpu, _imm: number): number {
		const number = Number(cpu.read(8))
		const [a0, a1, a2] = [cpu.read(0), cpu.read(1), cpu.read(2)]
		switch (number) {
			case SYS_WRITE: {
				if (a0 !== 1n && a0 !== 2n) return this.result(cpu, -EBADF)
				const count = Number(a2 > 0xFFFF_FFFFn ? 0xFFFF_FFFFn : a2)
				const at = cpu.offsetOf(Number(a1 & MASK64), count)
				if (count > 0 && (a1 > BigInt(Number.MAX_SAFE_INTEGER) || at < 0)) return this.result(cpu, -EFAULT)
				let text = ''
				for (let index = 0; index < count; index++) text += String.fromCharCode(cpu.memory[at + index])
				this.output += text
				return this.result(cpu, BigInt(count))
			}
			case SYS_READ: {
				if (a0 !== 0n) return this.result(cpu, -EBADF)
				const wanted = Number(a2 > 0xFFFF_FFFFn ? 0xFFFF_FFFFn : a2)
				if (wanted === 0) return this.result(cpu, 0n)
				const available = this.input.length - this.inputIndex
				if (available === 0) {
					this.waiting = true
					return SVC_WAIT
				}
				const count = Math.min(wanted, available)
				const address = Number(a1 & MASK64)
				if (a1 > BigInt(Number.MAX_SAFE_INTEGER) || cpu.offsetOf(address, count) < 0) return this.result(cpu, -EFAULT)
				for (let index = 0; index < count; index++) {
					const code = this.input.charCodeAt(this.inputIndex++) & 0xFF
					cpu.store(address + index, 1, BigInt(code === CR ? LF : code))
				}
				this.waiting = false
				return this.result(cpu, BigInt(count))
			}
			case SYS_EXIT: case SYS_EXIT_GROUP:
				this.exitCode = Number(a0 & 0xFFn)
				return SVC_HALT
			case SYS_BRK: {
				const limit = Number(cpu.sp) - BREAK_GUARD
				if (a0 >= BigInt(this.initialBreak) && a0 <= BigInt(limit)) this.programBreak = Number(a0)
				return this.result(cpu, BigInt(this.programBreak))
			}
		}
		cpu.faultDetail = `Unsupported system call ${number} (x8)`
		return SVC_REFUSED
	}

	private result(cpu: A64Cpu, value: bigint): number {
		cpu.writeX(0, BigInt.asUintN(64, value))
		return SVC_NEXT
	}
}

/** MARS's keyboard and display: a receiver to poll and a transmitter that is always ready. */
export class A64Keyboard implements A64Device {
	/** Everything ever queued; a rewind moves `keyIndex` back over it. */
	queued = ''
	keyIndex = 0
	display = ''

	claims(address: number, size: number): boolean {
		return address >= MMIO_BASE && address + size <= MMIO_BASE + 16 && address % 4 === 0 && size === 4
	}

	read(address: number): bigint {
		switch (address) {
			case MMIO_RECEIVER_CONTROL: return this.keyIndex < this.queued.length ? 1n : 0n
			case MMIO_RECEIVER_DATA: {
				if (this.keyIndex >= this.queued.length) return 0n
				return BigInt(this.queued.charCodeAt(this.keyIndex++) & 0xFF)
			}
			case MMIO_TRANSMITTER_CONTROL: return 1n
		}
		return 0n
	}

	write(address: number, _size: number, value: bigint) {
		if (address === MMIO_TRANSMITTER_DATA) this.display += String.fromCharCode(Number(value & 0xFFn))
	}

	/** What the Keyboard and Display tool reads and writes. */
	device(): KeyboardDisplayDevice {
		return {
			state: () => ({ queuedInput: this.queued.slice(this.keyIndex), displayOutput: this.display }),
			queue: (input) => { this.queued += input },
		}
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
	readonly keyboard = new A64Keyboard()
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
		this.history?.begin(ENTRY_EDIT)
		change()
		this.history?.end()
		return true
	}
}
