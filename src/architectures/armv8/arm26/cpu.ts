/**
 * ARM2 and ARM3 cores in 26-bit mode, as in the
 * Acorn Archimedes (ARM Family Data Manual; ARM DDI 0100, ARMv2 notes).
 *
 * R15 holds the PC in bits 25-2, the mode in bits 1-0 (USR, FIQ, IRQ, SVC)
 * and N Z C V I F in bits 31-26.  The core keeps the PC (`pc`, the address
 * of the instruction about to run) and the status bits (`psr`) apart and
 * composes R15 where an instruction reads it:
 * - as Rn, or as the base of a load or store: PC + 8, status bits clear;
 * - as Rm: PC + 8 with the status bits;
 * - with a register-specified shift, or stored by STR or STM: PC + 12.
 * Writing R15 changes only the PC, except: a data-processing S instruction
 * (MOVS PC, LR), the P forms (TEQP), and LDM ^ with R15 in the list also
 * write the status bits, all of them in a privileged mode, only NZCV in USR.
 *
 * FIQ banks R8-R14, IRQ and SVC bank R13-R14.  The registers are one array of
 * 26 physical registers; each mode reads through its own map.
 *
 * Exceptions enter SVC (IRQ and FIQ their own modes) with I set (and F, for
 * FIQ and reset), R14 = the old R15 with the return address: the instruction
 * after for SWI, undefined and prefetch abort, the faulting instruction + 8
 * for data abort and the address exception (a data address above 26 bits),
 * the next instruction + 4 for IRQ and FIQ.
 *
 * A vector whose word is zero is unprogrammed.  An exception through one is
 * not taken: SWI goes to `swi`, a high-level OS, and anything else stops the
 * run as a fault. ARM3 supplies privileged CP15 register transfers and its
 * unified cache; all other coprocessor instructions are undefined.
 */

import { alu, conditionPassed, dataProcessing, multiplyFlags, rotateLoaded, rotatedImmediate, shiftByImmediate, shiftByRegister } from '../shared/a32/alu'
import {
	COND_AL, FLAG_C, FLAGS_NZCV, FORMAT_BLOCK, FORMAT_BRANCH, FORMAT_COPROCESSOR, FORMAT_DATA, FORMAT_MULTIPLY, FORMAT_SWAP, FORMAT_SWI, FORMAT_TRANSFER,
	R_LR, R_PC, branchOffset, formatOf, isTestOp, popCount,
} from '../shared/a32/isa'
import { Arm3Cache, type Arm26Model } from './arm3'
import { multiplyCycles } from './timing'
import { Arm26BusClock, READ_EXTERNAL, type Arm26BusTiming } from './busTiming'
import { Arm26Prefetch } from './prefetch'

export const MODE_USR = 0
export const MODE_FIQ = 1
export const MODE_IRQ = 2
export const MODE_SVC = 3
export const MODE_NAMES: readonly string[] = Object.freeze(['USR', 'FIQ', 'IRQ', 'SVC'])

export const PSR_I = 0x08000000
export const PSR_F = 0x04000000
export const PSR_MODE = 3
/** The status bits of R15. */
export const PSR_MASK = 0xFC000003
/** The PC bits of R15. */
export const PC_MASK = 0x03FFFFFC
/** Data addresses must fit 26 bits. */
const ADDRESS_LIMIT = 0x04000000

export const VECTOR_RESET = 0x00
export const VECTOR_UNDEFINED = 0x04
export const VECTOR_SWI = 0x08
export const VECTOR_PREFETCH_ABORT = 0x0C
export const VECTOR_DATA_ABORT = 0x10
export const VECTOR_ADDRESS = 0x14
export const VECTOR_IRQ = 0x18
export const VECTOR_FIQ = 0x1C

/** Physical registers: R0-R7, then the banks. */
export const PHYSICAL_USR = 8
export const PHYSICAL_FIQ = 15
export const PHYSICAL_IRQ = 22
export const PHYSICAL_SVC = 24
export const PHYSICAL_COUNT = 26

/** Physical index of R0-R14 in each mode. */
export const BANKS: readonly Int8Array[] = Object.freeze([MODE_USR, MODE_FIQ, MODE_IRQ, MODE_SVC].map((mode) => Int8Array.from({ length: 15 }, (_unused, register) => {
	if (register < 8) return register
	if (mode === MODE_FIQ) return PHYSICAL_FIQ + register - 8
	if (register < 13) return register
	if (mode === MODE_IRQ) return PHYSICAL_IRQ + register - 13
	if (mode === MODE_SVC) return PHYSICAL_SVC + register - 13
	return register
})))

/** What step() did. */
export const STEP_OK = 0
/** An exception was taken; the CPU is at its vector. */
export const STEP_EXCEPTION = 1
/** Nothing changed; see `fault`. */
export const STEP_FAULT = 2
/** The OS ended the program; the PC stays on the SWI. */
export const STEP_HALT = 3
/** The OS waits, for input; the PC stays on the SWI. */
export const STEP_WAIT = 4
/** The machine took an interrupt instead of running an instruction. */
export const STEP_INTERRUPT = 5

export const FAULT_NONE = 0
export const FAULT_UNDEFINED = 1
export const FAULT_PREFETCH_ABORT = 2
export const FAULT_DATA_ABORT = 3
export const FAULT_ADDRESS = 4
export const FAULT_SWI = 5

/** What a SWI handler did. */
export const SWI_NEXT = 0
export const SWI_HALT = 1
export const SWI_WAIT = 2
/** The handler moved the PC itself. */
export const SWI_JUMPED = 3
export const SWI_UNKNOWN = 4

/** Receives every state change before it is made, with the value it replaces. */
export interface Arm26EffectSink {
	register(physical: number, old: number): void
	/** `address` is word aligned. */
	memory(address: number, oldWord: number): void
	pc(old: number): void
	psr(old: number): void
	cache(index: number, old: number): void
}

/** Runs SWIs for a program that has not programmed the SWI vector. */
export interface Arm26SwiHandler {
	/** Returns a SWI_* code; on SWI_UNKNOWN it must have changed nothing. */
	execute(cpu: Arm26Cpu, comment: number): number
}

/** A memory-mapped device: a run of words above RAM. */
export interface Arm26Io {
	readonly base: number
	readonly size: number
	read(address: number): number
	write(address: number, value: number): void
}

const hex = (value: number) => `0x${(value >>> 0).toString(16).toUpperCase().padStart(8, '0')}`

export function faultMessage(fault: number, address: number): string {
	switch (fault) {
		case FAULT_UNDEFINED: return `Undefined instruction at ${hex(address)}, and no handler at the undefined instruction vector`
		case FAULT_PREFETCH_ABORT: return `Instruction fetch outside memory at ${hex(address)}`
		case FAULT_DATA_ABORT: return `Data access outside memory at ${hex(address)}`
		case FAULT_ADDRESS: return `Address exception: ${hex(address)} does not fit 26 bits`
		case FAULT_SWI: return `Unknown SWI &${(address & 0xFFFFFF).toString(16).toUpperCase()}`
		default: return 'No fault'
	}
}

export class Arm26Cpu {
	readonly cache: Arm3Cache | null
	readonly clock: Arm26BusClock
	readonly prefetch = new Arm26Prefetch()
	/** Fetch start/end, execute start/end, completion, decode entry, in reference ticks. */
	readonly timing = new Float64Array(6)
	get cycles() { return this.clock.ticks }
	set cycles(value: number) { this.clock.ticks = value }
	private fetchAborted = false
	executeCycles = 1
	passed = true
	redirected = false
	readonly registers = new Int32Array(PHYSICAL_COUNT)
	/** Address of the instruction about to run. */
	pc = VECTOR_RESET
	/** N Z C V I F in bits 31-26 and the mode in bits 1-0; nothing else. */
	psr = MODE_SVC | PSR_I | PSR_F
	readonly memory: Uint8Array
	private readonly view: DataView
	sink: Arm26EffectSink | null = null
	swi: Arm26SwiHandler | null = null
	io: Arm26Io | null = null
	/** Why the last STEP_FAULT happened, and the address it concerns. */
	fault = FAULT_NONE
	faultAddress = 0
	/** The word the last step() fetched. */
	instruction = 0

	constructor(memoryBytes: number, readonly model: Arm26Model = 'arm3', timing?: Readonly<Arm26BusTiming>) {
		if (!(memoryBytes >= 64 && memoryBytes % 4 === 0 && memoryBytes <= ADDRESS_LIMIT)) throw new RangeError(`Invalid memory size ${memoryBytes}`)
		this.memory = new Uint8Array(memoryBytes)
		this.view = new DataView(this.memory.buffer)
		this.clock = new Arm26BusClock(timing)
		this.cache = model === 'arm3' ? new Arm3Cache(this.view) : null
		if (this.cache) this.cache.beforeWrite = (index, old) => this.sink?.cache(index, old)
	}

	get mode(): number {
		return this.psr & PSR_MODE
	}

	/** R15 as a program reads it: status bits and the PC. */
	get r15(): number {
		return ((this.psr & PSR_MASK) | (this.pc & PC_MASK)) >>> 0
	}

	/** Power-up: SVC mode with interrupts off at the reset vector. Memory is kept. */
	reset() {
		this.clock.reset()
		this.prefetch.words.fill(0)
		this.prefetch.times.fill(0)
		this.timing.fill(0)
		this.executeCycles = 1
		this.redirected = false
		this.cache?.reset()
		this.registers.fill(0)
		this.pc = VECTOR_RESET
		this.psr = MODE_SVC | PSR_I | PSR_F
		this.fault = FAULT_NONE
		this.faultAddress = 0
	}

	/** R0-R14 as the current mode sees them. */
	register(index: number): number {
		return this.registers[BANKS[this.psr & PSR_MODE][index]]
	}

	/** Whether a handler is installed at `vector`. */
	vectorSet(vector: number): boolean {
		return this.view.getInt32(vector, true) !== 0
	}

	/** Executes one instruction; returns a STEP_* code. */
	step(): number {
		this.executeCycles = 1
		this.redirected = false
		this.passed = false
		const pc = this.pc
		this.ensurePrefetch()
		this.timing[0] = this.prefetch.times[0]
		this.timing[1] = this.prefetch.times[1]
		this.timing[2] = this.cycles
		this.timing[5] = this.prefetch.times[4]
		const word = this.prefetch.instruction
		const aborted = this.prefetch.aborted
		this.instruction = word
		// Even a taken branch performs this fetch. Its abort is deferred until
		// the queued word reaches execute, and disappears when the queue is flushed.
		const fetchStart = this.cycles
		const ahead = this.fetch((pc + 8) & PC_MASK, this.prefetch.sequential)
		const aheadAborted = this.fetchAborted
		const fetchEnd = this.cycles
		const status = aborted
			? this.trap(VECTOR_PREFETCH_ABORT, MODE_SVC, pc + 4, FAULT_PREFETCH_ABORT, pc)
			: this.execute(word, pc)
		this.timing[3] = this.cycles
		this.executeCycles = Math.max(1, this.timing[3] - this.timing[2])
		if (status === STEP_OK || status === STEP_EXCEPTION) {
			if (this.redirected) this.refill(this.pc)
			else {
				this.prefetch.advance(this.pc, ahead, aheadAborted, fetchStart, fetchEnd, this.cycles)
				// N follows any instruction that used internal or data bus cycles.
				this.prefetch.sequential = this.cycles === fetchEnd
			}
		}
		this.timing[4] = this.cycles
		return status
	}

	private execute(word: number, pc: number): number {
		const cond = word >>> 28
		if (cond !== COND_AL && !conditionPassed(cond, this.psr)) return this.next()
		this.passed = true
		switch (formatOf(word)) {
			case FORMAT_DATA: return this.dataProcessing(word)
			case FORMAT_MULTIPLY: {
				const internal = multiplyCycles(this.read((word >>> 8) & 15)) - 1
				for (let cycle = 0; cycle < internal; cycle++) this.internal()
				let result = Math.imul(this.read(word & 15), this.read((word >>> 8) & 15))
				if (word & 0x00200000) result = (result + this.read((word >>> 12) & 15)) | 0
				this.writeRegister((word >>> 16) & 15, result)
				if (word & 0x00100000) this.setFlags(multiplyFlags(result, this.psr))
				return ((word >>> 16) & 15) === R_PC ? STEP_OK : this.next()
			}
			case FORMAT_SWAP: return this.model === 'arm3' ? this.swap(word) : this.trap(VECTOR_UNDEFINED, MODE_SVC, pc + 4, FAULT_UNDEFINED, pc)
			case FORMAT_COPROCESSOR: return this.coprocessor(word)
			case FORMAT_TRANSFER: return this.transfer(word)
			case FORMAT_BLOCK: return this.block(word)
			case FORMAT_BRANCH:
				this.redirected = true
				if (word & 0x01000000) this.writeRegister(R_LR, ((this.psr & PSR_MASK) | ((pc + 4) & PC_MASK)) | 0)
				this.setPc((pc + 8 + branchOffset(word)) & PC_MASK)
				return STEP_OK
			case FORMAT_SWI: return this.softwareInterrupt(word)
			default: return this.trap(VECTOR_UNDEFINED, MODE_SVC, pc + 4, FAULT_UNDEFINED, pc)
		}
	}

	/** Takes IRQ or FIQ if not masked; true when taken. */
	interrupt(vector: number): boolean {
		const fiq = vector === VECTOR_FIQ
		if (this.psr & (fiq ? PSR_F : PSR_I)) return false
		this.ensurePrefetch()
		this.fetch((this.pc + 8) & PC_MASK, this.prefetch.sequential)
		this.exception(vector, fiq ? MODE_FIQ : MODE_IRQ, this.pc + 4)
		this.refill(this.pc)
		return true
	}

	/** Moves the PC, recorded; for a SWI handler that resumes elsewhere. */
	jump(address: number) {
		this.redirected = true
		this.setPc(address & PC_MASK)
	}

	/** Writes R0-R14 of the current mode, recorded. */
	writeRegister(index: number, value: number) {
		if (index === R_PC) {
			this.redirected = true
			this.setPc(value & PC_MASK)
			return
		}
		this.writePhysical(BANKS[this.psr & PSR_MODE][index], value)
	}

	/** Sets NZCV, recorded. */
	setFlags(flags: number) {
		this.setPsr((this.psr & ~FLAGS_NZCV) | (flags & FLAGS_NZCV))
	}

	/** Debugger access: not recorded; throws outside memory. */
	readWord(address: number): number {
		this.check(address)
		return this.view.getInt32(address, true)
	}

	peekInstruction(): number {
		if (this.prefetch.ready && this.prefetch.address === this.pc) return this.prefetch.instruction
		return this.cache?.peekWord(this.pc, this.mode === MODE_USR) ?? this.readWord(this.pc)
	}

	private ensurePrefetch() {
		if (!this.prefetch.ready || this.prefetch.address !== this.pc) this.refill(this.pc)
	}

	private refill(address: number) {
		for (let slot = 0; slot < 2; slot++) {
			const at = (address + slot * 4) & PC_MASK
			const start = this.cycles
			const word = this.fetch(at, slot !== 0)
			this.prefetch.set(address, word, this.fetchAborted, start, this.cycles, slot !== 0)
		}
	}

	private fetch(address: number, sequential: boolean): number {
		this.fetchAborted = address > this.memory.length - 4
		let word = 0
		if (!this.fetchAborted) word = this.cache?.readWord(address, this.mode === MODE_USR) ?? this.view.getInt32(address, true)
		this.clock.read(address, sequential, this.fetchAborted ? READ_EXTERNAL : this.cache?.lastRead ?? READ_EXTERNAL, this.cacheOn, this.monitor)
		return word
	}

	private get cacheOn() { return !!(this.cache && this.cache.readRegister(2) & 1) }
	private get monitor() { return !!(this.cache && this.cache.readRegister(2) & 4) }
	private internal() { this.clock.internal(this.cacheOn, this.monitor) }

	writeWord(address: number, value: number) {
		this.check(address)
		this.view.setInt32(address, value, true)
	}

	/** A byte for a SWI handler, or -1 outside memory. */
	readByte(address: number): number {
		return address >= 0 && address < this.memory.length ? this.memory[address] : -1
	}

	loadBytes(address: number, bytes: Uint8Array) {
		if (address < 0 || address + bytes.length > this.memory.length) throw new RangeError(`${bytes.length} bytes at ${hex(address)} do not fit in memory`)
		this.memory.set(bytes, address)
	}

	/** Debugger and rewind write of a physical register: not recorded. */
	setPhysical(index: number, value: number) {
		this.registers[index] = value
	}

	private check(address: number) {
		if (address & 3 || address < 0 || address > this.memory.length - 4) throw new RangeError(`No word at ${hex(address)}`)
	}

	/** The value an operand register reads, R15 as `r15`. */
	private read(index: number, r15 = this.pc + 8): number {
		return index === R_PC ? r15 | 0 : this.registers[BANKS[this.psr & PSR_MODE][index]]
	}

	private next(): number {
		this.setPc((this.pc + 4) & PC_MASK)
		return STEP_OK
	}

	private dataProcessing(word: number): number {
		const pc = this.pc
		const op = (word >>> 21) & 15
		const rn = (word >>> 16) & 15
		const rd = (word >>> 12) & 15
		const carry = this.psr & FLAG_C ? 1 : 0
		let a: number
		let b: number
		if (word & 0x02000000) {
			a = this.read(rn, (pc + 8) & PC_MASK)
			b = rotatedImmediate(word & 0xFFF, carry)
		} else if (word & 0x10) {
			this.internal()
			// A register-specified shift takes a cycle more: R15 reads 12 ahead.
			const ahead = (pc + 12) & PC_MASK
			a = this.read(rn, ahead)
			const shifted = this.read(word & 15, (this.psr & PSR_MASK) | ahead)
			b = shiftByRegister(shifted, (word >>> 5) & 3, this.read((word >>> 8) & 15, (this.psr & PSR_MASK) | ahead), carry)
		} else {
			const ahead = (pc + 8) & PC_MASK
			a = this.read(rn, ahead)
			b = shiftByImmediate(this.read(word & 15, (this.psr & PSR_MASK) | ahead), (word >>> 5) & 3, (word >>> 7) & 31, carry)
		}
		const result = dataProcessing(op, a, b, this.psr)
		const setFlags = (word & 0x00100000) !== 0
		if (isTestOp(op)) {
			// The P forms put the result itself in the status bits.
			if (rd === R_PC) this.writeStatus(result)
			else this.setFlags(alu.flags)
			return this.next()
		}
		if (rd === R_PC) {
			this.redirected = true
			if (setFlags) this.writeStatus(result)
			this.setPc(result & PC_MASK)
			return STEP_OK
		}
		this.writeRegister(rd, result)
		if (setFlags) this.setFlags(alu.flags)
		return this.next()
	}

	/** R15's status bits from `value`: all of them in a privileged mode, NZCV in USR. */
	private writeStatus(value: number) {
		const status = (this.psr & PSR_MODE) === MODE_USR
			? (this.psr & ~FLAGS_NZCV) | (value & FLAGS_NZCV)
			: value & PSR_MASK
		this.setPsr(status)
	}

	/** The exception a data access at `address` raises, or FAULT_NONE. */
	private dataFault(address: number, bytes: number): number {
		if (address >= ADDRESS_LIMIT) return FAULT_ADDRESS
		if (this.isIo(address)) return FAULT_NONE
		if (address + bytes > this.memory.length) return FAULT_DATA_ABORT
		return FAULT_NONE
	}

	private dataTrap(fault: number, address: number): number {
		this.clock.read(address, false, READ_EXTERNAL, this.cacheOn, this.monitor)
		this.internal()
		const vector = fault === FAULT_ADDRESS ? VECTOR_ADDRESS : VECTOR_DATA_ABORT
		return this.trap(vector, MODE_SVC, this.pc + 8, fault, address)
	}

	private isIo(address: number): boolean {
		const io = this.io
		return io !== null && address >= io.base && address < io.base + io.size
	}

	private loadWord(address: number, external = false, user = this.mode === MODE_USR, sequential = false): number {
		const io = this.isIo(address)
		const cached = !external && !io && this.cache
		const value = io ? this.io!.read(address & ~3) | 0 : cached ? cached.readWord(address, user) : this.view.getInt32(address & ~3, true)
		this.clock.read(address, sequential, cached ? cached.lastRead : READ_EXTERNAL, this.cacheOn, this.monitor)
		return value
	}

	private storeWord(address: number, value: number, user = this.mode === MODE_USR, sequential = false) {
		this.clock.write(sequential, this.cacheOn, this.monitor)
		const aligned = address & ~3
		if (this.isIo(aligned)) {
			this.io!.write(aligned, value)
			this.cache?.written(address, value, 4, user)
			return
		}
		this.sink?.memory(aligned, this.view.getInt32(aligned, true))
		this.view.setInt32(aligned, value, true)
		this.cache?.written(address, value, 4, user)
	}

	private loadByte(address: number, external = false, user = this.mode === MODE_USR): number {
		return (this.loadWord(address, external, user) >>> ((address & 3) * 8)) & 255
	}

	private storeByte(address: number, value: number, user = this.mode === MODE_USR) {
		this.clock.write(false, this.cacheOn, this.monitor)
		if (this.isIo(address)) {
			this.io!.write(address & ~3, value & 0xFF)
			this.cache?.written(address, value, 1, user)
			return
		}
		const aligned = address & ~3
		this.sink?.memory(aligned, this.view.getInt32(aligned, true))
		this.memory[address] = value
		this.cache?.written(address, value, 1, user)
	}

	private coprocessor(word: number): number {
		const register = (word >>> 16) & 15
		const load = (word & 0x00100000) !== 0
		// Only privileged CP15 register transfers in the documented ARM3 form.
		if (!this.cache || this.mode === MODE_USR || (word & 0x0FE00FFF) !== 0x0E000F10 ||
			register > 5 || (load ? register === 1 : register === 0))
			return this.trap(VECTOR_UNDEFINED, MODE_SVC, this.pc + 4, FAULT_UNDEFINED, this.pc)
		const rd = (word >>> 12) & 15
		this.internal()
		this.clock.transfer(this.cacheOn, this.monitor)
		if (load) {
			const value = this.cache.readRegister(register)
			if (rd === R_PC) this.setFlags(value)
			else this.writeRegister(rd, value)
			this.internal()
		} else this.cache.writeRegister(register, this.read(rd, (this.psr & PSR_MASK) | ((this.pc + 12) & PC_MASK)))
		return this.next()
	}

	private swap(word: number): number {
		const address = this.read((word >>> 16) & 15) >>> 0
		const byte = (word & 0x00400000) !== 0
		const fault = this.dataFault(address, byte ? 1 : 4)
		if (fault) return this.dataTrap(fault, address)
		const source = this.read(word & 15)
		const old = byte ? this.loadByte(address, true) : rotateLoaded(this.loadWord(address, true), address)
		if (byte) this.storeByte(address, source)
		else this.storeWord(address, source)
		this.internal()
		this.writeRegister((word >>> 12) & 15, old)
		return this.next()
	}

	private transfer(word: number): number {
		const pc = this.pc
		const rn = (word >>> 16) & 15
		const rd = (word >>> 12) & 15
		const pre = (word & 0x01000000) !== 0
		const writeback = !pre || (word & 0x00200000) !== 0
		const user = this.mode === MODE_USR || (!pre && (word & 0x00200000) !== 0)
		const byte = (word & 0x00400000) !== 0
		const base = this.read(rn, (pc + 8) & PC_MASK)
		let offset = word & 0xFFF
		if (word & 0x02000000) {
			const carry = this.psr & FLAG_C ? 1 : 0
			offset = shiftByImmediate(this.read(word & 15, (this.psr & PSR_MASK) | ((pc + 8) & PC_MASK)), (word >>> 5) & 3, (word >>> 7) & 31, carry)
		}
		const indexed = (word & 0x00800000 ? base + offset : base - offset) | 0
		const address = (pre ? indexed : base) >>> 0
		const fault = this.dataFault(address, byte ? 1 : 4)
		if (fault) return this.dataTrap(fault, address)
		if (word & 0x00100000) {
			const value = byte ? this.loadByte(address, false, user) : rotateLoaded(this.loadWord(address, false, user), address)
			this.internal()
			if (writeback && rn !== R_PC) this.writeRegister(rn, indexed)
			if (rd === R_PC) {
				this.redirected = true
				this.setPc(value & PC_MASK)
				return STEP_OK
			}
			this.writeRegister(rd, value)
			return this.next()
		}
		const value = this.read(rd, (this.psr & PSR_MASK) | ((pc + 12) & PC_MASK))
		if (byte) this.storeByte(address, value, user)
		else this.storeWord(address, value, user)
		if (writeback && rn !== R_PC) this.writeRegister(rn, indexed)
		return this.next()
	}

	private block(word: number): number {
		const pc = this.pc
		const rn = (word >>> 16) & 15
		const mask = word & 0xFFFF
		const load = (word & 0x00100000) !== 0
		const up = (word & 0x00800000) !== 0
		const before = (word & 0x01000000) !== 0
		const psr = (word & 0x00400000) !== 0
		const count = popCount(mask)
		const base = this.read(rn)
		const start = (up ? base + (before ? 4 : 0) : base - 4 * count + (before ? 0 : 4)) >>> 0
		const final = (up ? base + 4 * count : base - 4 * count) | 0
		const first = start & ~3
		if (start >= ADDRESS_LIMIT) return this.dataTrap(FAULT_ADDRESS, start)
		for (let address = first; address < first + 4 * count; address += 4) {
			const fault = this.dataFault(address, 4)
			if (fault) return this.dataTrap(fault, address)
		}
		// ^ without R15 loaded moves the user bank's registers.
		const bank = BANKS[psr && !(load && mask & 0x8000) ? MODE_USR : this.psr & PSR_MODE]
		const writeback = (word & 0x00200000) !== 0 && rn !== R_PC
		let address = first
		if (load) {
			if (writeback) this.writeRegister(rn, final)
			let jumped = false
			for (let register = 0; register < 16; register++) {
				if (!(mask & (1 << register))) continue
				const value = this.loadWord(address, false, this.mode === MODE_USR, address !== first)
				address += 4
				if (register === R_PC) {
					this.redirected = true
					if (psr) this.writeStatus(value)
					this.setPc(value & PC_MASK)
					jumped = true
				} else {
					this.writePhysical(bank[register], value)
				}
			}
			this.internal()
			return jumped ? STEP_OK : this.next()
		}
		const lowest = mask & -mask
		for (let register = 0; register < 16; register++) {
			if (!(mask & (1 << register))) continue
			// The base, written back, is stored as it ends unless it is first in the list.
			let value: number
			if (register === R_PC) value = (this.psr & PSR_MASK) | ((pc + 12) & PC_MASK)
			else if (register === rn && writeback && (1 << register) !== lowest) value = final
			else value = this.registers[bank[register]]
			this.storeWord(address, value, this.mode === MODE_USR, address !== first)
			address += 4
		}
		if (writeback) this.writeRegister(rn, final)
		return this.next()
	}

	private softwareInterrupt(word: number): number {
		const pc = this.pc
		if (this.vectorSet(VECTOR_SWI)) {
			this.exception(VECTOR_SWI, MODE_SVC, pc + 4)
			return STEP_EXCEPTION
		}
		const handler = this.swi
		const comment = word & 0xFFFFFF
		if (!handler) return this.fail(FAULT_SWI, comment)
		switch (handler.execute(this, comment)) {
			case SWI_NEXT: return this.next()
			case SWI_HALT: return STEP_HALT
			case SWI_WAIT: return STEP_WAIT
			case SWI_JUMPED: return STEP_OK
			default: return this.fail(FAULT_SWI, comment)
		}
	}

	/** Takes the exception when its vector is programmed, or faults with nothing changed. */
	private trap(vector: number, mode: number, returnAddress: number, fault: number, address: number): number {
		if (vector === VECTOR_UNDEFINED) this.internal()
		if (!this.vectorSet(vector)) return this.fail(fault, address)
		this.exception(vector, mode, returnAddress)
		return STEP_EXCEPTION
	}

	private exception(vector: number, mode: number, returnAddress: number) {
		this.executeCycles = 1
		this.redirected = true
		const link = ((this.psr & PSR_MASK) | (returnAddress & PC_MASK)) | 0
		const masks = PSR_I | (vector === VECTOR_FIQ || vector === VECTOR_RESET ? PSR_F : 0)
		this.setPsr((this.psr & ~PSR_MODE) | mode | masks)
		this.writePhysical(BANKS[mode][R_LR], link)
		this.setPc(vector)
	}

	private fail(fault: number, address: number): number {
		this.fault = fault
		this.faultAddress = address >>> 0
		return STEP_FAULT
	}

	private writePhysical(index: number, value: number) {
		this.sink?.register(index, this.registers[index])
		this.registers[index] = value
	}

	private setPc(value: number) {
		this.sink?.pc(this.pc)
		this.pc = value
	}

	private setPsr(value: number) {
		const status = (value & PSR_MASK) | 0
		if (status === this.psr) return
		this.sink?.psr(this.psr)
		this.psr = status
	}
}
