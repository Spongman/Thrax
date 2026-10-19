/**
 * MIT Beta CPU core, per the 6.004 Beta documentation (beta.pdf).
 *
 * Machine state: 32 registers (R31 reads 0, writes are discarded), a PC whose
 * bit 31 is the supervisor bit, and little-endian byte-addressed memory that
 * the CPU accesses a word at a time. There is no delay slot.
 *
 * Exceptions (beta.pdf section 6; 6.004 ISA notes 14.9):
 * - Reset: PC <- 0x80000000 (vector 0, supervisor mode). Registers clear to 0.
 * - Illegal opcode in user mode: XP <- PC+4, PC <- 0x80000004 (ILLOP).
 * - interrupt(vector): in user mode only, XP <- PC+4, PC <- 0x80000000 | vector.
 *   The machine profile owns the vector table and decides when to raise one.
 * - `segmentation` is BSim's base-and-bounds MMU (bsim_workbook.min.js
 *   physicalAddr, readWord, writeWord, executeCycle). A user-mode address A
 *   (bit 31 cleared) at or past `segBounds` traps to `segfaultVector`, else it
 *   reaches A + `segBase`. XP <- PC on a fetch, PC+4 on LD, ST or LDR, as
 *   BSim's PC has already advanced then. In supervisor mode LD and ST whose
 *   Ra + literal is -4 or -8 read and write the base and bounds registers.
 * - Illegal opcode in supervisor mode is "implementation-defined (probably
 *   fatal)" (section 6.3); here it is a fault that changes no state.
 * - Opcode 0x00 (privileged, section 6.5) goes to `privileged`, the machine
 *   profile's handler; with none attached it is illegal in both modes.
 *
 * Faults stop the step before any state changes and leave the reason in
 * `fault` and `faultAddress`:
 * - load, store or fetch outside memory, or a misaligned load or store;
 * - DIV/DIVC by zero, which the spec leaves undefined.
 */

import {
	OP_ADDC, OP_ANDC, OP_BEQ, OP_BNE, OP_CMPEQC, OP_CMPLEC, OP_CMPLTC, OP_DIVC, OP_JMP, OP_LD, OP_LDR,
	OP_MULC, OP_ORC, OP_PRIV, OP_SHLC, OP_SHRC, OP_SRAC, OP_ST, OP_SUBC, OP_XNORC, OP_XORC,
} from './isa'

export const SUPERVISOR = 0x80000000
const ADDRESS_MASK = 0x7FFFFFFF

/** Vectors the ISA fixes, as offsets from 0x80000000; the profile holds the rest. */
export const VEC_RESET = 0
export const VEC_ILLOP = 4

export const R_XP = 30
export const R_ZERO = 31

/** What step() did. */
export const STEP_OK = 0
/** An exception was taken; the CPU is at its vector. */
export const STEP_TRAP = 1
/** Nothing changed; see `fault`. */
export const STEP_FAULT = 2
/** A privileged HALT; the PC stays on it. */
export const STEP_HALT = 3
/** A privileged op is waiting, for input say; the PC stays on it. */
export const STEP_WAIT = 4
/** The machine took an interrupt instead of running an instruction. */
export const STEP_INTERRUPT = 5

/** Supervisor-mode LD/ST addresses (Ra + literal) of BSim's MMU registers. */
export const SEG_BASE = -4
export const SEG_BOUNDS = -8
/** Bounds at reset: nothing faults. */
const NO_BOUNDS = 0xFFFFFFFF

/** Outcomes of BetaPrivilegedHandler.execute(). */
export const PRIV_ILLEGAL = 0
export const PRIV_NEXT = 1
export const PRIV_HALT = 2
export const PRIV_WAIT = 3
/** Write the handler's `value` to R0, then continue. */
export const PRIV_WRITE_R0 = 4

export const FAULT_NONE = 0
export const FAULT_ADDRESS = 1
export const FAULT_MISALIGNED = 2
export const FAULT_DIVIDE_BY_ZERO = 3
export const FAULT_ILLEGAL_INSTRUCTION = 4

/**
 * Receives every state change before it is made, with the value it replaces,
 * so a history layer can undo it. Called only from step() and interrupt().
 */
export interface BetaEffectSink {
	register(index: number, old: number): void
	/** `address` is word aligned; `oldWord` is the signed 32-bit value there. */
	memory(address: number, oldWord: number): void
	pc(old: number): void
}

/** Machine profile for opcode 0x00; must not change CPU state itself. */
export interface BetaPrivilegedHandler {
	/** Result for PRIV_WRITE_R0. */
	value: number
	/** `a` is the value of register Ra; returns a PRIV_* code. */
	execute(word: number, a: number, supervisor: boolean): number
}

export interface BetaCpuOptions {
	/** Memory size in bytes, a positive multiple of 4. */
	memoryBytes?: number
}

export const DEFAULT_MEMORY_BYTES = 1 << 20

const hex = (value: number) => `0x${(value >>> 0).toString(16).toUpperCase().padStart(8, '0')}`

export function faultMessage(fault: number, address: number): string {
	switch (fault) {
		case FAULT_ADDRESS: return `Memory access outside memory at ${hex(address)}`
		case FAULT_MISALIGNED: return `Misaligned word access at ${hex(address)}`
		case FAULT_DIVIDE_BY_ZERO: return `Division by zero at ${hex(address)}`
		case FAULT_ILLEGAL_INSTRUCTION: return `Illegal instruction in supervisor mode at ${hex(address)}`
		default: return 'No fault'
	}
}

export class BetaCpu {
	/** R31 is held at 0 and never written. */
	readonly registers = new Int32Array(32)
	/** Unsigned; bit 31 is the supervisor bit. */
	pc = (SUPERVISOR | VEC_RESET) >>> 0
	readonly memory: Uint8Array
	private readonly view: DataView
	sink: BetaEffectSink | null = null
	privileged: BetaPrivilegedHandler | null = null
	/** Why the last STEP_FAULT happened, and the address it concerns. */
	fault = FAULT_NONE
	faultAddress = 0
	/** Vector for segmentation faults, or -1 to fault instead. */
	segfaultVector = -1
	/** BSim `.options segmentation`: user-mode addresses go through base and bounds. */
	segmentation = false
	segBase = 0
	/** Unsigned. */
	segBounds = NO_BOUNDS
	/** The word the last step() fetched. */
	instruction = 0

	constructor(options: BetaCpuOptions = {}) {
		const bytes = options.memoryBytes ?? DEFAULT_MEMORY_BYTES
		if (!(bytes > 0 && bytes % 4 === 0 && bytes <= SUPERVISOR)) throw new RangeError(`Invalid Beta memory size ${bytes}`)
		this.memory = new Uint8Array(bytes)
		this.view = new DataView(this.memory.buffer)
	}

	get supervisor(): boolean {
		return (this.pc & SUPERVISOR) !== 0
	}

	/** Power-up: supervisor mode at vector 0, registers cleared. Memory is kept. */
	reset() {
		this.registers.fill(0)
		this.pc = (SUPERVISOR | VEC_RESET) >>> 0
		this.fault = FAULT_NONE
		this.faultAddress = 0
		this.segBase = 0
		this.segBounds = NO_BOUNDS
	}

	/** Where the next instruction is fetched from, through the MMU; bounds are not checked. */
	fetchAddress(): number {
		const pc = this.pc
		const at = pc & 0x7FFFFFFC
		return this.segmentation && !(pc & SUPERVISOR) ? (at + this.segBase) & 0x7FFFFFFC : at
	}

	/** Executes one instruction; returns a STEP_* code. */
	step(): number {
		const pc = this.pc
		let fetch = pc & 0x7FFFFFFC
		if (this.segmentation && !(pc & SUPERVISOR)) {
			if (fetch >= this.segBounds) return this.segfault(pc, fetch)
			fetch = (fetch + this.segBase) & 0x7FFFFFFC
		}
		if (fetch > this.memory.length - 4) return this.fail(FAULT_ADDRESS, fetch)
		const word = this.view.getInt32(fetch, true)
		this.instruction = word
		const next = ((pc & SUPERVISOR) | ((pc + 4) & ADDRESS_MASK)) >>> 0
		const opcode = word >>> 26
		const rc = (word >>> 21) & 31
		const regs = this.registers
		const a = regs[(word >>> 16) & 31]
		const literal = (word << 16) >> 16

		if (opcode >= 0x20) {
			// OP and OPC differ only in bit 4 and where b comes from.
			const b = opcode & 0x10 ? literal : regs[(word >>> 11) & 31]
			let result: number
			switch (opcode | 0x10) {
				case OP_ADDC: result = (a + b) | 0; break
				case OP_SUBC: result = (a - b) | 0; break
				case OP_MULC: result = Math.imul(a, b); break
				case OP_DIVC:
					if (b === 0) return this.fail(FAULT_DIVIDE_BY_ZERO, fetch)
					// Low 32 bits of the truncated quotient: -2^31 / -1 gives -2^31.
					result = (a / b) | 0
					break
				case OP_CMPEQC: result = a === b ? 1 : 0; break
				case OP_CMPLTC: result = a < b ? 1 : 0; break
				case OP_CMPLEC: result = a <= b ? 1 : 0; break
				case OP_ANDC: result = a & b; break
				case OP_ORC: result = a | b; break
				case OP_XORC: result = a ^ b; break
				case OP_XNORC: result = ~(a ^ b); break
				// JavaScript shifts use the count's low 5 bits, as the spec does.
				case OP_SHLC: result = a << b; break
				case OP_SHRC: result = (a >>> b) | 0; break
				case OP_SRAC: result = a >> b; break
				default: return this.illegal(fetch, next)
			}
			this.writeRegister(rc, result)
			this.setPc(next)
			return STEP_OK
		}

		switch (opcode) {
			case OP_LD: {
				const sum = a + literal
				if (this.isMmuRegister(sum)) {
					this.writeRegister(rc, sum === SEG_BASE ? this.segBase : this.segBounds | 0)
					break
				}
				const address = this.map(sum >>> 0)
				if (address < 0) return this.segfault(next, sum >>> 0)
				const fault = this.accessFault(address)
				if (fault) return this.fail(fault, address)
				this.writeRegister(rc, this.view.getInt32(address, true))
				break
			}
			case OP_ST: {
				const sum = a + literal
				if (this.isMmuRegister(sum)) {
					// The history sees MMU changes by comparing before and after.
					if (sum === SEG_BASE) this.segBase = regs[rc]
					else this.segBounds = regs[rc] >>> 0
					break
				}
				const address = this.map(sum >>> 0)
				if (address < 0) return this.segfault(next, sum >>> 0)
				const fault = this.accessFault(address)
				if (fault) return this.fail(fault, address)
				this.sink?.memory(address, this.view.getInt32(address, true))
				this.view.setInt32(address, regs[rc], true)
				break
			}
			case OP_JMP: {
				// May clear the supervisor bit, never set it; target taken before Rc is written.
				const target = (a & 0xFFFFFFFC & (ADDRESS_MASK | pc)) >>> 0
				this.writeRegister(rc, next | 0)
				this.setPc(target)
				return STEP_OK
			}
			case OP_BEQ:
			case OP_BNE: {
				this.writeRegister(rc, next | 0)
				if ((a === 0) === (opcode === OP_BEQ)) {
					this.setPc(((pc & SUPERVISOR) | ((next + literal * 4) & ADDRESS_MASK)) >>> 0)
					return STEP_OK
				}
				break
			}
			case OP_PRIV: {
				const handler = this.privileged
				if (!handler) return this.illegal(fetch, next)
				switch (handler.execute(word, a, (pc & SUPERVISOR) !== 0)) {
					case PRIV_NEXT: break
					case PRIV_HALT: return STEP_HALT
					case PRIV_WAIT: return STEP_WAIT
					case PRIV_WRITE_R0: this.writeRegister(0, handler.value); break
					default: return this.illegal(fetch, next)
				}
				break
			}
			case OP_LDR: {
				// Ra is ignored, and the supervisor bit is treated as 0.
				const virtual = ((next & ADDRESS_MASK) + literal * 4) >>> 0
				const address = this.map(virtual)
				if (address < 0) return this.segfault(next, virtual)
				const fault = this.accessFault(address)
				if (fault) return this.fail(fault, address)
				this.writeRegister(rc, this.view.getInt32(address, true))
				break
			}
			default: return this.illegal(fetch, next)
		}
		this.setPc(next)
		return STEP_OK
	}

	/**
	 * Takes an interrupt to `vector` if in user mode; interrupts are disabled in
	 * supervisor mode. XP gets the address of the instruction after the one that
	 * would have run next.
	 */
	interrupt(vector: number): boolean {
		if (this.supervisor) return false
		this.writeRegister(R_XP, (this.pc + 4) | 0)
		this.setPc((SUPERVISOR | vector) >>> 0)
		return true
	}

	/** Debugger access: not recorded, throws on an inaccessible address. */
	readWord(address: number): number {
		this.check(address)
		return this.view.getInt32(address, true)
	}

	writeWord(address: number, value: number) {
		this.check(address)
		this.view.setInt32(address, value, true)
	}

	loadBytes(address: number, bytes: Uint8Array) {
		if (address < 0 || address + bytes.length > this.memory.length) {
			throw new RangeError(`${bytes.length} bytes at ${hex(address)} do not fit in memory`)
		}
		this.memory.set(bytes, address)
	}

	/** Debugger and rewind write: not recorded; writes to R31 are ignored. */
	setRegister(index: number, value: number) {
		if (index !== R_ZERO) this.registers[index] = value
	}

	private check(address: number) {
		const fault = this.accessFault(address)
		if (fault) throw new RangeError(faultMessage(fault, address))
	}

	/** The fault a word access at `address` would raise, or FAULT_NONE. */
	private accessFault(address: number): number {
		if (address & 3) return FAULT_MISALIGNED
		if (address < 0 || address > this.memory.length - 4) return FAULT_ADDRESS
		return FAULT_NONE
	}

	private illegal(fetch: number, next: number): number {
		if (this.pc & SUPERVISOR) return this.fail(FAULT_ILLEGAL_INSTRUCTION, fetch)
		this.writeRegister(R_XP, next | 0)
		this.setPc((SUPERVISOR | VEC_ILLOP) >>> 0)
		return STEP_TRAP
	}

	private isMmuRegister(sum: number): boolean {
		return this.segmentation && (this.pc & SUPERVISOR) !== 0 && (sum === SEG_BASE || sum === SEG_BOUNDS)
	}

	/**
	 * The physical address a data access at `address` reaches, or -1 past the
	 * segment bounds. A misaligned address is left for accessFault to report.
	 */
	private map(address: number): number {
		if (!this.segmentation || (this.pc & SUPERVISOR) || (address & 3)) return address
		const virtual = address & ADDRESS_MASK
		if (virtual >= this.segBounds) return -1
		return (virtual + this.segBase) & 0x7FFFFFFC
	}

	/** Traps a bounds violation with XP <- `xp`, or faults where no vector is set. */
	private segfault(xp: number, address: number): number {
		if (this.segfaultVector < 0) return this.fail(FAULT_ADDRESS, address)
		this.writeRegister(R_XP, xp | 0)
		this.setPc((SUPERVISOR | this.segfaultVector) >>> 0)
		return STEP_TRAP
	}

	private fail(fault: number, address: number): number {
		this.fault = fault
		this.faultAddress = address >>> 0
		return STEP_FAULT
	}

	private writeRegister(index: number, value: number) {
		if (index === R_ZERO) return
		this.sink?.register(index, this.registers[index])
		this.registers[index] = value
	}

	private setPc(value: number) {
		this.sink?.pc(this.pc)
		this.pc = value
	}
}
