/**
 * An ARMv8-A core in AArch32 state, User mode, running the A32 instruction
 * set (ARM DDI 0487, part F) as the shared ARM library decodes it under its
 * ARMv8 profile. There is no Thumb, no VFP or Advanced SIMD and no
 * coprocessor: those words are undefined, and a branch that would enter
 * Thumb state stops the program with a fault saying so.
 *
 * State: R0-R14, a 32-bit PC (reading as the instruction's address + 8, a
 * store of it included), and the CPSR: N Z C V Q in bits 31-27, GE in 19-16,
 * and the mode, USR. User mode has no SPSR, so naming it is undefined; MSR
 * writes only the flags and GE, as User mode may.
 *
 * Memory is one little-endian region from `base`, as for the AArch64 state.
 * With SCTLR.A clear, LDR, STR and the halfword forms may be unaligned and
 * read the bytes they name, unrotated; LDRD, STRD, LDM, STM, LDREX and STREX
 * need a word-aligned address. Addresses outside memory go to an optional
 * device, else fault. A write to the PC other than by B or BL interworks, as
 * ARMv7 and later do: bit 0 set would enter Thumb.
 *
 * Every state change goes to `sink` first, with the value it replaces. A step
 * that faults changes nothing: each access is checked before anything is
 * written.
 */

import { alu, conditionPassed, dataProcessing, rotatedImmediate, shiftByImmediate, shiftByRegister } from '../../arm/a32/alu'
import {
	ARCH_V8, COND_AL, COND_NV, FLAG_C, FLAG_N, FLAG_Z, FORMAT_BLOCK, FORMAT_BLX_IMMEDIATE, FORMAT_BRANCH, FORMAT_BREAKPOINT, FORMAT_DATA, FORMAT_DIVIDE,
	FORMAT_EXCHANGE, FORMAT_EXCLUSIVE, FORMAT_EXTRA_TRANSFER, FORMAT_HINT, FORMAT_MEDIA, FORMAT_MULTIPLY, FORMAT_STATUS, FORMAT_SWI, FORMAT_TRANSFER,
	FORMAT_WIDE_MOVE, R_LR, R_PC, branchOffset, formatOf, isTestOp, popCount,
} from '../../arm/a32/isa'

/** What step() did. */
export const STEP_OK = 0
/** Nothing changed; see `fault`. */
export const STEP_FAULT = 1
/** The program exited; the PC stays on the SVC. */
export const STEP_HALT = 2
/** A system call is waiting, for input say; the PC stays on it. */
export const STEP_WAIT = 3

export const FAULT_NONE = 0
export const FAULT_ADDRESS = 1
export const FAULT_UNDEFINED = 2
export const FAULT_PC_ALIGNMENT = 3
export const FAULT_BREAKPOINT = 4
/** A system call the supervisor refused; `faultDetail` says why. */
export const FAULT_SYSCALL = 5
/** LDRD, STRD, LDM, STM or an exclusive at an address that is not word aligned. */
export const FAULT_ALIGNMENT = 6
/** A branch to an odd address, or BLX to a label: Thumb, which this core does not run. */
export const FAULT_THUMB = 7

/** Outcomes of A32Supervisor.call(). */
export const SVC_NEXT = 0
export const SVC_HALT = 1
export const SVC_WAIT = 2
export const SVC_REFUSED = 3

/** CPSR bits. */
export const PSR_Q = 0x08000000
export const PSR_GE = 0x000F0000
export const PSR_MODE = 0x1F
export const MODE_USR = 0x10
/** What User mode's MSR may write: NZCVQ by the f field, GE by the s field. */
const PSR_FLAGS_FIELD = 0xF8000000
const PSR_STATUS_FIELD = PSR_GE

export interface A32EffectSink {
	/** R0-R14. */
	register(index: number, old: number): void
	pc(old: number): void
	cpsr(old: number): void
	/** `size` bytes from `address`, little-endian, about to be overwritten. */
	memory(address: number, size: number, old: number): void
	/** The exclusive monitor's address, -1 when it is open. */
	monitor(old: number): void
}

/** The system call layer `svc` enters; it changes state only through the CPU's recorded writes. */
export interface A32Supervisor {
	/** Returns an SVC_* code; for SVC_REFUSED it sets `cpu.faultDetail`. */
	call(cpu: A32Cpu, imm: number): number
}

/** Memory-mapped registers outside the memory region. */
export interface A32Device {
	claims(address: number, size: number): boolean
	read(address: number, size: number): bigint
	write(address: number, size: number, value: bigint): void
}

export interface A32CpuOptions {
	/** Lowest address of memory. */
	base: number
	/** Bytes of memory, a positive multiple of 16. */
	bytes: number
}

const hex = (value: number) => `0x${(value >>> 0).toString(16).toUpperCase().padStart(8, '0')}`

export function faultMessage(fault: number, address: number, detail = ''): string {
	switch (fault) {
		case FAULT_ADDRESS: return `Memory access outside memory at ${hex(address)}`
		case FAULT_UNDEFINED: return `Undefined or unsupported instruction at ${hex(address)}`
		case FAULT_PC_ALIGNMENT: return `Misaligned PC ${hex(address)}`
		case FAULT_BREAKPOINT: return `BKPT at ${hex(address)}`
		case FAULT_SYSCALL: return `${detail} at ${hex(address)}`
		case FAULT_ALIGNMENT: return `Alignment fault: ${hex(address)} is not word aligned`
		case FAULT_THUMB: return `${detail} would enter Thumb state, which is not supported (A32 only)`
		default: return 'No fault'
	}
}

const EXCLUSIVE_OPEN = -1

/** `value` rotated right by `amount`, 0-31. */
const rotate = (value: number, amount: number) => amount === 0 ? value | 0 : (value >>> amount) | (value << (32 - amount))

function reverseBits(value: number): number {
	let result = 0
	for (let bit = 0; bit < 32; bit++) result |= ((value >>> bit) & 1) << (31 - bit)
	return result
}

export class A32Cpu {
	/** R0-R14; R15 is `pc`. */
	readonly r = new Int32Array(15)
	/** Address of the instruction about to run. */
	pc = 0
	cpsr = MODE_USR
	/** The exclusive monitor: the address LDREX marked, or -1 when open. */
	exclusive = EXCLUSIVE_OPEN
	readonly base: number
	readonly memory: Uint8Array
	private readonly view: DataView
	sink: A32EffectSink | null = null
	supervisor: A32Supervisor | null = null
	device: A32Device | null = null
	/** Why the last STEP_FAULT happened, and the address it concerns. */
	fault = FAULT_NONE
	faultAddress = 0
	faultDetail = ''
	/** The word the last step() fetched. */
	instruction = 0

	constructor(options: A32CpuOptions) {
		const { base, bytes } = options
		if (!(bytes > 0 && bytes % 16 === 0 && base + bytes <= 2 ** 32)) throw new RangeError(`Invalid memory size ${bytes}`)
		this.base = base
		this.memory = new Uint8Array(bytes)
		this.view = new DataView(this.memory.buffer)
	}

	/** Registers, flags, monitor and fault cleared; memory is kept. */
	reset() {
		this.r.fill(0)
		this.pc = this.base
		this.cpsr = MODE_USR
		this.exclusive = EXCLUSIVE_OPEN
		this.fault = FAULT_NONE
		this.faultAddress = 0
		this.faultDetail = ''
	}

	/** R0-R14, or the PC + 8 for R15, as an instruction reads it. */
	read(index: number): number {
		return index === R_PC ? (this.pc + 8) | 0 : this.r[index]
	}

	/** Executes one instruction; returns a STEP_* code. */
	step(): number {
		const pc = this.pc
		if (pc & 3) return this.fail(FAULT_PC_ALIGNMENT, pc)
		const fetch = this.offsetOf(pc, 4)
		if (fetch < 0) return this.fail(FAULT_ADDRESS, pc)
		const word = this.view.getInt32(fetch, true)
		this.instruction = word
		const cond = word >>> 28
		if (cond !== COND_AL && cond !== COND_NV && !conditionPassed(cond, this.cpsr)) return this.next()
		switch (formatOf(word, ARCH_V8)) {
			case FORMAT_DATA: return this.dataProcessing(word)
			case FORMAT_MULTIPLY: return this.multiply(word)
			case FORMAT_DIVIDE: {
				const n = this.r[word & 15]
				const m = this.r[(word >>> 8) & 15]
				const rd = (word >>> 16) & 15
				if (rd === R_PC || (word & 15) === R_PC || ((word >>> 8) & 15) === R_PC) return this.undefined()
				// ARMv8 divides by zero to zero; INT_MIN / -1 wraps to INT_MIN.
				const signed = (word & 0x00200000) === 0
				const quotient = m === 0 ? 0 : signed ? (n / m) | 0 : Math.floor((n >>> 0) / (m >>> 0)) | 0
				this.writeRegister(rd, quotient)
				return this.next()
			}
			case FORMAT_TRANSFER: return this.transfer(word)
			case FORMAT_EXTRA_TRANSFER: return this.extraTransfer(word)
			case FORMAT_BLOCK: return this.block(word)
			case FORMAT_EXCLUSIVE: return this.exclusiveAccess(word)
			case FORMAT_BRANCH:
				if (word & 0x01000000) this.writeRegister(R_LR, pc + 4)
				this.setPc((pc + 8 + branchOffset(word)) >>> 0)
				return STEP_OK
			case FORMAT_BLX_IMMEDIATE: {
				const target = (pc + 8 + branchOffset(word) + ((word >>> 23) & 2)) >>> 0
				this.faultDetail = `BLX to ${hex(target)}`
				return this.fail(FAULT_THUMB, target)
			}
			case FORMAT_EXCHANGE: {
				const rm = word & 15
				if (rm === R_PC && word & 0x20) return this.undefined()
				const target = this.read(rm) >>> 0
				const refused = this.checkTarget(target, `${word & 0x20 ? 'BLX' : 'BX'} to ${hex(target)}`)
				if (refused >= 0) return refused
				if (word & 0x20) this.writeRegister(R_LR, pc + 4)
				this.setPc(target)
				return STEP_OK
			}
			case FORMAT_SWI: {
				const supervisor = this.supervisor
				if (!supervisor) return this.undefined()
				switch (supervisor.call(this, word & 0xFFFFFF)) {
					case SVC_HALT: return STEP_HALT
					case SVC_WAIT: return STEP_WAIT
					case SVC_REFUSED: return this.fail(FAULT_SYSCALL, pc)
				}
				return this.next()
			}
			case FORMAT_STATUS: return this.status(word)
			case FORMAT_MEDIA: return this.media(word)
			case FORMAT_WIDE_MOVE: {
				const rd = (word >>> 12) & 15
				if (rd === R_PC) return this.undefined()
				const value = ((word >>> 4) & 0xF000) | (word & 0xFFF)
				this.writeRegister(rd, word & 0x00400000 ? (this.r[rd] & 0xFFFF) | (value << 16) : value)
				return this.next()
			}
			case FORMAT_HINT:
				// CLREX opens the monitor; the hints, barriers and PLD do nothing here.
				if ((word >>> 0) === 0xF57FF01F) this.setExclusive(EXCLUSIVE_OPEN)
				return this.next()
			case FORMAT_BREAKPOINT: return this.fail(FAULT_BREAKPOINT, pc)
			default: return this.undefined()
		}
	}

	/** Writes R0-R14, recorded. */
	writeRegister(index: number, value: number) {
		this.sink?.register(index, this.r[index])
		this.r[index] = value
	}

	/** Moves the PC, recorded. */
	setPc(value: number) {
		this.sink?.pc(this.pc)
		this.pc = value >>> 0
	}

	/** Sets NZCV, recorded. */
	setFlags(flags: number) {
		this.setCpsr((this.cpsr & 0x0FFFFFFF) | (flags & 0xF0000000))
	}

	setCpsr(value: number) {
		const cpsr = value | 0
		if (cpsr === this.cpsr) return
		this.sink?.cpsr(this.cpsr)
		this.cpsr = cpsr
	}

	/* ------------------------------------------------------------- memory */

	/** Offset into `memory` of `size` bytes at `address`, or -1 outside it. */
	offsetOf(address: number, size: number): number {
		const offset = address - this.base
		return offset >= 0 && offset <= this.memory.length - size ? offset : -1
	}

	/** Whether `size` bytes at `address` answer, in memory or a device. */
	accessible(address: number, size: number): boolean {
		return this.offsetOf(address, size) >= 0 || (this.device?.claims(address, size) ?? false)
	}

	/** A load the program makes, zero-extended; check accessible() first. */
	load(address: number, size: number): number {
		const offset = this.offsetOf(address, size)
		if (offset < 0) return Number(this.device!.read(address, size)) | 0
		const view = this.view
		return size === 1 ? view.getUint8(offset) : size === 2 ? view.getUint16(offset, true) : view.getInt32(offset, true)
	}

	/** A recorded store; check accessible() first. */
	store(address: number, size: number, value: number) {
		const offset = this.offsetOf(address, size)
		if (offset < 0) {
			this.device!.write(address, size, BigInt((size === 4 ? value : value & ((1 << (size * 8)) - 1)) >>> 0))
			return
		}
		this.sink?.memory(address, size, this.load(address, size))
		this.poke(offset, size, value)
	}

	/** Writes memory without recording, for loading and rewinding. */
	restore(address: number, size: number, value: number) {
		const offset = this.offsetOf(address, size)
		if (offset < 0) throw new RangeError(`${size} bytes at ${hex(address)} are outside memory`)
		this.poke(offset, size, value)
	}

	loadBytes(address: number, bytes: Uint8Array) {
		const offset = this.offsetOf(address, bytes.length)
		if (offset < 0) throw new RangeError(`${bytes.length} bytes at ${hex(address)} do not fit in memory`)
		this.memory.set(bytes, offset)
	}

	/** Moves the exclusive monitor, recorded. */
	setExclusive(address: number) {
		if (address === this.exclusive) return
		this.sink?.monitor(this.exclusive)
		this.exclusive = address
	}

	private poke(offset: number, size: number, value: number) {
		const view = this.view
		if (size === 1) view.setUint8(offset, value & 0xFF)
		else if (size === 2) view.setUint16(offset, value & 0xFFFF, true)
		else view.setInt32(offset, value, true)
	}

	/* -------------------------------------------------------- instructions */

	private next(): number {
		this.setPc(this.pc + 4)
		return STEP_OK
	}

	private undefined(): number {
		return this.fail(FAULT_UNDEFINED, this.pc)
	}

	private fail(fault: number, address: number): number {
		this.fault = fault
		this.faultAddress = address >>> 0
		return STEP_FAULT
	}

	/** -1 when `target` is an A32 address; else the fault a branch there raises, with nothing changed. */
	private checkTarget(target: number, what: string): number {
		if (target & 1) {
			this.faultDetail = what
			return this.fail(FAULT_THUMB, target)
		}
		if (target & 2) return this.fail(FAULT_PC_ALIGNMENT, target)
		return -1
	}

	/** A load or ALU write of the PC: BXWritePC, so bit 0 would enter Thumb. */
	private writePc(value: number, what: string): number {
		const target = value >>> 0
		const refused = this.checkTarget(target, `${what} ${hex(target)} into PC`)
		if (refused >= 0) return refused
		this.setPc(target)
		return STEP_OK
	}

	private dataProcessing(word: number): number {
		const op = (word >>> 21) & 15
		const rn = (word >>> 16) & 15
		const rd = (word >>> 12) & 15
		const setFlags = (word & 0x00100000) !== 0
		const carry = this.cpsr & FLAG_C ? 1 : 0
		const a = this.read(rn)
		let b: number
		if (word & 0x02000000) b = rotatedImmediate(word & 0xFFF, carry)
		else if (word & 0x10) {
			// Register shifts naming the PC are unpredictable on ARMv8.
			if (rn === R_PC || rd === R_PC || (word & 15) === R_PC || ((word >>> 8) & 15) === R_PC) return this.undefined()
			b = shiftByRegister(this.r[word & 15], (word >>> 5) & 3, this.r[(word >>> 8) & 15], carry)
		} else b = shiftByImmediate(this.read(word & 15), (word >>> 5) & 3, (word >>> 7) & 31, carry)
		const result = dataProcessing(op, a, b, this.cpsr)
		if (isTestOp(op)) {
			this.setFlags(alu.flags)
			return this.next()
		}
		if (rd === R_PC) {
			// With S this is an exception return, which User mode cannot make.
			if (setFlags) return this.undefined()
			return this.writePc(result, 'Writing')
		}
		this.writeRegister(rd, result)
		if (setFlags) this.setFlags(alu.flags)
		return this.next()
	}

	private multiply(word: number): number {
		const rdHi = (word >>> 16) & 15
		const rdLo = (word >>> 12) & 15
		const rm = (word >>> 8) & 15
		const rn = word & 15
		const setFlags = (word & 0x00100000) !== 0
		if (rdHi === R_PC || rm === R_PC || rn === R_PC) return this.undefined()
		const n = this.r[rn]
		const m = this.r[rm]
		if (word & 0x00800000) {
			if (rdLo === R_PC || rdLo === rdHi) return this.undefined()
			const signed = (word & 0x00400000) !== 0
			let product = signed ? BigInt(n) * BigInt(m) : BigInt(n >>> 0) * BigInt(m >>> 0)
			if (word & 0x00200000) product += (BigInt(this.r[rdHi] >>> 0) << 32n) | BigInt(this.r[rdLo] >>> 0)
			const result = BigInt.asUintN(64, product)
			const high = Number(result >> 32n) | 0
			const low = Number(result & 0xFFFF_FFFFn) | 0
			this.writeRegister(rdLo, low)
			this.writeRegister(rdHi, high)
			if (setFlags) this.setFlags((high < 0 ? FLAG_N : 0) | (result === 0n ? FLAG_Z : 0) | (this.cpsr & 0x30000000))
			return this.next()
		}
		const accumulate = (word & 0x00200000) !== 0
		const subtract = (word & 0x00400000) !== 0
		if (accumulate && rdLo === R_PC) return this.undefined()
		const product = Math.imul(n, m)
		const result = subtract ? (this.r[rdLo] - product) | 0 : accumulate ? (product + this.r[rdLo]) | 0 : product
		this.writeRegister(rdHi, result)
		// N and Z only: ARMv8 leaves C and V alone.
		if (setFlags) this.setFlags((result < 0 ? FLAG_N : 0) | (result === 0 ? FLAG_Z : 0) | (this.cpsr & 0x30000000))
		return this.next()
	}

	/** The address a transfer reaches and the base it writes back, or a fault code. */
	private transferAddress(word: number, offset: number): { address: number, indexed: number } {
		const base = this.read((word >>> 16) & 15)
		const indexed = (word & 0x00800000 ? base + offset : base - offset) | 0
		return { address: (word & 0x01000000 ? indexed : base) >>> 0, indexed }
	}

	private transfer(word: number): number {
		const rn = (word >>> 16) & 15
		const rd = (word >>> 12) & 15
		const load = (word & 0x00100000) !== 0
		const byte = (word & 0x00400000) !== 0
		const writeback = !(word & 0x01000000) || (word & 0x00200000) !== 0
		if (writeback && (rn === R_PC || (load && rn === rd))) return this.undefined()
		let offset = word & 0xFFF
		if (word & 0x02000000) {
			if ((word & 15) === R_PC) return this.undefined()
			offset = shiftByImmediate(this.r[word & 15], (word >>> 5) & 3, (word >>> 7) & 31, this.cpsr & FLAG_C ? 1 : 0)
		}
		const { address, indexed } = this.transferAddress(word, offset)
		const size = byte ? 1 : 4
		if (!this.accessible(address, size)) return this.fail(FAULT_ADDRESS, address)
		if (load) {
			const value = this.load(address, size)
			if (rd === R_PC) {
				const refused = this.checkTarget(value >>> 0, `Loading ${hex(value)} into PC`)
				if (refused >= 0) return refused
			}
			if (writeback) this.writeRegister(rn, indexed)
			if (rd === R_PC) {
				this.setPc(value)
				return STEP_OK
			}
			this.writeRegister(rd, value)
			return this.next()
		}
		this.store(address, size, this.read(rd))
		if (writeback) this.writeRegister(rn, indexed)
		return this.next()
	}

	private extraTransfer(word: number): number {
		const rn = (word >>> 16) & 15
		const rt = (word >>> 12) & 15
		const load = (word & 0x00100000) !== 0
		const kind = (word >>> 5) & 3
		const double = !load && kind >= 2
		const loads = load || kind === 2
		const writeback = !(word & 0x01000000) || (word & 0x00200000) !== 0
		if (rt === R_PC || (double && (rt & 1 || rt === R_LR))) return this.undefined()
		if (writeback && (rn === R_PC || (loads && (rn === rt || (double && rn === rt + 1))))) return this.undefined()
		let offset: number
		if (word & 0x00400000) offset = ((word >>> 4) & 0xF0) | (word & 15)
		else {
			if ((word & 15) === R_PC) return this.undefined()
			offset = this.r[word & 15]
		}
		const { address, indexed } = this.transferAddress(word, offset)
		const size = double ? 8 : kind === 1 ? 2 : kind === 2 ? 1 : 2
		if (double && address & 3) return this.fail(FAULT_ALIGNMENT, address)
		if (!this.accessible(address, double ? 4 : size) || (double && !this.accessible(address + 4, 4))) return this.fail(FAULT_ADDRESS, address)
		if (double) {
			if (loads) {
				const first = this.load(address, 4)
				const second = this.load(address + 4, 4)
				if (writeback) this.writeRegister(rn, indexed)
				this.writeRegister(rt, first)
				this.writeRegister(rt + 1, second)
			} else {
				this.store(address, 4, this.r[rt])
				this.store(address + 4, 4, this.r[rt + 1])
				if (writeback) this.writeRegister(rn, indexed)
			}
			return this.next()
		}
		if (!load) {
			this.store(address, 2, this.r[rt])
			if (writeback) this.writeRegister(rn, indexed)
			return this.next()
		}
		const raw = this.load(address, size)
		// LDRH zero-extends; LDRSB and LDRSH sign-extend.
		const value = kind === 2 ? (raw << 24) >> 24 : kind === 3 ? (raw << 16) >> 16 : raw
		if (writeback) this.writeRegister(rn, indexed)
		this.writeRegister(rt, value)
		return this.next()
	}

	private block(word: number): number {
		const rn = (word >>> 16) & 15
		const mask = word & 0xFFFF
		const load = (word & 0x00100000) !== 0
		const up = (word & 0x00800000) !== 0
		const before = (word & 0x01000000) !== 0
		const writeback = (word & 0x00200000) !== 0
		const count = popCount(mask)
		// No registers, the ^ forms (User mode has no banked registers to reach) and a written-back PC are unpredictable.
		if (count === 0 || word & 0x00400000 || rn === R_PC) return this.undefined()
		const base = this.r[rn]
		const start = (up ? base + (before ? 4 : 0) : base - 4 * count + (before ? 0 : 4)) >>> 0
		const final = (up ? base + 4 * count : base - 4 * count) | 0
		if (start & 3) return this.fail(FAULT_ALIGNMENT, start)
		for (let index = 0; index < count; index++) {
			const at = (start + 4 * index) >>> 0
			if (!this.accessible(at, 4)) return this.fail(FAULT_ADDRESS, at)
		}
		if (load) {
			let target = -1
			if (mask & 0x8000) {
				target = this.load((start + 4 * (count - 1)) >>> 0, 4) >>> 0
				const refused = this.checkTarget(target, `Loading ${hex(target)} into PC`)
				if (refused >= 0) return refused
			}
			// A base that is loaded keeps the loaded value.
			if (writeback && !(mask & (1 << rn))) this.writeRegister(rn, final)
			let address = start
			for (let register = 0; register < 15; register++) {
				if (!(mask & (1 << register))) continue
				this.writeRegister(register, this.load(address, 4))
				address += 4
			}
			if (target >= 0) {
				this.setPc(target)
				return STEP_OK
			}
			return this.next()
		}
		let address = start
		for (let register = 0; register < 16; register++) {
			if (!(mask & (1 << register))) continue
			this.store(address, 4, this.read(register))
			address += 4
		}
		if (writeback) this.writeRegister(rn, final)
		return this.next()
	}

	private exclusiveAccess(word: number): number {
		const rn = (word >>> 16) & 15
		const rt = word & 0x00100000 ? (word >>> 12) & 15 : word & 15
		const rd = (word >>> 12) & 15
		if (rn === R_PC || rt === R_PC || rd === R_PC) return this.undefined()
		const address = this.r[rn] >>> 0
		if (address & 3) return this.fail(FAULT_ALIGNMENT, address)
		if (!this.accessible(address, 4)) return this.fail(FAULT_ADDRESS, address)
		if (word & 0x00100000) {
			this.writeRegister(rt, this.load(address, 4))
			this.setExclusive(address)
			return this.next()
		}
		// One core: the store succeeds while the monitor holds this address.
		if (rd === rt || rd === rn) return this.undefined()
		const holds = this.exclusive === address
		if (holds) this.store(address, 4, this.r[rt])
		this.writeRegister(rd, holds ? 0 : 1)
		this.setExclusive(EXCLUSIVE_OPEN)
		return this.next()
	}

	private status(word: number): number {
		// User mode has no SPSR.
		if (word & 0x00400000) return this.undefined()
		if (!(word & 0x00200000)) {
			const rd = (word >>> 12) & 15
			if (rd === R_PC) return this.undefined()
			this.writeRegister(rd, this.cpsr)
			return this.next()
		}
		let value: number
		if (word & 0x02000000) value = rotatedImmediate(word & 0xFFF, 0)
		else {
			if ((word & 15) === R_PC) return this.undefined()
			value = this.r[word & 15]
		}
		const fields = (word >>> 16) & 15
		// User mode writes only the flags (f) and GE (s); the control and extension fields are ignored.
		const writable = (fields & 8 ? PSR_FLAGS_FIELD : 0) | (fields & 4 ? PSR_STATUS_FIELD : 0)
		this.setCpsr((this.cpsr & ~writable) | (value & writable))
		return this.next()
	}

	private media(word: number): number {
		const rd = (word >>> 12) & 15
		const rm = word & 15
		const rn = (word >>> 16) & 15
		if (rd === R_PC) return this.undefined()
		// CLZ.
		if ((word & 0x0FF000F0) === 0x01600010) {
			if (rm === R_PC) return this.undefined()
			this.writeRegister(rd, Math.clz32(this.r[rm]))
			return this.next()
		}
		const op1 = (word >>> 20) & 31
		const op2 = (word >>> 5) & 7
		if ((op1 & 0x18) === 0x08) {
			if (rm === R_PC) return this.undefined()
			const value = this.r[rm]
			if (op2 === 3) {
				const rotated = rotate(value, ((word >>> 10) & 3) * 8)
				const low = op1 & 7
				const bits = low & 1 ? 16 : 8
				const extended = low & 4 ? (bits === 8 ? rotated & 0xFF : rotated & 0xFFFF) : (rotated << (32 - bits)) >> (32 - bits)
				this.writeRegister(rd, rn === R_PC ? extended : (this.r[rn] + extended) | 0)
				return this.next()
			}
			let result: number
			if (op1 & 4) result = op2 === 1 ? reverseBits(value) : ((((value & 0xFF) << 8) | ((value >>> 8) & 0xFF)) << 16) >> 16
			else if (op2 === 1) result = ((value & 0xFF) << 24) | ((value & 0xFF00) << 8) | ((value >>> 8) & 0xFF00) | (value >>> 24)
			else result = ((value & 0x00FF00FF) << 8) | ((value >>> 8) & 0x00FF00FF)
			this.writeRegister(rd, result)
			return this.next()
		}
		const lsb = (word >>> 7) & 31
		const high = (word >>> 16) & 31
		if ((op1 & 0x1E) === 0x1C) {
			// BFI and BFC: bits lsb to high of Rd, from the bottom of Rn or zero.
			if (high < lsb) return this.undefined()
			const field = (high - lsb === 31 ? -1 : ((1 << (high - lsb + 1)) - 1)) << lsb
			const source = rm === R_PC ? 0 : this.r[rm] << lsb
			this.writeRegister(rd, (this.r[rd] & ~field) | (source & field))
			return this.next()
		}
		// SBFX and UBFX: `high` holds the width less one.
		if (lsb + high > 31 || rm === R_PC) return this.undefined()
		const shifted = this.r[rm] << (31 - lsb - high)
		this.writeRegister(rd, op1 & 4 ? shifted >>> (31 - high) : shifted >> (31 - high))
		return this.next()
	}
}
