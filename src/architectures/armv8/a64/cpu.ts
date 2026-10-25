/**
 * An AArch64 CPU at EL0, after the pseudocode of the reference manual
 * (DDI 0487, chapter C6), for the integer and scalar floating-point
 * instructions decode.ts knows.
 *
 * State: X0-X30 and SP as 64-bit values, the PC, NZCV, V0-V31 as 128-bit
 * values (scalar S and D writes clear the bits above them), FPCR and FPSR.
 * Floating point follows ../shared/fp.ts; with `floatingPoint` off, every
 * SIMD&FP instruction and FPCR/FPSR access is undefined. Memory is one
 * little-endian region from `base`; there is no MMU, and unaligned data
 * accesses are allowed, as at EL0 with SCTLR_EL1.A clear. Addresses outside
 * the region go to an optional device, else fault.
 *
 * Every state change goes to `sink` first, with the value it replaces, so a
 * history can undo it. A step that faults changes nothing: each access is
 * checked before anything is written.
 */

import {
	ACCESS_SIGNED32, ACCESS_SIGNED64, ACCESS_STORE, decode, DP1_CLS, DP1_CLZ, DP1_RBIT, DP1_REV, DP1_REV16, DP1_REV32,
	DP2_ASRV, DP2_LSLV, DP2_LSRV, DP2_RORV, DP2_SDIV, DP2_UDIV, DP3_MADD, DP3_MSUB, DP3_SMADDL, DP3_SMSUBL, DP3_SMULH, DP3_UMADDL, DP3_UMSUBL,
	FP1_FABS, FP1_FCVT_D, FP1_FCVT_S, FP1_FNEG, FP1_FRINTA, FP1_FRINTI, FP1_FRINTM, FP1_FRINTN, FP1_FRINTP, FP1_FRINTX, FP1_FRINTZ, FP1_FSQRT,
	FP2_FADD, FP2_FDIV, FP2_FMAX, FP2_FMAXNM, FP2_FMIN, FP2_FMINNM, FP2_FMUL, FP2_FSUB, FPI_FCVTAS, FPI_FCVTS, FPI_FCVTU,
	FPI_FMOV_FROM, FPI_FMOV_TO, FPI_SCVTF, FPI_UCVTF, FPI_FCVTAU, MODE_OFFSET, MODE_POST, MODE_PRE, MODE_REGISTER, Op, SYSREG_FPCR, SYSREG_FPSR, SYSREG_NZCV,
	type A64Instruction,
} from './decode'
import {
	DOUBLE, fixedToFp, fpAbs, fpAdd, fpCompare, fpConvert, FpEnv, fpDiv, fpMinMax, fpMul, fpMulAdd, fpNeg, fpRoundInt, fpSqrt, fpToFixed, ROUND_NEGINF,
	ROUND_POSINF, ROUND_TIEAWAY, ROUND_TIEEVEN, ROUND_ZERO, SINGLE,
} from '../shared/fp'
import { conditionHolds, FLAG_C, MASK32, MASK64, R_LR, rotateRight, SHIFT_ASR, SHIFT_LSL, SHIFT_LSR } from './isa'

/** What step() did. */
export const STEP_OK = 0
/** Nothing changed; see `fault`. */
export const STEP_FAULT = 1
/** HLT, or a program exit; the PC stays on the instruction. */
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

/** Outcomes of A64Supervisor.call(). */
export const SVC_NEXT = 0
export const SVC_HALT = 1
export const SVC_WAIT = 2
export const SVC_REFUSED = 3

export interface A64EffectSink {
	/** X0-X30. */
	register(index: number, old: bigint): void
	sp(old: bigint): void
	pc(old: number): void
	flags(old: number): void
	/** `size` bytes from `address`, little-endian, about to be overwritten. */
	memory(address: number, size: number, old: bigint): void
	/** V0-V31, as low and high doublewords. */
	vector(index: number, low: bigint, high: bigint): void
	fpcr(old: number): void
	fpsr(old: number): void
}

/** FPCR bits this core implements: AHP, DN, FZ and RMode; trap enables read as zero. */
export const FPCR_WRITABLE = 0x07C00000
/** FPSR: NZCV (AArch32's), QC and the cumulative flags. */
export const FPSR_WRITABLE = 0xF800009F

/** The system call layer `svc` enters; it changes state only through the CPU's recorded writes. */
export interface A64Supervisor {
	/** Returns an SVC_* code; for SVC_REFUSED it sets `cpu.faultDetail`. */
	call(cpu: A64Cpu, imm: number): number
}

/** Memory-mapped registers outside the memory region. */
export interface A64Device {
	/** Whether `size` bytes at `address` are its registers. */
	claims(address: number, size: number): boolean
	read(address: number, size: number): bigint
	write(address: number, size: number, value: bigint): void
}

export interface A64CpuOptions {
	/** Lowest address of memory. */
	base: number
	/** Bytes of memory, a positive multiple of 16. */
	bytes: number
}

const hex = (value: number) => `0x${value.toString(16).toUpperCase().padStart(8, '0')}`

export function faultMessage(fault: number, address: number, detail = ''): string {
	switch (fault) {
		case FAULT_ADDRESS: return `Memory access outside memory at ${hex(address)}`
		case FAULT_UNDEFINED: return `Undefined or unsupported instruction at ${hex(address)}`
		case FAULT_PC_ALIGNMENT: return `Misaligned PC ${hex(address)}`
		case FAULT_BREAKPOINT: return `BRK at ${hex(address)}`
		case FAULT_SYSCALL: return `${detail} at ${hex(address)}`
		default: return 'No fault'
	}
}

const masks = (sf: boolean) => sf ? MASK64 : MASK32

function shiftValue(value: bigint, type: number, amount: number, width: number): bigint {
	const mask = width === 64 ? MASK64 : MASK32
	const count = BigInt(amount)
	switch (type) {
		case SHIFT_LSL: return (value << count) & mask
		case SHIFT_LSR: return value >> count
		case SHIFT_ASR: return BigInt.asUintN(width, BigInt.asIntN(width, value) >> count)
		default: return rotateRight(value, amount, width)
	}
}

/** ExtendReg(): the low bytes of `value`, extended and shifted left by `amount`. */
function extendValue(value: bigint, option: number, amount: number, width: number): bigint {
	const bits = 8 << (option & 3)
	const extended = option & 4 ? BigInt.asIntN(bits, value) : BigInt.asUintN(bits, value)
	return BigInt.asUintN(width, extended << BigInt(amount))
}

function bitCount(value: bigint, width: number, leading: (bit: bigint) => boolean): number {
	let count = 0
	for (let bit = width - 1; bit >= 0 && leading((value >> BigInt(bit)) & 1n); bit--) count++
	return count
}

function reverseBytes(value: bigint, bytes: number): bigint {
	let result = 0n
	for (let index = 0; index < bytes; index++) result = (result << 8n) | ((value >> BigInt(index * 8)) & 0xFFn)
	return result
}

export class A64Cpu {
	/** X0-X30; register 31 is SP or XZR by operand, never stored here. */
	readonly x = new BigUint64Array(31)
	sp = 0n
	pc = 0
	nzcv = 0
	/** V0-V31: Vn is v[2n] below v[2n + 1]. */
	readonly v = new BigUint64Array(64)
	fpcr = 0
	fpsr = 0
	/** SIMD&FP instructions run; off, they are undefined. */
	floatingPoint = true
	readonly base: number
	readonly memory: Uint8Array
	private readonly view: DataView
	sink: A64EffectSink | null = null
	supervisor: A64Supervisor | null = null
	device: A64Device | null = null
	/** Why the last STEP_FAULT happened, and the address it concerns. */
	fault = FAULT_NONE
	faultAddress = 0
	faultDetail = ''
	/** The word the last step() fetched. */
	instruction = 0
	/** The flags addWithCarry() last computed. */
	private carryFlags = 0
	private readonly env = new FpEnv()

	constructor(options: A64CpuOptions) {
		const { base, bytes } = options
		if (!(bytes > 0 && bytes % 16 === 0 && Number.isSafeInteger(base + bytes))) throw new RangeError(`Invalid memory size ${bytes}`)
		this.base = base
		this.memory = new Uint8Array(bytes)
		this.view = new DataView(this.memory.buffer)
	}

	/** Registers, SP, flags and fault cleared; memory is kept. */
	reset() {
		this.x.fill(0n)
		this.sp = 0n
		this.pc = this.base
		this.nzcv = 0
		this.v.fill(0n)
		this.fpcr = 0
		this.fpsr = 0
		this.fault = FAULT_NONE
		this.faultAddress = 0
		this.faultDetail = ''
	}

	/** Executes one instruction; returns a STEP_* code. */
	step(): number {
		const pc = this.pc
		if (pc % 4 !== 0) return this.fail(FAULT_PC_ALIGNMENT, pc)
		const fetch = pc - this.base
		if (fetch < 0 || fetch > this.memory.length - 4) return this.fail(FAULT_ADDRESS, pc)
		const word = this.view.getUint32(fetch, true)
		this.instruction = word
		const d = decode(word)
		const { sf, rd, rn, rm } = d
		const width = sf ? 64 : 32
		const mask = masks(sf)
		let next = pc + 4
		switch (d.op) {
			case Op.ADDSUB_IMM: {
				const result = this.addWithCarry(this.readSp(rn, sf), d.sub ? ~d.imm & mask : d.imm, d.sub ? 1n : 0n, width)
				if (d.setFlags) {
					this.setFlags(this.carryFlags)
					this.writeX(rd, result, sf)
				} else {
					this.writeSp(rd, result, sf)
				}
				break
			}
			case Op.LOGIC_IMM: {
				const result = this.logic(d.opc, this.read(rn, sf), d.imm, width)
				if (d.setFlags) this.writeX(rd, result, sf)
				else this.writeSp(rd, result, sf)
				break
			}
			case Op.MOVE_WIDE: {
				const shift = BigInt(d.amount)
				const value = d.imm << shift
				const result = d.opc === 0 ? ~value & mask : d.opc === 2 ? value : (this.read(rd, sf) & ~(0xFFFFn << shift)) | value
				this.writeX(rd, result, sf)
				break
			}
			case Op.BITFIELD: this.writeX(rd, this.bitfield(d, width), sf); break
			case Op.EXTR: {
				const concatenated = (this.read(rn, sf) << BigInt(width)) | this.read(rm, sf)
				this.writeX(rd, (concatenated >> BigInt(d.amount)) & mask, sf)
				break
			}
			case Op.ADR: this.writeX(rd, BigInt.asUintN(64, BigInt(pc) + d.imm), true); break
			case Op.ADRP: this.writeX(rd, BigInt.asUintN(64, BigInt(pc - (pc % 4096)) + d.imm), true); break
			case Op.B: next = this.branch(pc, d.imm); break
			case Op.BL:
				this.writeX(R_LR, BigInt(pc + 4), true)
				next = this.branch(pc, d.imm)
				break
			case Op.B_COND: if (conditionHolds(d.cond, this.nzcv)) next = this.branch(pc, d.imm); break
			case Op.CB: if ((this.read(rd, sf) === 0n) === (d.opc === 0)) next = this.branch(pc, d.imm); break
			case Op.TB: if ((((this.read(rd, true) >> BigInt(d.amount)) & 1n) === 0n) === (d.opc === 0)) next = this.branch(pc, d.imm); break
			case Op.BR: case Op.RET: next = this.absolute(this.read(rn, true)); break
			case Op.BLR: {
				// The target is read before X30 is written, so BLR X30 works.
				const target = this.read(rn, true)
				this.writeX(R_LR, BigInt(pc + 4), true)
				next = this.absolute(target)
				break
			}
			case Op.SVC: {
				const supervisor = this.supervisor
				if (!supervisor) return this.fail(FAULT_UNDEFINED, pc)
				switch (supervisor.call(this, Number(d.imm))) {
					case SVC_HALT: return STEP_HALT
					case SVC_WAIT: return STEP_WAIT
					case SVC_REFUSED: return this.fail(FAULT_SYSCALL, pc)
				}
				break
			}
			case Op.HLT: return STEP_HALT
			case Op.BRK: return this.fail(FAULT_BREAKPOINT, pc)
			case Op.NOP: break
			case Op.LOGIC_REG: {
				let operand = shiftValue(this.read(rm, sf), d.shift, d.amount, width)
				if (d.invert) operand = ~operand & mask
				this.writeX(rd, this.logic(d.opc, this.read(rn, sf), operand, width), sf)
				break
			}
			case Op.ADDSUB_SHIFT:
			case Op.ADDSUB_EXT: {
				const extended = d.op === Op.ADDSUB_EXT
				const operand = extended ? extendValue(this.read(rm, true), d.shift, d.amount, width) : shiftValue(this.read(rm, sf), d.shift, d.amount, width)
				const first = extended ? this.readSp(rn, sf) : this.read(rn, sf)
				const result = this.addWithCarry(first, d.sub ? ~operand & mask : operand, d.sub ? 1n : 0n, width)
				if (d.setFlags) {
					this.setFlags(this.carryFlags)
					this.writeX(rd, result, sf)
				} else if (extended) {
					this.writeSp(rd, result, sf)
				} else {
					this.writeX(rd, result, sf)
				}
				break
			}
			case Op.ADC: {
				const operand = this.read(rm, sf)
				const result = this.addWithCarry(this.read(rn, sf), d.sub ? ~operand & mask : operand, (this.nzcv & FLAG_C) ? 1n : 0n, width)
				if (d.setFlags) this.setFlags(this.carryFlags)
				this.writeX(rd, result, sf)
				break
			}
			case Op.CCMP: {
				if (conditionHolds(d.cond, this.nzcv)) {
					const operand = d.immediate ? BigInt(d.amount) : this.read(rm, sf)
					this.addWithCarry(this.read(rn, sf), d.sub ? ~operand & mask : operand, d.sub ? 1n : 0n, width)
					this.setFlags(this.carryFlags)
				} else {
					this.setFlags(Number(d.imm))
				}
				break
			}
			case Op.CSEL: {
				let result: bigint
				if (conditionHolds(d.cond, this.nzcv)) {
					result = this.read(rn, sf)
				} else {
					const operand = this.read(rm, sf)
					switch (d.opc) {
						case 0: result = operand; break
						case 1: result = (operand + 1n) & mask; break
						case 2: result = ~operand & mask; break
						default: result = (-operand) & mask
					}
				}
				this.writeX(rd, result, sf)
				break
			}
			case Op.DP3: this.writeX(rd, this.threeSource(d, width), sf); break
			case Op.DP2: this.writeX(rd, this.twoSource(d, width), sf); break
			case Op.DP1: this.writeX(rd, this.oneSource(d, width), sf); break
			case Op.LOAD_STORE:
				if (d.fp && !this.floatingPoint) return this.fail(FAULT_UNDEFINED, pc)
				return this.loadStore(d, pc)
			case Op.LOAD_LITERAL: {
				if (d.fp && !this.floatingPoint) return this.fail(FAULT_UNDEFINED, pc)
				const address = pc + Number(d.imm)
				const value = this.loadVector(address, d.size)
				if (value === null) return this.fail(FAULT_ADDRESS, address)
				if (d.fp) this.writeV(rd, value[0], d.size, value[1])
				else this.writeX(rd, d.access === ACCESS_SIGNED64 ? BigInt.asUintN(64, BigInt.asIntN(32, value[0])) : value[0], d.sf)
				break
			}
			case Op.LOAD_STORE_PAIR:
				if (d.fp && !this.floatingPoint) return this.fail(FAULT_UNDEFINED, pc)
				return this.loadStorePair(d, pc)
			case Op.MRS: case Op.MSR: {
				const sysreg = Number(d.imm)
				if (sysreg !== SYSREG_NZCV && !this.floatingPoint) return this.fail(FAULT_UNDEFINED, pc)
				if (d.op === Op.MRS) {
					this.writeX(rd, BigInt((sysreg === SYSREG_FPCR ? this.fpcr : sysreg === SYSREG_FPSR ? this.fpsr : this.nzcv << 28) >>> 0))
					break
				}
				const value = Number(this.read(rd) & MASK32)
				if (sysreg === SYSREG_FPCR) this.setFpcr(value & FPCR_WRITABLE)
				else if (sysreg === SYSREG_FPSR) this.setFpsr((value & FPSR_WRITABLE) >>> 0)
				else this.setFlags((value >>> 28) & 15)
				break
			}
			case Op.FP_DP1: case Op.FP_DP2: case Op.FP_DP3: case Op.FP_CMP: case Op.FP_CCMP: case Op.FP_CSEL: case Op.FP_IMM: case Op.FP_INT: case Op.FP_FIXED:
				if (!this.floatingPoint) return this.fail(FAULT_UNDEFINED, pc)
				this.float(d)
				break
			default: return this.fail(FAULT_UNDEFINED, pc)
		}
		this.setPc(next)
		return STEP_OK
	}

	/* ---------------------------------------------------------- registers */

	/** Register `n` as an operand: 31 reads zero. A W read is the low half. */
	read(n: number, sf = true): bigint {
		if (n === 31) return 0n
		return sf ? this.x[n] : this.x[n] & MASK32
	}

	/** Register `n` where 31 is SP. */
	readSp(n: number, sf = true): bigint {
		const value = n === 31 ? this.sp : this.x[n]
		return sf ? value : value & MASK32
	}

	/** A recorded write; 31 is XZR and discards it. A W write clears the upper half. */
	writeX(n: number, value: bigint, sf = true) {
		if (n === 31) return
		this.sink?.register(n, this.x[n])
		this.x[n] = sf ? value : value & MASK32
	}

	/** A recorded write where 31 is SP. */
	writeSp(n: number, value: bigint, sf = true) {
		if (n !== 31) {
			this.writeX(n, value, sf)
			return
		}
		this.sink?.sp(this.sp)
		this.sp = sf ? value & MASK64 : value & MASK32
	}

	setFlags(value: number) {
		if (value === this.nzcv) return
		this.sink?.flags(this.nzcv)
		this.nzcv = value
	}

	/** The low `size` bytes (8 at most) of Vn. */
	readV(n: number, size: number): bigint {
		const low = this.v[2 * n]
		return size >= 8 ? low : low & ((1n << BigInt(size * 8)) - 1n)
	}

	/** A recorded write of the low `size` bytes of Vn, clearing the rest; `high` is bits 64-127 of a Q. */
	writeV(n: number, value: bigint, size: number, high = 0n) {
		const low = size >= 8 ? BigInt.asUintN(64, value) : value & ((1n << BigInt(size * 8)) - 1n)
		this.setVector(n, low, size === 16 ? high : 0n)
	}

	/** Vn whole, recorded. */
	setVector(n: number, low: bigint, high: bigint) {
		const v = this.v
		if (v[2 * n] === low && v[2 * n + 1] === high) return
		this.sink?.vector(n, v[2 * n], v[2 * n + 1])
		v[2 * n] = low
		v[2 * n + 1] = high
	}

	setFpcr(value: number) {
		if (value === this.fpcr) return
		this.sink?.fpcr(this.fpcr)
		this.fpcr = value
	}

	setFpsr(value: number) {
		if (value === this.fpsr) return
		this.sink?.fpsr(this.fpsr)
		this.fpsr = value
	}

	setPc(value: number) {
		if (value === this.pc) return
		this.sink?.pc(this.pc)
		this.pc = value
	}

	/* ------------------------------------------------------------- memory */

	/** Offset into `memory` of `size` bytes at `address`, or -1 outside it. */
	offsetOf(address: number, size: number): number {
		const offset = address - this.base
		return offset >= 0 && offset <= this.memory.length - size ? offset : -1
	}

	/** A load the program makes; null where nothing answers. */
	load(address: number, size: number): bigint | null {
		const offset = this.offsetOf(address, size)
		if (offset < 0) return this.device?.claims(address, size) ? this.device.read(address, size) : null
		const view = this.view
		switch (size) {
			case 1: return BigInt(view.getUint8(offset))
			case 2: return BigInt(view.getUint16(offset, true))
			case 4: return BigInt(view.getUint32(offset, true))
			default: return view.getBigUint64(offset, true)
		}
	}

	/** A load of up to 16 bytes as its low and high doublewords; null where nothing answers. */
	loadVector(address: number, size: number): [bigint, bigint] | null {
		if (size < 16) {
			const value = this.load(address, size)
			return value === null ? null : [value, 0n]
		}
		const low = this.load(address, 8)
		const high = this.load(address + 8, 8)
		return low === null || high === null ? null : [low, high]
	}

	/** Whether a store of `size` bytes at `address` would land somewhere. */
	writable(address: number, size: number): boolean {
		return this.offsetOf(address, size) >= 0 || (this.device?.claims(address, size) ?? false)
	}

	/** A recorded store; false where nothing answers. */
	store(address: number, size: number, value: bigint): boolean {
		const offset = this.offsetOf(address, size)
		if (offset < 0) {
			if (!this.device?.claims(address, size)) return false
			this.device.write(address, size, value & ((1n << BigInt(size * 8)) - 1n))
			return true
		}
		this.sink?.memory(address, size, this.load(address, size)!)
		this.poke(offset, size, value)
		return true
	}

	/** Writes memory without recording, for loading and rewinding. */
	restore(address: number, size: number, value: bigint) {
		const offset = this.offsetOf(address, size)
		if (offset < 0) throw new RangeError(`${size} bytes at ${hex(address)} are outside memory`)
		this.poke(offset, size, value)
	}

	loadBytes(address: number, bytes: Uint8Array) {
		const offset = this.offsetOf(address, bytes.length)
		if (offset < 0) throw new RangeError(`${bytes.length} bytes at ${hex(address)} do not fit in memory`)
		this.memory.set(bytes, offset)
	}

	private poke(offset: number, size: number, value: bigint) {
		const view = this.view
		switch (size) {
			case 1: view.setUint8(offset, Number(value & 0xFFn)); break
			case 2: view.setUint16(offset, Number(value & 0xFFFFn), true); break
			case 4: view.setUint32(offset, Number(value & MASK32), true); break
			default: view.setBigUint64(offset, value & MASK64, true)
		}
	}

	/* ----------------------------------------------------------- execution */

	/** AddWithCarry(): the sum, with its NZCV left in `carryFlags`. */
	private addWithCarry(a: bigint, b: bigint, carry: bigint, width: number): bigint {
		const mask = width === 64 ? MASK64 : MASK32
		const sum = a + b + carry
		const result = sum & mask
		const sign = BigInt(width - 1)
		const signA = (a >> sign) & 1n
		const signB = (b >> sign) & 1n
		const signR = (result >> sign) & 1n
		this.carryFlags = (signR ? 8 : 0) | (result === 0n ? 4 : 0) | (sum > mask ? 2 : 0) | (signA === signB && signR !== signA ? 1 : 0)
		return result
	}

	/** AND/ORR/EOR/ANDS by `opc`; ANDS sets N and Z and clears C and V. */
	private logic(opc: number, a: bigint, b: bigint, width: number): bigint {
		let result: bigint
		switch (opc) {
			case 1: result = a | b; break
			case 2: result = a ^ b; break
			default: result = a & b
		}
		if (opc === 3) this.setFlags(((result >> BigInt(width - 1)) & 1n ? 8 : 0) | (result === 0n ? 4 : 0))
		return result
	}

	private bitfield(d: A64Instruction, width: number): bigint {
		const source = this.read(d.rn, d.sf)
		const bottom = rotateRight(source, d.immr, width) & d.wmask
		if (d.opc === 1) {
			const destination = this.read(d.rd, d.sf)
			const merged = (destination & ~d.wmask) | bottom
			return (destination & ~d.tmask) | (merged & d.tmask)
		}
		if (d.opc === 2) return bottom & d.tmask
		const mask = width === 64 ? MASK64 : MASK32
		const top = (source >> BigInt(d.imms)) & 1n ? mask : 0n
		return ((top & ~d.tmask) | (bottom & d.tmask)) & mask
	}

	private threeSource(d: A64Instruction, width: number): bigint {
		const n = this.read(d.rn, d.sf)
		const m = this.read(d.rm, d.sf)
		const a = this.read(d.ra, true)
		const signed = (value: bigint) => BigInt.asIntN(32, value)
		switch (d.opc) {
			case DP3_MADD: return BigInt.asUintN(width, this.read(d.ra, d.sf) + n * m)
			case DP3_MSUB: return BigInt.asUintN(width, this.read(d.ra, d.sf) - n * m)
			case DP3_SMADDL: return BigInt.asUintN(64, a + signed(n) * signed(m))
			case DP3_SMSUBL: return BigInt.asUintN(64, a - signed(n) * signed(m))
			case DP3_UMADDL: return BigInt.asUintN(64, a + (n & MASK32) * (m & MASK32))
			case DP3_UMSUBL: return BigInt.asUintN(64, a - (n & MASK32) * (m & MASK32))
			case DP3_SMULH: return BigInt.asUintN(64, (BigInt.asIntN(64, n) * BigInt.asIntN(64, m)) >> 64n)
			default: return (n * m) >> 64n
		}
	}

	private twoSource(d: A64Instruction, width: number): bigint {
		const n = this.read(d.rn, d.sf)
		const m = this.read(d.rm, d.sf)
		switch (d.opc) {
			case DP2_UDIV: return m === 0n ? 0n : n / m
			case DP2_SDIV: {
				if (m === 0n) return 0n
				// Truncates toward zero; the most negative over -1 wraps to itself.
				return BigInt.asUintN(width, BigInt.asIntN(width, n) / BigInt.asIntN(width, m))
			}
			case DP2_LSLV: return shiftValue(n, SHIFT_LSL, Number(m % BigInt(width)), width)
			case DP2_LSRV: return shiftValue(n, SHIFT_LSR, Number(m % BigInt(width)), width)
			case DP2_ASRV: return shiftValue(n, SHIFT_ASR, Number(m % BigInt(width)), width)
			case DP2_RORV: return rotateRight(n, Number(m % BigInt(width)), width)
		}
		return 0n
	}

	private oneSource(d: A64Instruction, width: number): bigint {
		const n = this.read(d.rn, d.sf)
		switch (d.opc) {
			case DP1_RBIT: {
				let result = 0n
				for (let bit = 0; bit < width; bit++) result = (result << 1n) | ((n >> BigInt(bit)) & 1n)
				return result
			}
			case DP1_REV16: {
				let result = 0n
				for (let half = 0; half < width; half += 16) result |= reverseBytes(n >> BigInt(half), 2) << BigInt(half)
				return result
			}
			case DP1_REV32: return (reverseBytes(n >> 32n, 4) << 32n) | reverseBytes(n, 4)
			case DP1_REV: return reverseBytes(n, width / 8)
			case DP1_CLZ: return BigInt(bitCount(n, width, (bit) => bit === 0n))
			case DP1_CLS: {
				const sign = (n >> BigInt(width - 1)) & 1n
				return BigInt(bitCount(n, width, (bit) => bit === sign) - 1)
			}
		}
		return 0n
	}

	private loadStore(d: A64Instruction, pc: number): number {
		const base = this.readSp(d.rn, true)
		let address: bigint
		switch (d.mode) {
			case MODE_POST: address = base; break
			case MODE_REGISTER: {
				const scale = d.amount ? Math.log2(d.size) : 0
				address = base + extendValue(this.read(d.rm, true), d.shift, scale, 64)
				break
			}
			default: address = base + d.imm
		}
		const at = Number(BigInt.asUintN(64, address))
		const writeback = d.mode === MODE_PRE || d.mode === MODE_POST
		if (d.access === ACCESS_STORE) {
			if (!this.writable(at, d.size)) return this.fail(FAULT_ADDRESS, at)
			if (d.fp) this.storeVector(at, d.size, this.v[2 * d.rd], this.v[2 * d.rd + 1])
			else this.store(at, d.size, this.read(d.rd, true))
		} else {
			const value = this.loadVector(at, d.size)
			if (value === null) return this.fail(FAULT_ADDRESS, at)
			if (d.fp) this.writeV(d.rd, value[0], d.size, value[1])
			else this.writeX(d.rd, this.extendLoad(value[0], d), d.access === ACCESS_SIGNED64 || d.size === 8)
		}
		if (writeback) this.writeSp(d.rn, BigInt.asUintN(64, base + d.imm), true)
		this.setPc(pc + 4)
		return STEP_OK
	}

	private loadStorePair(d: A64Instruction, pc: number): number {
		const base = this.readSp(d.rn, true)
		const at = Number(BigInt.asUintN(64, d.mode === MODE_POST ? base : base + d.imm))
		const { size } = d
		const second = at + size
		const wide = size === 8 || d.access === ACCESS_SIGNED64
		if (d.access === ACCESS_STORE) {
			if (!this.writable(at, size)) return this.fail(FAULT_ADDRESS, at)
			if (!this.writable(second, size)) return this.fail(FAULT_ADDRESS, second)
			if (d.fp) {
				const v = this.v
				const [low, high, otherLow, otherHigh] = [v[2 * d.rd], v[2 * d.rd + 1], v[2 * d.ra], v[2 * d.ra + 1]]
				this.storeVector(at, size, low, high)
				this.storeVector(second, size, otherLow, otherHigh)
			} else {
				const first = this.read(d.rd, true)
				const other = this.read(d.ra, true)
				this.store(at, size, first)
				this.store(second, size, other)
			}
		} else {
			const first = this.loadVector(at, size)
			if (first === null) return this.fail(FAULT_ADDRESS, at)
			const other = this.loadVector(second, size)
			if (other === null) return this.fail(FAULT_ADDRESS, second)
			if (d.fp) {
				this.writeV(d.rd, first[0], size, first[1])
				this.writeV(d.ra, other[0], size, other[1])
			} else {
				this.writeX(d.rd, this.extendLoad(first[0], d), wide)
				this.writeX(d.ra, this.extendLoad(other[0], d), wide)
			}
		}
		if (d.mode !== MODE_OFFSET) this.writeSp(d.rn, BigInt.asUintN(64, base + d.imm), true)
		this.setPc(pc + 4)
		return STEP_OK
	}

	/** Stores the low `size` bytes of a V register given whole. */
	private storeVector(address: number, size: number, low: bigint, high: bigint) {
		if (size < 16) {
			this.store(address, size, size === 8 ? low : low & ((1n << BigInt(size * 8)) - 1n))
			return
		}
		this.store(address, 8, low)
		this.store(address + 8, 8, high)
	}

	/** One scalar floating-point instruction; none can fault. */
	private float(d: A64Instruction) {
		const { rd, rn, rm, size } = d
		const fmt = size === 8 ? DOUBLE : SINGLE
		const env = this.env
		env.fpcr = this.fpcr
		env.flags = 0
		const n = () => this.readV(rn, size)
		const m = () => this.readV(rm, size)
		switch (d.op) {
			case Op.FP_DP1: {
				const a = n()
				switch (d.opc) {
					case FP1_FABS: this.writeV(rd, fpAbs(a, fmt), size); break
					case FP1_FNEG: this.writeV(rd, fpNeg(a, fmt), size); break
					case FP1_FSQRT: this.writeV(rd, fpSqrt(a, fmt, env), size); break
					case FP1_FCVT_S: this.writeV(rd, fpConvert(a, DOUBLE, SINGLE, env), 4); break
					case FP1_FCVT_D: this.writeV(rd, fpConvert(a, SINGLE, DOUBLE, env), 8); break
					case FP1_FRINTN: this.writeV(rd, fpRoundInt(a, ROUND_TIEEVEN, false, fmt, env), size); break
					case FP1_FRINTP: this.writeV(rd, fpRoundInt(a, ROUND_POSINF, false, fmt, env), size); break
					case FP1_FRINTM: this.writeV(rd, fpRoundInt(a, ROUND_NEGINF, false, fmt, env), size); break
					case FP1_FRINTZ: this.writeV(rd, fpRoundInt(a, ROUND_ZERO, false, fmt, env), size); break
					case FP1_FRINTA: this.writeV(rd, fpRoundInt(a, ROUND_TIEAWAY, false, fmt, env), size); break
					case FP1_FRINTX: this.writeV(rd, fpRoundInt(a, env.mode, true, fmt, env), size); break
					case FP1_FRINTI: this.writeV(rd, fpRoundInt(a, env.mode, false, fmt, env), size); break
					default: this.writeV(rd, a, size)
				}
				break
			}
			case Op.FP_DP2: {
				const a = n()
				const b = m()
				let result: bigint
				switch (d.opc) {
					case FP2_FMUL: result = fpMul(a, b, fmt, env); break
					case FP2_FDIV: result = fpDiv(a, b, fmt, env); break
					case FP2_FADD: result = fpAdd(a, b, fmt, env); break
					case FP2_FSUB: result = fpAdd(a, b, fmt, env, true); break
					case FP2_FMAX: result = fpMinMax(a, b, true, false, fmt, env); break
					case FP2_FMIN: result = fpMinMax(a, b, false, false, fmt, env); break
					case FP2_FMAXNM: result = fpMinMax(a, b, true, true, fmt, env); break
					case FP2_FMINNM: result = fpMinMax(a, b, false, true, fmt, env); break
					// FNMUL negates the rounded product, a NaN's sign included.
					default: result = fpNeg(fpMul(a, b, fmt, env), fmt)
				}
				this.writeV(rd, result, size)
				break
			}
			case Op.FP_DP3: {
				// o1 negates the addend; o1 != o0 negates the first factor.
				const addend = this.readV(d.ra, size)
				const a = d.opc & 2 ? fpNeg(addend, fmt) : addend
				const first = d.opc === 1 || d.opc === 2 ? fpNeg(n(), fmt) : n()
				this.writeV(rd, fpMulAdd(a, first, m(), fmt, env), size)
				break
			}
			case Op.FP_CMP: this.setFlags(fpCompare(n(), d.opc & 1 ? 0n : m(), (d.opc & 2) !== 0, fmt, env)); break
			case Op.FP_CCMP:
				this.setFlags(conditionHolds(d.cond, this.nzcv) ? fpCompare(n(), m(), d.opc === 1, fmt, env) : Number(d.imm))
				break
			case Op.FP_CSEL: this.writeV(rd, conditionHolds(d.cond, this.nzcv) ? n() : m(), size); break
			case Op.FP_IMM: this.writeV(rd, d.imm, size); break
			case Op.FP_INT: case Op.FP_FIXED: {
				const width = d.sf ? 64 : 32
				const fbits = d.op === Op.FP_FIXED ? d.amount : 0
				switch (d.opc) {
					case FPI_FCVTS: case FPI_FCVTU: case FPI_FCVTAS: case FPI_FCVTAU: {
						const mode = d.opc >= FPI_FCVTAS ? ROUND_TIEAWAY : [ROUND_TIEEVEN, ROUND_POSINF, ROUND_NEGINF, ROUND_ZERO][d.shift]
						this.writeX(rd, fpToFixed(n(), fbits, (d.opc & 1) === 1, mode, width, fmt, env), d.sf)
						break
					}
					case FPI_SCVTF: this.writeV(rd, fixedToFp(BigInt.asIntN(width, this.read(rn, d.sf)), fbits, fmt, env), size); break
					case FPI_UCVTF: this.writeV(rd, fixedToFp(this.read(rn, d.sf), fbits, fmt, env), size); break
					case FPI_FMOV_TO: this.writeX(rd, n(), d.sf); break
					case FPI_FMOV_FROM: this.writeV(rd, this.read(rn, d.sf), size); break
				}
				break
			}
		}
		if (env.flags & ~this.fpsr) this.setFpsr((this.fpsr | env.flags) >>> 0)
	}

	private extendLoad(value: bigint, d: A64Instruction): bigint {
		const bits = d.size * 8
		if (d.access === ACCESS_SIGNED64) return BigInt.asUintN(64, BigInt.asIntN(bits, value))
		if (d.access === ACCESS_SIGNED32) return BigInt.asUintN(32, BigInt.asIntN(bits, value))
		return value
	}

	private branch(pc: number, offset: bigint): number {
		return this.absolute(BigInt(pc) + offset)
	}

	/** A branch target as a PC; one past every address faults on the fetch. */
	private absolute(target: bigint): number {
		const address = BigInt.asUintN(64, target)
		return address > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER - 3 : Number(address)
	}

	/** Records a fault for the step about to end; nothing changed. */
	fail(fault: number, address: number): number {
		this.fault = fault
		this.faultAddress = address
		return STEP_FAULT
	}
}
