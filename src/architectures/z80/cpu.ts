/**
 * The Zilog Z80: every documented instruction, the CB, ED, DD/FD and DDCB/FDCB
 * prefixes, and the undocumented ones programs use (IXH/IXL/IYH/IYL, SLL, the
 * DDCB forms that also copy the result to a register, IN F,(C), OUT (C),0, the
 * ED mirrors of NEG, RETN and IM). Flags are exact including H and P/V; the
 * undocumented bits 3 and 5 follow the usual rules, except BIT n,(HL), whose
 * bits come from H rather than the internal MEMPTR register.
 *
 * A step runs one instruction, all its prefixes included, and counts its
 * T-states. R counts M1 cycles: one per opcode fetch, so two for a prefixed
 * instruction, keeping bit 7. HALT holds the PC on itself and runs NOPs until
 * an interrupt moves it on.
 */

/** Flag bits of F. */
export const FLAG_C = 0x01
export const FLAG_N = 0x02
export const FLAG_PV = 0x04
export const FLAG_X = 0x08
export const FLAG_H = 0x10
export const FLAG_Y = 0x20
export const FLAG_Z = 0x40
export const FLAG_S = 0x80

const C = FLAG_C, N = FLAG_N, PV = FLAG_PV, H = FLAG_H, Z = FLAG_Z, S = FLAG_S
/** The undocumented bits 3 and 5. */
const XY = FLAG_X | FLAG_Y

/** Sign, zero and bits 3 and 5 of a byte. */
const SZ = new Uint8Array(256)
/** The same with parity. */
const SZP = new Uint8Array(256)
for (let value = 0; value < 256; value++) {
	SZ[value] = (value & (S | XY)) | (value === 0 ? Z : 0)
	let bits = value
	bits ^= bits >> 4
	bits ^= bits >> 2
	bits ^= bits >> 1
	SZP[value] = SZ[value] | ((bits & 1) === 0 ? PV : 0)
}

/** Slots of the register state a snapshot holds, in a fixed order. */
export const SLOT_AF = 0
export const SLOT_BC = 1
export const SLOT_DE = 2
export const SLOT_HL = 3
export const SLOT_AF_ALT = 4
export const SLOT_BC_ALT = 5
export const SLOT_DE_ALT = 6
export const SLOT_HL_ALT = 7
export const SLOT_IX = 8
export const SLOT_IY = 9
export const SLOT_SP = 10
export const SLOT_PC = 11
export const SLOT_I = 12
export const SLOT_R = 13
export const SLOT_IFF1 = 14
export const SLOT_IFF2 = 15
export const SLOT_IM = 16
export const SLOT_HALTED = 17
export const SLOT_EI_DELAY = 18
export const SLOT_COUNT = 19

/** Where the CPU's memory and I/O go beyond plain RAM. */
export interface Z80Bus {
	/** A data read of a device register, or undefined where RAM answers. */
	readDevice(address: number): number | undefined
	/** A data write a device takes; false where RAM keeps it. */
	writeDevice(address: number, value: number): boolean
	input(port: number): number
	output(port: number, value: number): void
}

/** Told the old byte before each RAM write, so the write can be undone. */
export interface Z80MemorySink {
	memory(address: number, old: number): void
}

/** Data accesses as the tools see them; instruction fetches are not reported. */
export interface Z80AccessObserver {
	read(address: number): void
	write(address: number, value: number): void
}

const NO_BUS: Z80Bus = {
	readDevice: () => undefined,
	writeDevice: () => false,
	input: () => 0xFF,
	output: () => {},
}

export const MEMORY_BYTES = 0x10000

export class Z80Cpu {
	readonly memory = new Uint8Array(MEMORY_BYTES)
	bus: Z80Bus = NO_BUS
	sink: Z80MemorySink | null = null
	observer: Z80AccessObserver | null = null

	a = 0xFF
	f = 0xFF
	b = 0
	c = 0
	d = 0
	e = 0
	h = 0
	l = 0
	af2 = 0xFFFF
	bc2 = 0
	de2 = 0
	hl2 = 0
	ix = 0
	iy = 0
	sp = 0xFFFF
	pc = 0
	i = 0
	r = 0
	iff1 = 0
	iff2 = 0
	im = 0
	/** Executing HALT: the PC stays on it until an interrupt. */
	halted = 0
	/** EI ran last, so no maskable interrupt is taken before the next instruction. */
	eiDelay = 0
	/** T-states since reset. */
	cycles = 0

	/** 0 for HL, 1 for IX, 2 for IY: what the instruction being run uses. */
	private index = 0
	/** Address of (IX+d) or (IY+d) once read. */
	private indexed = 0

	/** Registers as a reset leaves them: AF and SP all ones, the rest zero. */
	reset() {
		this.a = this.f = 0xFF
		this.b = this.c = this.d = this.e = this.h = this.l = 0
		this.af2 = 0xFFFF
		this.bc2 = this.de2 = this.hl2 = 0
		this.ix = this.iy = 0
		this.sp = 0xFFFF
		this.pc = 0
		this.i = this.r = 0
		this.iff1 = this.iff2 = this.im = 0
		this.halted = this.eiDelay = 0
		this.cycles = 0
		this.memory.fill(0)
	}

	get af() { return (this.a << 8) | this.f }
	set af(value: number) { this.a = (value >> 8) & 0xFF; this.f = value & 0xFF }
	get bc() { return (this.b << 8) | this.c }
	set bc(value: number) { this.b = (value >> 8) & 0xFF; this.c = value & 0xFF }
	get de() { return (this.d << 8) | this.e }
	set de(value: number) { this.d = (value >> 8) & 0xFF; this.e = value & 0xFF }
	get hl() { return (this.h << 8) | this.l }
	set hl(value: number) { this.h = (value >> 8) & 0xFF; this.l = value & 0xFF }

	/** One slot of the register state; see SLOT_*. */
	slot(slot: number): number {
		switch (slot) {
			case SLOT_AF: return this.af
			case SLOT_BC: return this.bc
			case SLOT_DE: return this.de
			case SLOT_HL: return this.hl
			case SLOT_AF_ALT: return this.af2
			case SLOT_BC_ALT: return this.bc2
			case SLOT_DE_ALT: return this.de2
			case SLOT_HL_ALT: return this.hl2
			case SLOT_IX: return this.ix
			case SLOT_IY: return this.iy
			case SLOT_SP: return this.sp
			case SLOT_PC: return this.pc
			case SLOT_I: return this.i
			case SLOT_R: return this.r
			case SLOT_IFF1: return this.iff1
			case SLOT_IFF2: return this.iff2
			case SLOT_IM: return this.im
			case SLOT_HALTED: return this.halted
			case SLOT_EI_DELAY: return this.eiDelay
		}
		throw new RangeError(`No register slot ${slot}`)
	}

	setSlot(slot: number, value: number) {
		const word = value & 0xFFFF
		switch (slot) {
			case SLOT_AF: this.af = word; return
			case SLOT_BC: this.bc = word; return
			case SLOT_DE: this.de = word; return
			case SLOT_HL: this.hl = word; return
			case SLOT_AF_ALT: this.af2 = word; return
			case SLOT_BC_ALT: this.bc2 = word; return
			case SLOT_DE_ALT: this.de2 = word; return
			case SLOT_HL_ALT: this.hl2 = word; return
			case SLOT_IX: this.ix = word; return
			case SLOT_IY: this.iy = word; return
			case SLOT_SP: this.sp = word; return
			case SLOT_PC: this.pc = word; return
			case SLOT_I: this.i = value & 0xFF; return
			case SLOT_R: this.r = value & 0xFF; return
			case SLOT_IFF1: this.iff1 = value & 1; return
			case SLOT_IFF2: this.iff2 = value & 1; return
			case SLOT_IM: this.im = value & 3; return
			case SLOT_HALTED: this.halted = value & 1; return
			case SLOT_EI_DELAY: this.eiDelay = value & 1; return
		}
		throw new RangeError(`No register slot ${slot}`)
	}

	/** Every slot into `into`, for a history entry to compare against. */
	snapshot(into: Int32Array) {
		for (let slot = 0; slot < SLOT_COUNT; slot++) into[slot] = this.slot(slot)
	}

	loadBytes(address: number, bytes: ArrayLike<number>) {
		for (let offset = 0; offset < bytes.length; offset++) this.memory[(address + offset) & 0xFFFF] = bytes[offset] & 0xFF
	}

	/** A RAM write past the devices, recorded for rewind. */
	poke(address: number, value: number) {
		const at = address & 0xFFFF
		this.sink?.memory(at, this.memory[at])
		this.memory[at] = value & 0xFF
	}

	/* ------------------------------------------------------------ the bus */

	read8(address: number): number {
		const at = address & 0xFFFF
		this.observer?.read(at)
		return this.bus.readDevice(at) ?? this.memory[at]
	}

	write8(address: number, value: number) {
		const at = address & 0xFFFF
		const byte = value & 0xFF
		this.observer?.write(at, byte)
		if (this.bus.writeDevice(at, byte)) return
		this.sink?.memory(at, this.memory[at])
		this.memory[at] = byte
	}

	private read16(address: number): number {
		return this.read8(address) | (this.read8(address + 1) << 8)
	}

	private write16(address: number, value: number) {
		this.write8(address, value)
		this.write8(address + 1, value >> 8)
	}

	private fetch8(): number {
		const value = this.memory[this.pc]
		this.pc = (this.pc + 1) & 0xFFFF
		return value
	}

	private fetch16(): number {
		const low = this.fetch8()
		return low | (this.fetch8() << 8)
	}

	/** An opcode fetch: an M1 cycle, which counts in R. */
	private fetchOpcode(): number {
		this.r = (this.r & 0x80) | ((this.r + 1) & 0x7F)
		return this.fetch8()
	}

	private push(value: number) {
		this.sp = (this.sp - 1) & 0xFFFF
		this.write8(this.sp, value >> 8)
		this.sp = (this.sp - 1) & 0xFFFF
		this.write8(this.sp, value)
	}

	private pop(): number {
		const value = this.read16(this.sp)
		this.sp = (this.sp + 2) & 0xFFFF
		return value
	}

	/* --------------------------------------------------------- interrupts */

	/** Whether a maskable interrupt would be taken before the next instruction. */
	get interruptible(): boolean {
		return this.iff1 !== 0 && this.eiDelay === 0
	}

	/** Leaves HALT; the return address is the instruction after it. */
	private wake() {
		if (!this.halted) return
		this.halted = 0
		this.pc = (this.pc + 1) & 0xFFFF
	}

	/** Takes a non-maskable interrupt: RST to 0x0066 with IFF1 cleared and IFF2 keeping it. */
	nmi() {
		this.wake()
		this.r = (this.r & 0x80) | ((this.r + 1) & 0x7F)
		this.iff1 = 0
		this.eiDelay = 0
		this.push(this.pc)
		this.pc = 0x0066
		this.cycles += 11
	}

	/**
	 * Takes a maskable interrupt with `data` on the bus, or returns false while
	 * interrupts are disabled. IM 0 runs the byte as an instruction, which THRAX
	 * supports for RST; any other byte is taken as RST 38h.
	 */
	interrupt(data: number): boolean {
		if (!this.interruptible) return false
		this.wake()
		this.r = (this.r & 0x80) | ((this.r + 1) & 0x7F)
		this.iff1 = this.iff2 = 0
		this.push(this.pc)
		if (this.im === 2) {
			this.pc = this.read16((this.i << 8) | (data & 0xFF))
			this.cycles += 19
		} else {
			this.pc = this.im === 0 && (data & 0xC7) === 0xC7 ? data & 0x38 : 0x38
			this.cycles += 13
		}
		return true
	}

	/* --------------------------------------------------------- arithmetic */

	private add8(value: number, carry: number) {
		const a = this.a
		const result = a + value + carry
		this.f = SZ[result & 0xFF] | ((result >> 8) & C) | ((a ^ value ^ result) & H) | (((a ^ ~value) & (a ^ result) & 0x80) >> 5)
		this.a = result & 0xFF
	}

	private sub8(value: number, carry: number) {
		const a = this.a
		const result = a - value - carry
		this.f = SZ[result & 0xFF] | ((result >> 8) & C) | N | ((a ^ value ^ result) & H) | (((a ^ value) & (a ^ result) & 0x80) >> 5)
		this.a = result & 0xFF
	}

	private compare(value: number) {
		const a = this.a
		const result = a - value
		// Bits 3 and 5 come from the operand, not the result.
		this.f = (SZ[result & 0xFF] & ~XY) | (value & XY) | ((result >> 8) & C) | N | ((a ^ value ^ result) & H) | (((a ^ value) & (a ^ result) & 0x80) >> 5)
	}

	/** ADD A, ADC A, SUB, SBC A, AND, XOR, OR, CP by the y field. */
	private alu(operation: number, value: number) {
		switch (operation) {
			case 0: this.add8(value, 0); return
			case 1: this.add8(value, this.f & C); return
			case 2: this.sub8(value, 0); return
			case 3: this.sub8(value, this.f & C); return
			case 4: this.a &= value; this.f = SZP[this.a] | H; return
			case 5: this.a ^= value; this.f = SZP[this.a]; return
			case 6: this.a |= value; this.f = SZP[this.a]; return
			default: this.compare(value)
		}
	}

	private inc8(value: number): number {
		const result = (value + 1) & 0xFF
		this.f = (this.f & C) | SZ[result] | (result === 0x80 ? PV : 0) | ((result & 0x0F) === 0 ? H : 0)
		return result
	}

	private dec8(value: number): number {
		const result = (value - 1) & 0xFF
		this.f = (this.f & C) | SZ[result] | N | (result === 0x7F ? PV : 0) | ((value & 0x0F) === 0 ? H : 0)
		return result
	}

	private add16(left: number, right: number): number {
		const result = left + right
		this.f = (this.f & (S | Z | PV)) | ((result >> 16) & C) | (((left ^ right ^ result) >> 8) & H) | ((result >> 8) & XY)
		return result & 0xFFFF
	}

	private adc16(value: number) {
		const hl = this.hl
		const result = hl + value + (this.f & C)
		this.f = ((result >> 16) & C) | (((hl ^ value ^ result) >> 8) & H) | (((hl ^ ~value) & (hl ^ result) & 0x8000) >> 13)
			| ((result >> 8) & (S | XY)) | ((result & 0xFFFF) === 0 ? Z : 0)
		this.hl = result & 0xFFFF
	}

	private sbc16(value: number) {
		const hl = this.hl
		const result = hl - value - (this.f & C)
		this.f = N | ((result >> 16) & C) | (((hl ^ value ^ result) >> 8) & H) | (((hl ^ value) & (hl ^ result) & 0x8000) >> 13)
			| ((result >> 8) & (S | XY)) | ((result & 0xFFFF) === 0 ? Z : 0)
		this.hl = result & 0xFFFF
	}

	private daa() {
		const a = this.a
		let correction = 0
		let carry = this.f & C
		if ((this.f & H) || (a & 0x0F) > 9) correction |= 0x06
		if (carry || a > 0x99) {
			correction |= 0x60
			carry = C
		}
		let half: number
		let result: number
		if (this.f & N) {
			half = (this.f & H) && (a & 0x0F) < 6 ? H : 0
			result = (a - correction) & 0xFF
		} else {
			half = (a & 0x0F) > 9 ? H : 0
			result = (a + correction) & 0xFF
		}
		this.a = result
		this.f = SZP[result] | half | (this.f & N) | carry
	}

	/** RLC, RRC, RL, RR, SLA, SRA, SLL, SRL by the y field. */
	private shift(operation: number, value: number): number {
		let carry: number
		let result: number
		switch (operation) {
			case 0: carry = value >> 7; result = ((value << 1) | carry) & 0xFF; break
			case 1: carry = value & 1; result = (value >> 1) | (carry << 7); break
			case 2: carry = value >> 7; result = ((value << 1) | (this.f & C)) & 0xFF; break
			case 3: carry = value & 1; result = (value >> 1) | ((this.f & C) << 7); break
			case 4: carry = value >> 7; result = (value << 1) & 0xFF; break
			case 5: carry = value & 1; result = (value >> 1) | (value & 0x80); break
			case 6: carry = value >> 7; result = ((value << 1) | 1) & 0xFF; break
			default: carry = value & 1; result = value >> 1
		}
		this.f = SZP[result] | carry
		return result
	}

	/** BIT n: bits 3 and 5 come from `xy`, the operand or the address high byte. */
	private bit(bit: number, value: number, xy: number) {
		const set = value & (1 << bit)
		this.f = (this.f & C) | H | (set ? 0 : Z | PV) | (bit === 7 && set ? S : 0) | (xy & XY)
	}

	/** Condition codes NZ, Z, NC, C, PO, PE, P, M by the y field. */
	private condition(code: number): boolean {
		const flag = [Z, C, PV, S][code >> 1]
		return ((this.f & flag) !== 0) === ((code & 1) !== 0)
	}

	/* ------------------------------------------------- operand addressing */

	/** B C D E H L (HL) A by index; H, L and (HL) follow the prefix in force. */
	private reg8(code: number): number {
		switch (code) {
			case 0: return this.b
			case 1: return this.c
			case 2: return this.d
			case 3: return this.e
			case 4: return this.index === 0 ? this.h : this.index === 1 ? this.ix >> 8 : this.iy >> 8
			case 5: return this.index === 0 ? this.l : this.index === 1 ? this.ix & 0xFF : this.iy & 0xFF
			case 6: return this.read8(this.index === 0 ? this.hl : this.indexed)
			default: return this.a
		}
	}

	private setReg8(code: number, value: number) {
		switch (code) {
			case 0: this.b = value; return
			case 1: this.c = value; return
			case 2: this.d = value; return
			case 3: this.e = value; return
			case 4:
				if (this.index === 0) this.h = value
				else if (this.index === 1) this.ix = (this.ix & 0xFF) | (value << 8)
				else this.iy = (this.iy & 0xFF) | (value << 8)
				return
			case 5:
				if (this.index === 0) this.l = value
				else if (this.index === 1) this.ix = (this.ix & 0xFF00) | value
				else this.iy = (this.iy & 0xFF00) | value
				return
			case 6: this.write8(this.index === 0 ? this.hl : this.indexed, value); return
			default: this.a = value
		}
	}

	/** H, L as themselves whatever the prefix, for LD H,(IX+d) and LD (IX+d),L. */
	private plainReg8(code: number): number {
		return code === 4 ? this.h : code === 5 ? this.l : this.reg8(code)
	}

	private setPlainReg8(code: number, value: number) {
		if (code === 4) this.h = value
		else if (code === 5) this.l = value
		else this.setReg8(code, value)
	}

	/** HL, IX or IY: the pair the prefix in force names. */
	private get pairHL(): number {
		return this.index === 0 ? this.hl : this.index === 1 ? this.ix : this.iy
	}

	private set pairHL(value: number) {
		if (this.index === 0) this.hl = value
		else if (this.index === 1) this.ix = value
		else this.iy = value
	}

	/** BC DE HL SP by the p field. */
	private rp(code: number): number {
		switch (code) {
			case 0: return this.bc
			case 1: return this.de
			case 2: return this.pairHL
			default: return this.sp
		}
	}

	private setRp(code: number, value: number) {
		switch (code) {
			case 0: this.bc = value; return
			case 1: this.de = value; return
			case 2: this.pairHL = value; return
			default: this.sp = value
		}
	}

	/** Reads the displacement of (IX+d) and works out the address. */
	private displace() {
		const offset = this.fetch8()
		this.indexed = (this.pairHL + ((offset << 24) >> 24)) & 0xFFFF
	}

	/* ------------------------------------------------------- the step */

	/** Runs one instruction, or one NOP while halted; returns its T-states. */
	step(): number {
		this.eiDelay = 0
		if (this.halted) {
			this.r = (this.r & 0x80) | ((this.r + 1) & 0x7F)
			this.cycles += 4
			return 4
		}
		this.index = 0
		let states = 0
		let opcode = this.fetchOpcode()
		// A run of prefixes: the last one is the one in force.
		while (opcode === 0xDD || opcode === 0xFD) {
			this.index = opcode === 0xDD ? 1 : 2
			states += 4
			opcode = this.fetchOpcode()
		}
		if (opcode === 0xCB) {
			states += this.index === 0 ? this.prefixCB() : this.prefixIndexCB()
		} else if (opcode === 0xED) {
			// ED cancels an index prefix before it.
			this.index = 0
			states += this.prefixED(this.fetchOpcode())
		} else {
			states += this.main(opcode)
		}
		this.cycles += states
		return states
	}

	private main(opcode: number): number {
		const x = opcode >> 6
		const y = (opcode >> 3) & 7
		const z = opcode & 7
		const p = y >> 1
		const q = y & 1
		const indexed = this.index !== 0
		switch (x) {
			case 0:
				switch (z) {
					case 0:
						switch (y) {
							case 0: return 4
							case 1: {
								const af = this.af
								this.af = this.af2
								this.af2 = af
								return 4
							}
							case 2: {
								const offset = (this.fetch8() << 24) >> 24
								this.b = (this.b - 1) & 0xFF
								if (this.b === 0) return 8
								this.pc = (this.pc + offset) & 0xFFFF
								return 13
							}
							case 3: {
								const offset = (this.fetch8() << 24) >> 24
								this.pc = (this.pc + offset) & 0xFFFF
								return 12
							}
							default: {
								const offset = (this.fetch8() << 24) >> 24
								if (!this.condition(y - 4)) return 7
								this.pc = (this.pc + offset) & 0xFFFF
								return 12
							}
						}
					case 1:
						if (q === 0) {
							this.setRp(p, this.fetch16())
							return 10
						}
						this.pairHL = this.add16(this.pairHL, this.rp(p))
						return 11
					case 2:
						switch (y) {
							case 0: this.write8(this.bc, this.a); return 7
							case 1: this.a = this.read8(this.bc); return 7
							case 2: this.write8(this.de, this.a); return 7
							case 3: this.a = this.read8(this.de); return 7
							case 4: this.write16(this.fetch16(), this.pairHL); return 16
							case 5: this.pairHL = this.read16(this.fetch16()); return 16
							case 6: this.write8(this.fetch16(), this.a); return 13
							default: this.a = this.read8(this.fetch16()); return 13
						}
					case 3:
						this.setRp(p, (this.rp(p) + (q === 0 ? 1 : -1)) & 0xFFFF)
						return 6
					case 4:
					case 5: {
						if (y === 6 && indexed) this.displace()
						const value = this.reg8(y)
						this.setReg8(y, z === 4 ? this.inc8(value) : this.dec8(value))
						return y === 6 ? (indexed ? 19 : 11) : 4
					}
					case 6: {
						if (y === 6 && indexed) this.displace()
						this.setReg8(y, this.fetch8())
						return y === 6 ? (indexed ? 15 : 10) : 7
					}
					default:
						this.accumulator(y)
						return 4
				}
			case 1: {
				if (opcode === 0x76) {
					// The PC stays on the HALT until an interrupt.
					this.halted = 1
					this.pc = (this.pc - 1) & 0xFFFF
					return 4
				}
				if (y === 6 || z === 6) {
					// With (IX+d), the other operand is H or L itself.
					if (indexed) this.displace()
					const value = z === 6 ? this.reg8(6) : this.plainReg8(z)
					if (y === 6) this.setReg8(6, value)
					else this.setPlainReg8(y, value)
					return indexed ? 15 : 7
				}
				this.setReg8(y, this.reg8(z))
				return 4
			}
			case 2:
				if (z === 6 && indexed) this.displace()
				this.alu(y, this.reg8(z))
				return z === 6 ? (indexed ? 15 : 7) : 4
			default:
				return this.control(y, z, p, q)
		}
	}

	/** RLCA RRCA RLA RRA DAA CPL SCF CCF by the y field. */
	private accumulator(operation: number) {
		const a = this.a
		const kept = this.f & (S | Z | PV)
		switch (operation) {
			case 0: this.a = ((a << 1) | (a >> 7)) & 0xFF; this.f = kept | (this.a & XY) | (a >> 7); return
			case 1: this.a = (a >> 1) | ((a & 1) << 7); this.f = kept | (this.a & XY) | (a & 1); return
			case 2: this.a = ((a << 1) | (this.f & C)) & 0xFF; this.f = kept | (this.a & XY) | (a >> 7); return
			case 3: this.a = (a >> 1) | ((this.f & C) << 7); this.f = kept | (this.a & XY) | (a & 1); return
			case 4: this.daa(); return
			case 5: this.a = a ^ 0xFF; this.f = (this.f & (S | Z | PV | C)) | H | N | (this.a & XY); return
			case 6: this.f = kept | C | (a & XY); return
			default: this.f = kept | ((this.f & C) ? H : 0) | ((this.f & C) ^ C) | (a & XY)
		}
	}

	/** The x = 3 quarter: returns, jumps, calls, stack and I/O. */
	private control(y: number, z: number, p: number, q: number): number {
		switch (z) {
			case 0:
				if (!this.condition(y)) return 5
				this.pc = this.pop()
				return 11
			case 1:
				if (q === 0) {
					const value = this.pop()
					if (p === 3) this.af = value
					else this.setRp(p, value)
					return 10
				}
				switch (p) {
					case 0: this.pc = this.pop(); return 10
					case 1: {
						const { bc, de, hl } = this
						this.bc = this.bc2
						this.de = this.de2
						this.hl = this.hl2
						this.bc2 = bc
						this.de2 = de
						this.hl2 = hl
						return 4
					}
					case 2: this.pc = this.pairHL; return 4
					default: this.sp = this.pairHL; return 6
				}
			case 2: {
				const target = this.fetch16()
				if (this.condition(y)) this.pc = target
				return 10
			}
			case 3:
				switch (y) {
					case 0: this.pc = this.fetch16(); return 10
					case 2: this.bus.output((this.a << 8) | this.fetch8(), this.a); return 11
					case 3: this.a = this.bus.input((this.a << 8) | this.fetch8()) & 0xFF; return 11
					case 4: {
						const value = this.read16(this.sp)
						this.write16(this.sp, this.pairHL)
						this.pairHL = value
						return 19
					}
					case 5: {
						// EX DE,HL ignores an index prefix.
						const de = this.de
						this.de = this.hl
						this.hl = de
						return 4
					}
					case 6: this.iff1 = this.iff2 = 0; return 4
					case 7: this.iff1 = this.iff2 = 1; this.eiDelay = 1; return 4
					default: return 4
				}
			case 4: {
				const target = this.fetch16()
				if (!this.condition(y)) return 10
				this.push(this.pc)
				this.pc = target
				return 17
			}
			case 5:
				if (q === 0) {
					this.push(p === 3 ? this.af : this.rp(p))
					return 11
				}
				// p = 0: CALL nn; the prefixes never get here.
				{
					const target = this.fetch16()
					this.push(this.pc)
					this.pc = target
					return 17
				}
			case 6:
				this.alu(y, this.fetch8())
				return 7
			default:
				this.push(this.pc)
				this.pc = y * 8
				return 11
		}
	}

	private prefixCB(): number {
		const opcode = this.fetchOpcode()
		const x = opcode >> 6
		const y = (opcode >> 3) & 7
		const z = opcode & 7
		const value = this.reg8(z)
		const memory = z === 6
		switch (x) {
			case 0: this.setReg8(z, this.shift(y, value)); break
			case 1:
				this.bit(y, value, memory ? this.h : value)
				return memory ? 12 : 8
			case 2: this.setReg8(z, value & ~(1 << y)); break
			default: this.setReg8(z, value | (1 << y))
		}
		return memory ? 15 : 8
	}

	/** DDCB d op and FDCB d op: the displacement comes before the opcode, which is no M1. */
	private prefixIndexCB(): number {
		this.displace()
		const opcode = this.fetch8()
		const x = opcode >> 6
		const y = (opcode >> 3) & 7
		const z = opcode & 7
		const address = this.indexed
		const value = this.read8(address)
		let result: number
		switch (x) {
			case 0: result = this.shift(y, value); break
			case 1:
				this.bit(y, value, address >> 8)
				return 16
			case 2: result = value & ~(1 << y); break
			default: result = value | (1 << y)
		}
		this.write8(address, result)
		// Undocumented: the result is also copied to a register.
		if (z !== 6) this.setPlainReg8(z, result)
		return 19
	}

	private prefixED(opcode: number): number {
		const x = opcode >> 6
		const y = (opcode >> 3) & 7
		const z = opcode & 7
		const p = y >> 1
		const q = y & 1
		if (x === 2 && z <= 3 && y >= 4) return this.block(y, z)
		if (x !== 1) return 8
		switch (z) {
			case 0: {
				const value = this.bus.input(this.bc) & 0xFF
				this.f = (this.f & C) | SZP[value]
				// y = 6 is IN F,(C): flags only.
				if (y !== 6) this.setPlainReg8(y, value)
				return 12
			}
			case 1:
				this.bus.output(this.bc, y === 6 ? 0 : this.plainReg8(y))
				return 12
			case 2:
				if (q === 0) this.sbc16(this.rp(p))
				else this.adc16(this.rp(p))
				return 15
			case 3: {
				const address = this.fetch16()
				if (q === 0) this.write16(address, this.rp(p))
				else this.setRp(p, this.read16(address))
				return 20
			}
			case 4: {
				const value = this.a
				this.a = 0
				this.sub8(value, 0)
				return 8
			}
			case 5:
				// RETI and RETN both restore IFF1 from IFF2.
				this.iff1 = this.iff2
				this.pc = this.pop()
				return 14
			case 6:
				this.im = [0, 0, 1, 2][y & 3]
				return 8
			default:
				switch (y) {
					case 0: this.i = this.a; return 9
					case 1: this.r = this.a; return 9
					case 2:
						this.a = this.i
						this.f = (this.f & C) | SZ[this.a] | (this.iff2 ? PV : 0)
						return 9
					case 3:
						this.a = this.r
						this.f = (this.f & C) | SZ[this.a] | (this.iff2 ? PV : 0)
						return 9
					case 4: {
						const value = this.read8(this.hl)
						this.write8(this.hl, ((this.a << 4) | (value >> 4)) & 0xFF)
						this.a = (this.a & 0xF0) | (value & 0x0F)
						this.f = (this.f & C) | SZP[this.a]
						return 18
					}
					case 5: {
						const value = this.read8(this.hl)
						this.write8(this.hl, ((value << 4) | (this.a & 0x0F)) & 0xFF)
						this.a = (this.a & 0xF0) | (value >> 4)
						this.f = (this.f & C) | SZP[this.a]
						return 18
					}
					default: return 8
				}
		}
	}

	/** LDI CPI INI OUTI and their D, IR and DR forms: y picks direction and repeat, z the operation. */
	private block(y: number, z: number): number {
		const step = (y & 1) === 0 ? 1 : -1
		const repeat = y >= 6
		const hl = this.hl
		switch (z) {
			case 0: {
				const value = this.read8(hl)
				this.write8(this.de, value)
				this.hl = (hl + step) & 0xFFFF
				this.de = (this.de + step) & 0xFFFF
				this.bc = (this.bc - 1) & 0xFFFF
				const n = value + this.a
				this.f = (this.f & (S | Z | C)) | (this.bc !== 0 ? PV : 0) | (n & FLAG_X) | ((n & 0x02) << 4)
				if (repeat && this.bc !== 0) return this.again()
				return 16
			}
			case 1: {
				const value = this.read8(hl)
				const result = (this.a - value) & 0xFF
				const half = (this.a ^ value ^ result) & H
				this.hl = (hl + step) & 0xFFFF
				this.bc = (this.bc - 1) & 0xFFFF
				const n = result - (half ? 1 : 0)
				this.f = (this.f & C) | N | (SZ[result] & ~XY) | half | (this.bc !== 0 ? PV : 0) | (n & FLAG_X) | ((n & 0x02) << 4)
				if (repeat && this.bc !== 0 && result !== 0) return this.again()
				return 16
			}
			case 2: {
				const value = this.bus.input(this.bc) & 0xFF
				this.write8(hl, value)
				this.hl = (hl + step) & 0xFFFF
				this.b = (this.b - 1) & 0xFF
				this.ioFlags(value, value + ((this.c + step) & 0xFF))
				if (repeat && this.b !== 0) return this.again()
				return 16
			}
			default: {
				const value = this.read8(hl)
				this.b = (this.b - 1) & 0xFF
				this.bus.output(this.bc, value)
				this.hl = (hl + step) & 0xFFFF
				this.ioFlags(value, value + this.l)
				if (repeat && this.b !== 0) return this.again()
				return 16
			}
		}
	}

	/** Flags of the block I/O instructions, as the undocumented-flags research has them. */
	private ioFlags(value: number, sum: number) {
		this.f = SZ[this.b] | ((value & 0x80) ? N : 0) | (sum > 0xFF ? H | C : 0) | (SZP[(sum & 7) ^ this.b] & PV)
	}

	/** A repeating block instruction goes round again: the PC back on it. */
	private again(): number {
		this.pc = (this.pc - 2) & 0xFFFF
		return 21
	}
}
