import { describe, expect, it } from 'vitest'
import { describeInstruction as z80 } from '../../architectures/z80/instructions'
import { DEPENDENCY_NAMES as z80Names } from '../../architectures/z80/dependencies'
import { decode as avrDecode } from '../../architectures/avr/isa'
import { describeAvrInstruction as avr } from '../../architectures/avr/instructions'
import { decode as m0Decode } from '../../architectures/armv8/m0/isa'
import { describe as m0 } from '../../architectures/armv8/m0/instructions'
import { decodeInstruction } from '../../architectures/m68k/decode'
import { describeM68kInstruction as m68k } from '../../architectures/m68k/instructions'
import { describeOpcode, instructionSetFor } from '../../architectures/mos6502/instructions'
import { W65C02_MODEL } from '../../architectures/mos6502/isa'

const packed = (...bytes: number[]) => bytes.reduce((value, byte, n) => value + byte * 256 ** n, 0)
const names = (ids: readonly number[]) => ids.map(n => z80Names[n])
const m68 = (...words: number[]) => m68k(decodeInstruction(address => words[address / 2], 0, '68000'))

describe('native dependency metadata from independent encodings', () => {
	it('flattens Z80 pairs, index halves and indexed memory destinations', () => {
		expect(names(z80(packed(0x09)).writes)).toEqual(['H', 'L', 'F']) // ADD HL,BC
		expect(names(z80(packed(0xdd, 0x24)).writes)).toEqual(['IXH', 'F']) // INC IXH
		const ld = z80(packed(0xdd, 0x66, 0x02)) // LD H,(IX+2), not IXH
		expect(names(ld.reads)).toEqual(['IXH', 'IXL'])
		expect(names(ld.loadWrites!)).toEqual(['H'])
		expect(names(z80(packed(0xfd, 0xcb, 0x02, 0x00)).writes)).toEqual(['F', 'B']) // RLC (IY+2),B
	})
	it('includes Z80 flags, stack, alternate register sets and ED prefix rules', () => {
		expect(names(z80(0xc0).reads)).toEqual(['F', 'SP']) // RET NZ
		expect(names(z80(0xc5).writes)).toEqual(['SP']) // PUSH BC
		expect(names(z80(0xd9).writes)).toContain('H2') // EXX
		expect(names(z80(packed(0xdd, 0xed, 0x4a)).reads)).toContain('H') // ADC HL,BC ignores DD
		expect(names(z80(packed(0xed, 0xb0)).writes)).toEqual(expect.arrayContaining(['B', 'C', 'D', 'E', 'H', 'L', 'F'])) // LDIR
		expect(z80(0xc5)).toBe(z80(0xc5))
	})
	it('gives memory-dependent flags the loaded-result latency', () => {
		expect(describeOpcode(0xad).loadWrites).toEqual([0, 4]) // LDA abs
		expect(describeOpcode(0x6d).loadWrites).toEqual([0, 4]) // ADC abs
		expect(describeOpcode(0xcd).loadWrites).toEqual([4]) // CMP abs
		expect(names(z80(0x34).loadWrites!)).toEqual(['F']) // INC (HL)
		expect(names(z80(packed(0xed, 0x6f)).loadWrites!)).toEqual(['A', 'F']) // RLD
		expect(m68(0xd050).loadWrites).toEqual([16, 0]) // ADD.W (a0),d0
	})

	it('models AVR multiply, flags and pointer writeback separately from loaded data', () => {
		expect(avr(avrDecode(0x9f23))).toMatchObject({ reads: [18, 32, 19], writes: [32, 0, 1] }) // MUL r18,r19
		expect(avr(avrDecode(0xe001))).toMatchObject({ reads: [], writes: [16] }) // LDI r16,1
		expect(avr(avrDecode(0x910d))).toMatchObject({ reads: [26, 27], writes: [16, 26, 27], loadWrites: [16] }) // LD r16,X+
		expect(avr(avrDecode(0xf001)).reads).toEqual([32]) // BREQ, flag number is not a GPR
		expect(avr(avrDecode(0xbf0f)).writes).toEqual([32]) // OUT SREG,r16
		expect(avr(avrDecode(0x9100, 0x0003)).reads).toEqual([3]) // LDS r16,register-file alias r3
	})
	it('models Thumb lists, flags, PC-relative operands and stack bank aliases', () => {
		expect(m0(m0Decode(0x2001))).toMatchObject({ reads: [16], writes: [0, 16] }) // MOVS r0,#1
		expect(m0(m0Decode(0xd000)).reads).toEqual([16]) // BEQ
		expect(m0(m0Decode(0xbd03))).toMatchObject({ writes: [0, 1, 15, 13, 17, 18], loadWrites: [0, 1, 15] }) // POP {r0,r1,pc}
		expect(m0(m0Decode(0xc803))).toMatchObject({ writes: [0, 1], loadWrites: [0, 1] }) // LDM r0,{r0,r1}: no writeback
		expect(m0(m0Decode(0x4800)).reads).toEqual([15]) // LDR literal
		expect(m0(m0Decode(0xf380, 0x8814)).writes).toEqual(expect.arrayContaining([13, 17, 18, 19])) // MSR CONTROL,r0
	})
	it('models 68k MOVEM masks, exchanges and condition codes', () => {
		expect(m68(0x48e7, 0xc080).writes).toEqual([15]) // MOVEM.L d0-d1/a0,-(sp)
		expect(m68(0x48e7, 0xc080).reads).toEqual([15, 8, 1, 0])
		expect(m68(0x4cd8, 0x0103)).toMatchObject({ writes: [8, 0, 1], loadWrites: [0, 1] }) // MOVEM.L (a0)+,d0-d1/a0
		expect(m68(0xc141)).toMatchObject({ reads: [0, 1], writes: [0, 1] }) // EXG d0,d1
		expect(m68(0x0c40, 1).writes).toEqual([16]) // CMPI.W #1,d0
		expect(m68(0x43d0)).toMatchObject({ reads: [8], writes: [9], isLoad: false }) // LEA (a0),a1
		expect(m68(0x203c, 0x1234, 0x5678)).toBe(m68(0x203c, 0xabcd, 0xef01))
	})
	it('keeps NMOS conflicts distinct from CMOS and includes all undocumented destinations', () => {
		expect(describeOpcode(0xaf)).toMatchObject({ mnemonic: 'LAX', writes: [0, 1, 4], loadWrites: [0, 1, 4] })
		expect(describeOpcode(0xbb)).toMatchObject({ mnemonic: 'LAS', writes: [0, 1, 3, 4], loadWrites: [0, 1, 3, 4] })
		expect(describeOpcode(0x7a).writes).toEqual([]) // NMOS NOP
		expect(instructionSetFor(W65C02_MODEL).describe(0x7a).writes).toEqual([2, 3, 4]) // CMOS PLY
		expect(instructionSetFor(W65C02_MODEL).describe(0x80).reads).toEqual([]) // BRA
		expect(instructionSetFor(W65C02_MODEL).describe(0x0f).reads).toEqual([]) // BBR0
		expect(describeOpcode(0x60).writes).toEqual([3]) // RTS
	})
})
