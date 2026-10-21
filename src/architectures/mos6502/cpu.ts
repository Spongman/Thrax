/**
 * NMOS 6502 and W65C02S CPU cores, including unintended NMOS opcodes.
 *
 * - Memory is a flat 64 KiB; addresses wrap at $FFFF, the stack is page 1 at
 *   $0100 + SP and wraps within it, and zero-page indexing and pointers wrap
 *   within page 0.
 * - JMP ($xxFF) takes its high byte from $xx00, the NMOS page-wrap bug.
 * - Decimal mode follows the NMOS part (6502.org, "Decimal Mode", appendix A):
 *   ADC sets Z from the binary sum and N and V from the intermediate result;
 *   SBC sets every flag as binary subtraction does. `decimal` off ignores D,
 *   as the NES 2A03 does.
 * - Cycles include the page-crossing and taken-branch penalties. Dummy reads
 *   and the double write of read-modify-write instructions are not modelled.
 * - P keeps bit 5 set. B exists only on the stack: PHP and BRK push it set,
 *   interrupts push it clear.
 * - Unstable NMOS immediate instructions use a deterministic $EE magic mask;
 *   masked stores use the page-cross corruption observed in Visual6502.
 *
 * Data reads and writes in the I/O page go to `io` instead of memory;
 * instruction and pointer fetches always read memory. A read the device
 * cannot answer yet sets `waiting`; the step is then undone and returns
 * STEP_WAIT, to run again once it can.
 */

import {
	ABS, ABX, ABY, ACC, ADC, AND, ASL, BCC, BCS, BEQ, BIT, BMI, BNE, BPL, BRK, BVC, BVS, CLC, CLD, CLI, CLV, CMP, CPX, CPY,
	DEC, DEX, DEY, EOR, IMM, INC, IND, INX, INY, IZX, IZY, JMP, JSR, LDA, LDX, LDY, LSR, MODE_BYTES, NOP, OPCODE_CYCLES,
	OPCODE_INSN, OPCODE_MODE, OPCODE_PAGE_PENALTY, ORA, PHA, PHP, PLA, PLP, REL, ROL, ROR, RTI, RTS, SBC, SEC, SED, SEI,
	STA, STX, STY, TAX, TAY, TSX, TXA, TXS, TYA, ZP, ZPX, ZPY,
} from './isa'
import { AIX, BBR0, BBS0, BRA, NMOS_MODEL, PHX, PHY, PLX, PLY, RMB0, SMB0, STP, STZ, TRB, TSB, WAI, ZPI, ZPR, type CpuModel } from './isa'
import { AHX, ALR, ANC, ARR, AXS, DCP, IMP, ISC, KIL, LAS, LAX, RLA, RRA, SAX, SHX, SHY, SLO, SRE, TAS, XAA, maskedStoreAddress } from './isa'

/** Status register bits. */
export const FLAG_C = 0x01
export const FLAG_Z = 0x02
export const FLAG_I = 0x04
export const FLAG_D = 0x08
export const FLAG_B = 0x10
export const FLAG_U = 0x20
export const FLAG_V = 0x40
export const FLAG_N = 0x80

export const VECTOR_NMI = 0xFFFA
export const VECTOR_RESET = 0xFFFC
export const VECTOR_IRQ = 0xFFFE

/** Cycles the reset, interrupt and BRK sequences take. */
export const INTERRUPT_CYCLES = 7

/** What step() did. */
export const STEP_OK = 0
/** Nothing changed; see `fault`. */
export const STEP_FAULT = 2
/** BRK with no handler, or the program asked to stop; the PC stays on the instruction. */
export const STEP_HALT = 3
/** A device has nothing to read yet; nothing changed. */
export const STEP_WAIT = 4
/** The machine took an interrupt instead of running an instruction. */
export const STEP_INTERRUPT = 5

export const FAULT_NONE = 0
export const FAULT_ILLEGAL_INSTRUCTION = 1

/** Receives every memory write before it is made, with the byte it replaces. */
export interface Mos6502EffectSink {
	memory(address: number, old: number): void
}

/** The page of device registers. */
export const IO_PAGE = 0xF000

/** A device answering reads and writes in the I/O page. */
export interface Mos6502Io {
	/** Sets the CPU's `waiting` instead of answering when it cannot yet. */
	read(address: number): number
	write(address: number, value: number): void
}

const hex4 = (value: number) => `$${(value & 0xFFFF).toString(16).toUpperCase().padStart(4, '0')}`

export function faultMessage(fault: number, address: number, opcode: number): string {
	switch (fault) {
		case FAULT_ILLEGAL_INSTRUCTION: return `Illegal instruction $${opcode.toString(16).toUpperCase().padStart(2, '0')} at ${hex4(address)}`
		default: return 'No fault'
	}
}

export class Mos6502Cpu {
	constructor(readonly model: CpuModel = NMOS_MODEL) {}
	sleeping = false
	stopped = false
	a = 0
	x = 0
	y = 0
	sp = 0xFD
	p = FLAG_U | FLAG_I
	pc = 0
	/** Cycles since reset, its own seven included. */
	cycles = INTERRUPT_CYCLES
	readonly memory = new Uint8Array(0x10000)
	sink: Mos6502EffectSink | null = null
	io: Mos6502Io | null = null
	/** Set by `io` when it cannot answer a read yet. */
	waiting = false
	/** D takes effect in ADC and SBC; off for the 2A03. */
	decimal = true
	/** BRK halts rather than taking the IRQ vector, as when the program sets none. */
	brkHalts = false
	fault = FAULT_NONE
	faultAddress = 0
	/** The opcode of the last instruction stepped. */
	opcode = 0

	/** RESET: registers as the NMOS part leaves them, PC from the reset vector. Memory is kept. */
	reset() {
		this.sleeping = false
		this.stopped = false
		this.a = 0
		this.x = 0
		this.y = 0
		this.sp = 0xFD
		this.p = FLAG_U | FLAG_I
		this.pc = this.word(VECTOR_RESET)
		this.cycles = INTERRUPT_CYCLES
		this.fault = FAULT_NONE
		this.faultAddress = 0
		this.waiting = false
	}

	/** A little-endian word of memory, for vectors and debugger reads. */
	word(address: number): number {
		const memory = this.memory
		return memory[address & 0xFFFF] | (memory[(address + 1) & 0xFFFF] << 8)
	}

	loadBytes(address: number, bytes: Uint8Array) {
		if (address < 0 || address + bytes.length > 0x10000) throw new RangeError(`${bytes.length} bytes at ${hex4(address)} do not fit in memory`)
		this.memory.set(bytes, address)
	}

	/**
	 * Takes an interrupt through `vector`: pushes PC and P with B clear, sets I.
	 * The machine decides whether one is due; this always takes it.
	 */
	interrupt(vector: number) {
		if (this.stopped) return
		this.sleeping = false
		const pc = this.pc
		this.push(pc >> 8)
		this.push(pc & 0xFF)
		this.push((this.p & ~FLAG_B) | FLAG_U)
		this.p |= FLAG_I
		if (this.model.cmos) this.p &= ~FLAG_D
		this.pc = this.word(vector)
		this.cycles += INTERRUPT_CYCLES
	}

	/** Executes one instruction; returns a STEP_* code. */
	step(): number {
		if (this.stopped) return STEP_HALT
		if (this.sleeping) return STEP_WAIT
		const memory = this.memory
		const pc = this.pc
		const opcode = memory[pc]
		this.opcode = opcode
		this.waiting = false
		const insn = this.model.instructions[opcode]
		if (insn < 0) {
			this.fault = FAULT_ILLEGAL_INSTRUCTION
			this.faultAddress = pc
			return STEP_FAULT
		}
		if (insn === BRK && this.brkHalts) return STEP_HALT
		const mode = this.model.modes[opcode]
		const next = (pc + MODE_BYTES[mode]) & 0xFFFF
		const low = memory[(pc + 1) & 0xFFFF]
		let cycles = this.model.cycles[opcode]
		let address = 0
		let base = 0
		switch (mode) {
			case IMM: address = (pc + 1) & 0xFFFF; break
			case ZP: address = low; break
			case ZPX: address = (low + this.x) & 0xFF; break
			case ZPY: address = (low + this.y) & 0xFF; break
			case ABS: address = low | (memory[(pc + 2) & 0xFFFF] << 8); break
			case ABX:
			case ABY: {
				base = low | (memory[(pc + 2) & 0xFFFF] << 8)
				address = (base + (mode === ABX ? this.x : this.y)) & 0xFFFF
				if (this.model.penalties[opcode] && (base ^ address) & 0xFF00) cycles++
				break
			}
			case IND: {
				const pointer = low | (memory[(pc + 2) & 0xFFFF] << 8)
				// The high byte comes from the start of the pointer's page, not the next one.
				address = this.model.cmos ? this.word(pointer) : memory[pointer] | (memory[(pointer & 0xFF00) | ((pointer + 1) & 0xFF)] << 8)
				break
			}
			case IZX: {
				const pointer = (low + this.x) & 0xFF
				address = memory[pointer] | (memory[(pointer + 1) & 0xFF] << 8)
				break
			}
			case AIX: address = this.word((this.word((pc + 1) & 0xFFFF) + this.x) & 0xFFFF); break
			case ZPI: address = memory[low] | (memory[(low + 1) & 0xFF] << 8); break
			case ZPR: address = low; break
			case IZY: {
				base = memory[low] | (memory[(low + 1) & 0xFF] << 8)
				address = (base + this.y) & 0xFFFF
				if (this.model.penalties[opcode] && (base ^ address) & 0xFF00) cycles++
				break
			}
			case REL: address = (next + ((low << 24) >> 24)) & 0xFFFF; break
		}

		// Undone if a device read has to wait.
		const { a, x, y, sp, p } = this
		let target = next
		if (this.model.cmos && this.decimal && (this.p & FLAG_D) && (insn === ADC || insn === SBC)) cycles++
		switch (insn) {
			case LAX: {
				const value = this.read(address)
				this.a = this.x = this.nz(mode === IMM ? (this.a | 0xEE) & value : value)
				break
			}
			case SAX: this.write(address, this.a & this.x); break
			case LAS: this.a = this.x = this.sp = this.nz(this.read(address) & this.sp); break
			case DCP: case ISC: {
				const value = (this.read(address) + (insn === ISC ? 1 : -1)) & 255
				this.write(address, value)
				if (insn === DCP) this.compare(this.a, value)
				else this.sbc(value)
				break
			}
			case SLO: case RLA: case SRE: case RRA: {
				const operation = insn === SLO ? ASL : insn === RLA ? ROL : insn === SRE ? LSR : ROR
				const value = this.modify(operation, this.read(address))
				this.write(address, value)
				if (insn === RRA) this.adc(value)
				else this.a = this.nz(insn === SLO ? this.a | value : insn === RLA ? this.a & value : this.a ^ value)
				break
			}
			case ANC:
				this.a = this.nz(this.a & this.read(address))
				this.p = (this.p & ~FLAG_C) | (this.a >>> 7)
				break
			case ALR: this.a = this.modify(LSR, this.a & this.read(address)); break
			case ARR: this.arr(this.read(address)); break
			case AXS: {
				const value = this.read(address), combined = this.a & this.x
				this.compare(combined, value)
				this.x = (combined - value) & 255
				break
			}
			case XAA: this.a = this.nz((this.a | 0xEE) & this.x & this.read(address)); break
			case AHX: case SHX: case SHY: case TAS: {
				if (insn === TAS) this.sp = this.a & this.x
				const value = (insn === SHX ? this.x : insn === SHY ? this.y : this.a & this.x) & ((base >>> 8) + 1)
				this.write(maskedStoreAddress(base, address, value), value)
				break
			}
			case KIL: this.stopped = true; target = pc; break
			case STZ: this.write(address, 0); break
			case TRB: case TSB: {
				const value = this.read(address)
				this.p = (this.p & ~FLAG_Z) | ((value & this.a) === 0 ? FLAG_Z : 0)
				this.write(address, insn === TRB ? value & ~this.a : value | this.a)
				break
			}
			case PHX: this.push(this.x); break
			case PHY: this.push(this.y); break
			case PLX: this.x = this.nz(this.pull()); break
			case PLY: this.y = this.nz(this.pull()); break
			case WAI: this.sleeping = true; break
			case STP: this.stopped = true; break
			case LDA: this.a = this.nz(this.read(address)); break
			case LDX: this.x = this.nz(this.read(address)); break
			case LDY: this.y = this.nz(this.read(address)); break
			case STA: this.write(address, this.a); break
			case STX: this.write(address, this.x); break
			case STY: this.write(address, this.y); break
			case ADC: this.adc(this.read(address)); break
			case SBC: this.sbc(this.read(address)); break
			case AND: this.a = this.nz(this.a & this.read(address)); break
			case ORA: this.a = this.nz(this.a | this.read(address)); break
			case EOR: this.a = this.nz(this.a ^ this.read(address)); break
			case CMP: this.compare(this.a, this.read(address)); break
			case CPX: this.compare(this.x, this.read(address)); break
			case CPY: this.compare(this.y, this.read(address)); break
			case BIT: {
				const value = this.read(address)
				const mask = mode === IMM ? FLAG_Z : FLAG_N | FLAG_V | FLAG_Z
				this.p = (this.p & ~mask) | (mode === IMM ? 0 : value & (FLAG_N | FLAG_V)) | ((this.a & value) === 0 ? FLAG_Z : 0)
				break
			}
			case ASL: case LSR: case ROL: case ROR: case INC: case DEC: {
				const value = mode === ACC ? this.a : this.read(address)
				const result = this.modify(insn, value)
				if (mode === ACC) this.a = result
				else this.write(address, result)
				break
			}
			case INX: this.x = this.nz((this.x + 1) & 0xFF); break
			case INY: this.y = this.nz((this.y + 1) & 0xFF); break
			case DEX: this.x = this.nz((this.x - 1) & 0xFF); break
			case DEY: this.y = this.nz((this.y - 1) & 0xFF); break
			case TAX: this.x = this.nz(this.a); break
			case TAY: this.y = this.nz(this.a); break
			case TXA: this.a = this.nz(this.x); break
			case TYA: this.a = this.nz(this.y); break
			case TSX: this.x = this.nz(this.sp); break
			case TXS: this.sp = this.x; break
			case PHA: this.push(this.a); break
			case PHP: this.push(this.p | FLAG_B | FLAG_U); break
			case PLA: this.a = this.nz(this.pull()); break
			case PLP: this.p = (this.pull() & ~FLAG_B) | FLAG_U; break
			case CLC: this.p &= ~FLAG_C; break
			case SEC: this.p |= FLAG_C; break
			case CLI: this.p &= ~FLAG_I; break
			case SEI: this.p |= FLAG_I; break
			case CLD: this.p &= ~FLAG_D; break
			case SED: this.p |= FLAG_D; break
			case CLV: this.p &= ~FLAG_V; break
			case NOP:
				if (mode !== IMP) this.read(address)
				break
			case BCC: case BCS: case BEQ: case BNE: case BMI: case BPL: case BVC: case BVS:
			case BRA:
				if (this.taken(insn)) {
					cycles += (next ^ address) & 0xFF00 ? 2 : 1
					target = address
				}
				break
			case JMP: target = address; break
			case JSR: {
				const back = (next - 1) & 0xFFFF
				this.push(back >> 8)
				this.push(back & 0xFF)
				target = address
				break
			}
			case RTS: {
				const back = this.pull()
				target = ((back | (this.pull() << 8)) + 1) & 0xFFFF
				break
			}
			case RTI: {
				this.p = (this.pull() & ~FLAG_B) | FLAG_U
				const back = this.pull()
				target = back | (this.pull() << 8)
				break
			}
			case BRK: {
				// The byte after BRK is skipped: the return address is BRK + 2.
				const back = (pc + 2) & 0xFFFF
				this.push(back >> 8)
				this.push(back & 0xFF)
				this.push(this.p | FLAG_B | FLAG_U)
				this.p |= FLAG_I
				if (this.model.cmos) this.p &= ~FLAG_D
				target = this.word(VECTOR_IRQ)
				break
			}
			default:
				if (insn >= RMB0 && insn < BBR0) {
					const bit = 1 << ((insn - RMB0) & 7), value = this.read(address)
					this.write(address, insn < SMB0 ? value & ~bit : value | bit)
				} else if (insn >= BBR0 && insn < BBS0 + 8) {
					const bit = 1 << ((insn - BBR0) & 7), value = this.read(address)
					if (!!(value & bit) === (insn >= BBS0)) {
						target = (next + ((memory[(pc + 2) & 0xFFFF] << 24) >> 24)) & 0xFFFF
						cycles += (next ^ target) & 0xFF00 ? 2 : 1
					}
				}
		}
		if (this.waiting) {
			this.a = a
			this.x = x
			this.y = y
			this.sp = sp
			this.p = p
			return STEP_WAIT
		}
		this.pc = target
		this.cycles += cycles
		return STEP_OK
	}

	/** Whether the branch `insn` is taken under the flags as they are. */
	taken(insn: number): boolean {
		const p = this.p
		switch (insn) {
			case BRA: return true
			case BCC: return !(p & FLAG_C)
			case BCS: return (p & FLAG_C) !== 0
			case BNE: return !(p & FLAG_Z)
			case BEQ: return (p & FLAG_Z) !== 0
			case BPL: return !(p & FLAG_N)
			case BMI: return (p & FLAG_N) !== 0
			case BVC: return !(p & FLAG_V)
			case BVS: return (p & FLAG_V) !== 0
			default: return false
		}
	}

	/** A data read, from the device in the I/O page. */
	read(address: number): number {
		if ((address & 0xFF00) === IO_PAGE && this.io) return this.io.read(address) & 0xFF
		return this.memory[address]
	}

	/** A data write; dropped while a read in the same instruction waits. */
	write(address: number, value: number) {
		if (this.waiting) return
		if ((address & 0xFF00) === IO_PAGE && this.io) {
			this.io.write(address, value & 0xFF)
			return
		}
		this.sink?.memory(address, this.memory[address])
		this.memory[address] = value
	}

	private push(value: number) {
		this.write(0x100 | this.sp, value & 0xFF)
		this.sp = (this.sp - 1) & 0xFF
	}

	private pull(): number {
		this.sp = (this.sp + 1) & 0xFF
		return this.memory[0x100 | this.sp]
	}

	private nz(value: number): number {
		this.p = (this.p & ~(FLAG_N | FLAG_Z)) | (value & FLAG_N) | (value === 0 ? FLAG_Z : 0)
		return value
	}

	private compare(register: number, value: number) {
		const difference = register - value
		this.nz(difference & 0xFF)
		this.p = difference >= 0 ? this.p | FLAG_C : this.p & ~FLAG_C
	}

	private modify(insn: number, value: number): number {
		const carry = this.p & FLAG_C
		let result: number
		let out = carry
		switch (insn) {
			case ASL: result = (value << 1) & 0xFF; out = value >> 7; break
			case LSR: result = value >> 1; out = value & 1; break
			case ROL: result = ((value << 1) | carry) & 0xFF; out = value >> 7; break
			case ROR: result = (value >> 1) | (carry << 7); out = value & 1; break
			case INC: result = (value + 1) & 0xFF; break
			default: result = (value - 1) & 0xFF
		}
		this.p = (this.p & ~FLAG_C) | out
		return this.nz(result)
	}

	private adc(value: number) {
		const a = this.a
		const carry = this.p & FLAG_C
		const binary = a + value + carry
		let p = this.p & ~(FLAG_N | FLAG_V | FLAG_Z | FLAG_C)
		if ((binary & 0xFF) === 0) p |= FLAG_Z
		if (!(this.p & FLAG_D) || !this.decimal) {
			p |= (binary & FLAG_N) | (binary > 0xFF ? FLAG_C : 0) | (~(a ^ value) & (a ^ binary) & 0x80 ? FLAG_V : 0)
			this.p = p
			this.a = binary & 0xFF
			return
		}
		// NMOS decimal: Z from the binary sum, N and V from the sum before the high digit is adjusted.
		let low = (a & 0x0F) + (value & 0x0F) + carry
		if (low >= 0x0A) low = ((low + 0x06) & 0x0F) + 0x10
		let sum = (a & 0xF0) + (value & 0xF0) + low
		const signed = ((a & 0xF0) << 24 >> 24) + ((value & 0xF0) << 24 >> 24) + low
		p |= (sum & FLAG_N) | (signed < -128 || signed > 127 ? FLAG_V : 0)
		if (sum >= 0xA0) sum += 0x60
		if (sum > 0xFF) p |= FLAG_C
		this.p = p
		this.a = sum & 0xFF
		if (this.model.cmos) this.nz(this.a)
	}

	private sbc(value: number) {
		const a = this.a
		const borrow = 1 - (this.p & FLAG_C)
		const binary = a - value - borrow
		this.p = (this.p & ~(FLAG_N | FLAG_V | FLAG_Z | FLAG_C))
			| (binary & FLAG_N) | ((binary & 0xFF) === 0 ? FLAG_Z : 0) | (binary >= 0 ? FLAG_C : 0)
			| ((a ^ value) & (a ^ binary) & 0x80 ? FLAG_V : 0)
		if (!(this.p & FLAG_D) || !this.decimal) {
			this.a = binary & 0xFF
			return
		}
		// NMOS decimal: the flags are the binary ones; only the result is adjusted.
		let low = (a & 0x0F) - (value & 0x0F) - borrow
		if (low < 0) low = ((low - 0x06) & 0x0F) - 0x10
		let difference = (a & 0xF0) - (value & 0xF0) + low
		if (difference < 0) difference -= 0x60
		this.a = difference & 0xFF
		if (this.model.cmos) this.nz(this.a)
	}

	/** ARR's N/Z/V precede decimal adjustment; its carry is not ROR's bit 0. */
	private arr(value: number) {
		const anded = this.a & value
		let result = (anded >>> 1) | ((this.p & FLAG_C) << 7)
		this.nz(result)
		this.p = (this.p & ~(FLAG_C | FLAG_V)) | (((result >>> 6) ^ (result >>> 5)) & 1) * FLAG_V
		if (this.decimal && (this.p & FLAG_D)) {
			if ((anded & 15) + (anded & 1) > 5) result = (result & 0xF0) | ((result + 6) & 15)
			if ((anded & 0xF0) + (anded & 0x10) > 0x50) {
				result = (result + 0x60) & 255
				this.p |= FLAG_C
			}
		} else this.p |= (result >>> 6) & 1
		this.a = result
	}
}
