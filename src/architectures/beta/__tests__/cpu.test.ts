import { describe, expect, it } from 'vitest'
import {
	BetaCpu, FAULT_ADDRESS, FAULT_DIVIDE_BY_ZERO, FAULT_ILLEGAL_INSTRUCTION, FAULT_MISALIGNED, R_XP, STEP_FAULT, STEP_OK, STEP_TRAP,
	faultMessage,
} from '../cpu'
import type { BetaEffectSink } from '../cpu'
import {
	OP_ADD, OP_ADDC, OP_ANDC, OP_BEQ, OP_BNE, OP_CMPEQC, OP_CMPLE, OP_CMPLEC, OP_CMPLT, OP_CMPLTC, OP_DIV, OP_DIVC, OP_JMP, OP_LD,
	OP_LDR, OP_MUL, OP_MULC, OP_ORC, OP_SHL, OP_SHLC, OP_SHR, OP_SHRC, OP_SRA, OP_SRAC, OP_ST, OP_SUBC, OP_XNOR, OP_XORC,
} from '../isa'

// Field packing straight from beta.pdf section 3; known words are checked in encoding.test.ts.
const op = (opcode: number, ra: number, rb: number, rc: number) => ((opcode << 26) | (rc << 21) | (ra << 16) | (rb << 11)) >>> 0
const opc = (opcode: number, ra: number, literal: number, rc: number) => ((opcode << 26) | (rc << 21) | (ra << 16) | (literal & 0xFFFF)) >>> 0
const SUPERVISOR = 0x80000000

/** A CPU with `words` at address 0, in user mode unless `supervisor`. */
function machine(words: number[], supervisor = false, memoryBytes = 0x1000) {
	const cpu = new BetaCpu({ memoryBytes })
	words.forEach((word, index) => cpu.writeWord(index * 4, word))
	cpu.pc = supervisor ? SUPERVISOR : 0
	return cpu
}

/** Runs one instruction with R1 = a and R2 = b and returns R3. */
function compute(word: number, a: number, b = 0) {
	const cpu = machine([word])
	cpu.setRegister(1, a)
	cpu.setRegister(2, b)
	expect(cpu.step()).toBe(STEP_OK)
	return cpu.registers[3]
}

class Recorder implements BetaEffectSink {
	log: [string, number, number][] = []
	constructor(private cpu: BetaCpu) {}
	register(index: number, old: number) { this.log.push(['r', index, old]) }
	memory(address: number, old: number) { this.log.push(['m', address, old]) }
	pc(old: number) { this.log.push(['pc', 0, old]) }
	/** Restores every recorded change, newest first. */
	undo() {
		for (const [kind, at, old] of this.log.reverse()) {
			if (kind === 'r') this.cpu.setRegister(at, old)
			else if (kind === 'm') this.cpu.writeWord(at, old)
			else this.cpu.pc = old
		}
		this.log = []
	}
}

describe('Beta machine state', () => {
	it('stores words little-endian', () => {
		const cpu = machine([0x80611000])
		expect([...cpu.memory.subarray(0, 4)]).toEqual([0x00, 0x10, 0x61, 0x80])
	})

	it('resets into supervisor mode at vector 0', () => {
		const cpu = machine([])
		cpu.setRegister(4, 9)
		cpu.reset()
		expect(cpu.pc).toBe(0x80000000)
		expect(cpu.supervisor).toBe(true)
		expect(cpu.registers[4]).toBe(0)
	})

	it('reads R31 as zero and discards writes to it', () => {
		const cpu = machine([opc(OP_ADDC, 31, 5, 31), op(OP_ADD, 31, 31, 1)])
		const recorder = new Recorder(cpu)
		cpu.sink = recorder
		cpu.setRegister(31, 7)
		cpu.setRegister(1, 9)
		cpu.step()
		cpu.step()
		expect(cpu.registers[31]).toBe(0)
		expect(cpu.registers[1]).toBe(0)
		// The discarded write records only the PC.
		expect(recorder.log[0]).toEqual(['pc', 0, 0])
	})

	it('rejects memory sizes that are not whole words', () => {
		expect(() => new BetaCpu({ memoryBytes: 6 })).toThrow(RangeError)
		expect(() => new BetaCpu({ memoryBytes: 0 })).toThrow(RangeError)
	})
})

describe('Beta arithmetic', () => {
	it('wraps sums and keeps the low 32 bits of products', () => {
		expect(compute(op(OP_ADD, 1, 2, 3), 0x7FFFFFFF, 1)).toBe(-0x80000000)
		expect(compute(opc(OP_SUBC, 1, -32768, 3), 0)).toBe(32768)
		expect(compute(op(OP_MUL, 1, 2, 3), 0x10000, 0x10000)).toBe(0)
		expect(compute(op(OP_MUL, 1, 2, 3), 0x12345, 0x6789)).toBe(Math.imul(0x12345, 0x6789))
		expect(compute(opc(OP_MULC, 1, -3, 3), 7)).toBe(-21)
	})

	it('truncates quotients toward zero', () => {
		expect(compute(op(OP_DIV, 1, 2, 3), 7, -2)).toBe(-3)
		expect(compute(op(OP_DIV, 1, 2, 3), -7, 2)).toBe(-3)
		expect(compute(opc(OP_DIVC, 1, -1, 3), -0x80000000)).toBe(-0x80000000)
	})

	it('faults on division by zero without changing state', () => {
		for (const word of [op(OP_DIV, 1, 2, 3), opc(OP_DIVC, 1, 0, 3)]) {
			const cpu = machine([word])
			cpu.setRegister(1, 5)
			cpu.setRegister(3, 11)
			expect(cpu.step()).toBe(STEP_FAULT)
			expect(cpu.fault).toBe(FAULT_DIVIDE_BY_ZERO)
			expect(cpu.registers[3]).toBe(11)
			expect(cpu.pc).toBe(0)
		}
	})

	it('compares signed values', () => {
		expect(compute(op(OP_CMPLT, 1, 2, 3), -1, 1)).toBe(1)
		expect(compute(op(OP_CMPLT, 1, 2, 3), 1, -1)).toBe(0)
		expect(compute(op(OP_CMPLE, 1, 2, 3), 4, 4)).toBe(1)
		expect(compute(opc(OP_CMPLEC, 1, -1, 3), -1)).toBe(1)
		expect(compute(opc(OP_CMPLTC, 1, -1, 3), 0xFFFF)).toBe(0)
		expect(compute(opc(OP_CMPEQC, 1, -1, 3), -1)).toBe(1)
		expect(compute(opc(OP_CMPEQC, 1, -1, 3), 0xFFFF)).toBe(0)
	})

	it('sign extends logic literals', () => {
		expect(compute(opc(OP_ANDC, 1, -1, 3), 0x12345678)).toBe(0x12345678)
		expect(compute(opc(OP_ANDC, 1, 0x7FFF, 3), -1)).toBe(0x7FFF)
		expect(compute(opc(OP_ORC, 1, 0x8000, 3), 0) >>> 0).toBe(0xFFFF8000)
		expect(compute(opc(OP_XORC, 1, -1, 3), 0)).toBe(-1)
		expect(compute(op(OP_XNOR, 1, 2, 3), 0x0F0F0F0F, 0x00FF00FF) >>> 0).toBe(0xF00FF00F)
	})

	it('shifts by the low five bits of the count', () => {
		expect(compute(op(OP_SHL, 1, 2, 3), 1, 33)).toBe(2)
		expect(compute(op(OP_SHL, 1, 2, 3), 1, 32)).toBe(1)
		expect(compute(op(OP_SHR, 1, 2, 3), -8, 1)).toBe(0x7FFFFFFC)
		expect(compute(op(OP_SRA, 1, 2, 3), -8, 1)).toBe(-4)
		expect(compute(op(OP_SRA, 1, 2, 3), -8, 32)).toBe(-8)
		expect(compute(opc(OP_SHLC, 1, 31, 3), 1)).toBe(-0x80000000)
		// Literal -1 has low bits 11111: a shift by 31.
		expect(compute(opc(OP_SHRC, 1, -1, 3), -0x80000000)).toBe(1)
		expect(compute(opc(OP_SRAC, 1, -1, 3), -0x80000000)).toBe(-1)
	})
})

describe('Beta control flow', () => {
	it('branches relative to the updated PC and links PC + 4', () => {
		// 0: BEQ(R31, 12, R28): literal (12 - 0) / 4 - 1 = 2
		const cpu = machine([opc(OP_BEQ, 31, 2, 28)])
		expect(cpu.step()).toBe(STEP_OK)
		expect(cpu.pc).toBe(12)
		expect(cpu.registers[28]).toBe(4)
	})

	it('links even when the branch is not taken', () => {
		const cpu = machine([opc(OP_BNE, 1, 5, 2)])
		cpu.step()
		expect(cpu.pc).toBe(4)
		expect(cpu.registers[2]).toBe(4)
	})

	it('branches backwards and to itself', () => {
		const cpu = machine([0, 0, opc(OP_BNE, 1, -3, 31)])
		cpu.pc = 8
		cpu.setRegister(1, 1)
		cpu.step()
		expect(cpu.pc).toBe(0)
		const loop = machine([opc(OP_BEQ, 31, -1, 31)])
		loop.step()
		expect(loop.pc).toBe(0)
	})

	it('keeps the supervisor bit through branches and links', () => {
		const cpu = machine([opc(OP_BEQ, 31, 1, 28)], true)
		cpu.step()
		expect(cpu.pc).toBe(0x80000008)
		expect(cpu.registers[28] >>> 0).toBe(0x80000004)
	})

	it('JMP masks the low two bits and uses Ra before writing Rc', () => {
		const cpu = machine([opc(OP_JMP, 5, 0, 5)])
		cpu.setRegister(5, 0x23)
		cpu.step()
		expect(cpu.pc).toBe(0x20)
		expect(cpu.registers[5]).toBe(4)
	})

	it('JMP can clear the supervisor bit but not set it', () => {
		const user = machine([opc(OP_JMP, 1, 0, 31)])
		user.setRegister(1, 0x80000010 | 0)
		user.step()
		expect(user.pc).toBe(0x10)
		expect(user.supervisor).toBe(false)

		const kernel = machine([opc(OP_JMP, 1, 0, 31), opc(OP_JMP, 2, 0, 31)], true)
		kernel.setRegister(1, 0x80000004 | 0)
		kernel.setRegister(2, 0x40)
		kernel.step()
		expect(kernel.pc).toBe(0x80000004)
		kernel.step()
		expect(kernel.pc).toBe(0x40)
		expect(kernel.supervisor).toBe(false)
	})
})

describe('Beta memory access', () => {
	it('stores Rc at Ra + literal and loads it back', () => {
		const cpu = machine([opc(OP_ST, 1, -4, 2), opc(OP_LD, 1, -4, 3)])
		cpu.setRegister(1, 0x104)
		cpu.setRegister(2, -2)
		cpu.step()
		expect(cpu.readWord(0x100)).toBe(-2)
		cpu.step()
		expect(cpu.registers[3]).toBe(-2)
	})

	it('LD with R31 as base reads an absolute address', () => {
		const cpu = machine([opc(OP_LD, 31, 0x200, 4)])
		cpu.writeWord(0x200, 1234)
		cpu.step()
		expect(cpu.registers[4]).toBe(1234)
	})

	it('LDR reads PC + 4 + 4 * literal, ignoring Ra and the supervisor bit', () => {
		// 4: LDR(16, R2): literal (16 - 4) / 4 - 1 = 2; Ra field 11111.
		const cpu = machine([0, opc(OP_LDR, 31, 2, 2), 0, 0, 77], true)
		cpu.pc = 0x80000004
		cpu.setRegister(31, 0x100)
		cpu.step()
		expect(cpu.registers[2]).toBe(77)
		expect(cpu.pc).toBe(0x80000008)
	})

	it('faults on misaligned and out-of-range access without changing state', () => {
		const cases: [number, number, number][] = [
			[opc(OP_LD, 1, 2, 3), 0, FAULT_MISALIGNED],
			[opc(OP_ST, 1, 0, 3), 0x1000, FAULT_ADDRESS],
			[opc(OP_LD, 1, -4, 3), 0, FAULT_ADDRESS],
			[opc(OP_LDR, 31, 0x4000, 3), 0, FAULT_ADDRESS],
		]
		for (const [word, base, fault] of cases) {
			const cpu = machine([word])
			const recorder = new Recorder(cpu)
			cpu.sink = recorder
			cpu.setRegister(1, base)
			expect(cpu.step()).toBe(STEP_FAULT)
			expect(cpu.fault).toBe(fault)
			expect(cpu.pc).toBe(0)
			expect(recorder.log).toEqual([])
		}
		const cpu = machine([opc(OP_LD, 1, -4, 3)])
		cpu.step()
		expect(cpu.faultAddress).toBe(0xFFFFFFFC)
		expect(faultMessage(cpu.fault, cpu.faultAddress)).toBe('Memory access outside memory at 0xFFFFFFFC')
	})

	it('faults on fetching outside memory', () => {
		const cpu = machine([], false, 0x10)
		cpu.pc = 0x10
		expect(cpu.step()).toBe(STEP_FAULT)
		expect([cpu.fault, cpu.faultAddress]).toEqual([FAULT_ADDRESS, 0x10])
	})

	it('lets debugger access throw rather than wrap', () => {
		const cpu = machine([])
		expect(() => cpu.readWord(0x1000)).toThrow('outside memory')
		expect(() => cpu.writeWord(2, 0)).toThrow('Misaligned')
	})
})

describe('Beta exceptions', () => {
	it('traps illegal opcodes in user mode to ILLOP with XP = PC + 4', () => {
		for (const word of [0x00000000, 0xBC000000, 0x68000000]) {
			const cpu = machine([0, 0, word])
			cpu.pc = 8
			expect(cpu.step()).toBe(STEP_TRAP)
			expect(cpu.registers[R_XP]).toBe(12)
			expect(cpu.pc).toBe(0x80000004)
			expect(cpu.supervisor).toBe(true)
		}
	})

	it('treats an illegal opcode in supervisor mode as a fault', () => {
		const cpu = machine([0xBC000000], true)
		expect(cpu.step()).toBe(STEP_FAULT)
		expect(cpu.fault).toBe(FAULT_ILLEGAL_INSTRUCTION)
		expect(cpu.pc).toBe(0x80000000)
		expect(cpu.registers[R_XP]).toBe(0)
	})

	it('takes interrupts only in user mode', () => {
		const cpu = machine([])
		cpu.pc = 0x20
		expect(cpu.interrupt(12)).toBe(true)
		expect(cpu.registers[R_XP]).toBe(0x24)
		expect(cpu.pc).toBe(0x8000000C)
		expect(cpu.interrupt(12)).toBe(false)
	})

	it('faults on a user-mode access outside memory without segmentation, as BSim does', () => {
		const cpu = machine([0, opc(OP_LD, 31, 0x4000, 3)], false, 0x100)
		cpu.segfaultVector = 8
		cpu.pc = 4
		expect(cpu.step()).toBe(STEP_FAULT)
		expect(cpu.fault).toBe(FAULT_ADDRESS)
		expect(cpu.pc).toBe(4)
	})
})

describe('Beta segmentation (BSim base and bounds)', () => {
	/** User-mode code at physical 0x100, a segment 0x40 bytes long. */
	function segmented(words: number[]) {
		const cpu = new BetaCpu({ memoryBytes: 0x1000 })
		words.forEach((word, index) => cpu.writeWord(0x100 + index * 4, word))
		cpu.segmentation = true
		cpu.segfaultVector = 8
		cpu.segBase = 0x100
		cpu.segBounds = 0x40
		cpu.pc = 0
		return cpu
	}

	it('fetches and loads through the base', () => {
		const cpu = segmented([opc(OP_LD, 31, 0x10, 1), opc(OP_ST, 31, 0x14, 1)])
		cpu.writeWord(0x110, 1234)
		expect(cpu.step()).toBe(STEP_OK)
		expect(cpu.registers[1]).toBe(1234)
		expect(cpu.step()).toBe(STEP_OK)
		expect(cpu.readWord(0x114)).toBe(1234)
		expect(cpu.fetchAddress()).toBe(0x108)
	})

	it('traps a fetch past the bounds with XP = PC', () => {
		const cpu = segmented([])
		cpu.pc = 0x40
		expect(cpu.step()).toBe(STEP_TRAP)
		expect([cpu.pc, cpu.registers[R_XP]]).toEqual([0x80000008, 0x40])
	})

	it('traps a load or store past the bounds with XP = PC + 4, changing nothing else', () => {
		for (const word of [opc(OP_LD, 31, 0x40, 1), opc(OP_ST, 31, 0x40, 1), opc(OP_LDR, 31, 15, 1)]) {
			const cpu = segmented([0, word])
			cpu.pc = 4
			cpu.setRegister(1, 77)
			expect(cpu.step()).toBe(STEP_TRAP)
			expect([cpu.pc, cpu.registers[R_XP], cpu.registers[1]]).toEqual([0x80000008, 8, 77])
		}
	})

	it('reads and writes base and bounds at -4 and -8 in supervisor mode only', () => {
		const cpu = segmented([opc(OP_ST, 31, -4, 1), opc(OP_ST, 31, -8, 2), opc(OP_LD, 31, -4, 3), opc(OP_LD, 31, -8, 4)])
		cpu.pc = SUPERVISOR | 0x100
		cpu.setRegister(1, 0x200)
		cpu.setRegister(2, -1)
		for (let step = 0; step < 4; step++) expect(cpu.step()).toBe(STEP_OK)
		expect([cpu.segBase, cpu.segBounds, cpu.registers[3], cpu.registers[4]]).toEqual([0x200, 0xFFFFFFFF, 0x200, -1])
		cpu.reset()
		expect([cpu.segBase, cpu.segBounds]).toEqual([0, 0xFFFFFFFF])
	})

	it('leaves -4 an ordinary address without segmentation', () => {
		const cpu = machine([opc(OP_LD, 31, -4, 3)], true)
		expect(cpu.step()).toBe(STEP_FAULT)
		expect(cpu.fault).toBe(FAULT_ADDRESS)
	})
})

describe('Beta effect sink', () => {
	it('reports old values before each change, enough to undo a run', () => {
		const program = [
			opc(OP_ADDC, 31, 0x100, 1),
			opc(OP_ST, 1, 0, 1),
			opc(OP_BEQ, 31, -1, 28),
			0xBC000000,
		]
		const cpu = machine(program)
		const recorder = new Recorder(cpu)
		cpu.sink = recorder
		cpu.writeWord(0x100, 42)
		cpu.step()
		cpu.step()
		expect(recorder.log).toEqual([['r', 1, 0], ['pc', 0, 0], ['m', 0x100, 42], ['pc', 0, 4]])
		// BEQ to itself links R28, then the illegal word at 12 traps.
		cpu.step()
		expect([cpu.pc, cpu.registers[28]]).toEqual([8, 12])
		cpu.pc = 12
		recorder.pc(8)
		cpu.step()
		expect([cpu.pc, cpu.registers[R_XP]]).toEqual([0x80000004, 16])
		recorder.undo()
		expect(cpu.pc).toBe(0)
		expect([...cpu.registers]).toEqual(new Array(32).fill(0))
		expect(cpu.readWord(0x100)).toBe(42)
	})
})
