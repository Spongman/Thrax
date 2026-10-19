import { describe, expect, it } from 'vitest'
import { decode } from '../decode'
import { disassemble } from '../disassemble'
import { FORMAT_BRANCH, FORMAT_ILLEGAL, FORMAT_OP, FORMAT_OPC, FORMAT_ST, OPCODE_FORMAT, OPCODE_MNEMONIC, OP_ADD, OP_SRA, OP_SRAC, opcodeOf } from '../isa'

// Words encoded by hand from beta.pdf section 3: opcode 31:26, Rc 25:21, Ra 20:16, Rb 15:11 or literal 15:0.
describe('Beta encodings', () => {
	it('decodes ADD(R1, R2, R3) = 100000 00011 00001 00010 0...', () => {
		expect(decode(0x80611000)).toEqual({ word: 0x80611000, opcode: OP_ADD, format: FORMAT_OP, rc: 3, ra: 1, rb: 2, literal: 0x1000 })
		expect(disassemble(0x80611000)).toBe('ADD(R1, R2, R3)')
	})

	it('decodes the spec figure SUB(R3, R4, R5) and ST(R5, 1000)', () => {
		expect(disassemble(0x84A32000)).toBe('SUB(R3, R4, R5)')
		// ST(Rc, literal, Ra): Rc is the value stored, Ra the base.
		const st = decode(0x64BF03E8)
		expect([st.format, st.rc, st.ra, st.literal]).toEqual([FORMAT_ST, 5, 31, 1000])
		expect(disassemble(0x64BF03E8)).toBe('ST(R5, 1000, R31)')
	})

	it('sign extends 16-bit literals', () => {
		expect(disassemble(0xC0610005)).toBe('ADDC(R1, 5, R3)')
		expect(decode(0xC01FFFFF).literal).toBe(-1)
		expect(disassemble(0xC01FFFFF)).toBe('ADDC(R31, -1, R0)')
		expect(disassemble(0xC01F8000)).toBe('ADDC(R31, -32768, R0)')
		expect(disassemble(0xC01F7FFF)).toBe('ADDC(R31, 32767, R0)')
	})

	it('formats LD, JMP and the remaining formats destination last', () => {
		// LD(R2, -4, R7): 011000 00111 00010 1111111111111100
		expect(disassemble(0x60E2FFFC)).toBe('LD(R2, -4, R7)')
		// JMP(R28, R31): 011011 11111 11100 0
		expect(disassemble(0x6FFC0000)).toBe('JMP(R28, R31)')
		// SRAC(R4, 3, R4): 111110 00100 00100 0000000000000011
		expect(disassemble(0xF8840003)).toBe('SRAC(R4, 3, R4)')
	})

	it('resolves branch and LDR targets from the updated PC', () => {
		// BEQ(R31, ., R28) at 0x100: literal = (0 / 4) - 1 = -1.
		const word = 0x739FFFFF
		expect(decode(word).format).toBe(FORMAT_BRANCH)
		expect(disassemble(word, 0x100)).toBe('BEQ(R31, 0x00000100, R28)')
		expect(disassemble(word, 0x100, address => address === 0x100 ? 'loop' : undefined)).toBe('BEQ(R31, loop, R28)')
		// BNE(R1, +8 bytes, R31) at 0: literal 1, target 0 + 4 + 4.
		expect(disassemble(0x77E10001, 0)).toBe('BNE(R1, 0x00000008, R31)')
		// LDR(label, R2) at 0x20 with literal 2: 011111 00010 11111 0...010
		expect(disassemble(0x7C5F0002, 0x20)).toBe('LDR(0x0000002C, R2)')
	})

	it('shows illegal opcodes as LONG', () => {
		expect(disassemble(0x00000000)).toBe('LONG(0x00000000)')
		expect(disassemble(0xBC000000)).toBe('LONG(0xBC000000)')
	})
})

describe('Beta opcode table', () => {
	it('assigns exactly the documented opcodes', () => {
		// beta.pdf section 4's table has 34 mnemonics, including the optional MUL, MULC, DIV, DIVC.
		const assigned = OPCODE_MNEMONIC.filter(Boolean)
		expect(assigned).toHaveLength(34)
		const illegal = [...OPCODE_FORMAT.keys()].filter(opcode => OPCODE_FORMAT[opcode] === FORMAT_ILLEGAL)
		expect(illegal).toEqual([...Array(0x18).keys(), 0x1A, 0x1E, 0x27, 0x2F, 0x37, 0x3F])
	})

	it('uses 0x2E and 0x3E for SRA and SRAC, as beta.pdf and beta.uasm do', () => {
		expect(OP_SRA).toBe(0x2E)
		expect(OP_SRAC).toBe(0x3E)
		expect(OPCODE_FORMAT[OP_SRAC]).toBe(FORMAT_OPC)
	})

	it('looks mnemonics up case-insensitively', () => {
		expect(opcodeOf('cmplec')).toBe(0x36)
		expect(opcodeOf('NOPE')).toBe(-1)
		expect(opcodeOf('')).toBe(-1)
	})
})
