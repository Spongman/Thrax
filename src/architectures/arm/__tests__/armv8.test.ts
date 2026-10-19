/**
 * The ARMv8 profile of the shared A32 library. Expected words are worked out
 * by hand from the encoding diagrams of the ARM ARM (DDI 0487, F5 "A32
 * instruction set encoding" and the per-instruction pages), not from our
 * encoder; disassembly is checked against the same words.
 */

import { describe, expect, it } from 'vitest'
import { classifyA32, A32_CALL, A32_JUMP, A32_LOAD, A32_STORE } from '../a32/classify'
import { disassembleA32 } from '../a32/disassemble'
import {
	ARCH_V2A, ARCH_V8, FORMAT_BLX_IMMEDIATE, FORMAT_BREAKPOINT, FORMAT_DATA, FORMAT_DIVIDE, FORMAT_EXCHANGE, FORMAT_EXCLUSIVE, FORMAT_EXTRA_TRANSFER,
	FORMAT_HINT, FORMAT_MEDIA, FORMAT_MULTIPLY, FORMAT_STATUS, FORMAT_SWAP, FORMAT_UNDEFINED, FORMAT_WIDE_MOVE, formatOf,
} from '../a32/isa'
import { assembleArm, DIALECT_ARMASM, DIALECT_GNU } from '../assembler'
import { armGrammar } from '../editor/grammar'

const BASE = 0x8000

function assemble(code: string, arch: number, dialect = DIALECT_GNU) {
	return assembleArm({ name: dialect === DIALECT_GNU ? 'test.s' : 'test.armasm', code }, { textBase: BASE, addressLimit: 2 ** 26, arch })
}

/** The words a snippet assembles to under ARMv8, from BASE. */
function words(code: string, dialect = DIALECT_GNU): number[] {
	const { image, diagnostics } = assemble(code, ARCH_V8, dialect)
	expect(diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([])
	const section = image!.sections[0]
	const view = new DataView(section.bytes.buffer, section.bytes.byteOffset, section.bytes.byteLength)
	return Array.from({ length: section.bytes.length / 4 }, (_unused, index) => view.getUint32(index * 4, true))
}

const one = (line: string) => words(`\t${line}\n`)[0]

const errorsOf = (code: string, arch: number) => assemble(code, arch).diagnostics.filter((diagnostic) => diagnostic.severity === 'error').map((diagnostic) => diagnostic.message)

/** Each new instruction: source, the word the ARM ARM gives, and how the disassembler reads it back. */
const ENCODINGS: readonly [string, number, string][] = [
	// Halfword, signed and doubleword transfers: cond 000P U1W0 Rn Rt imm4H 1SH1 imm4L, or U0W0 ... 0000 1SH1 Rm.
	['ldrh r0, [r1]', 0xE1D100B0, 'ldrh r0, [r1]'],
	['strh r0, [r1, #2]', 0xE1C100B2, 'strh r0, [r1, #2]'],
	['ldrh r0, [r1, #-0x12]!', 0xE17101B2, 'ldrh r0, [r1, #-18]!'],
	['ldrsb r0, [r1]', 0xE1D100D0, 'ldrsb r0, [r1]'],
	['ldrsh r2, [r3], #4', 0xE0D320F4, 'ldrsh r2, [r3], #4'],
	['ldrh r0, [r1, r2]', 0xE19100B2, 'ldrh r0, [r1, r2]'],
	['strh r0, [r1, -r2]', 0xE10100B2, 'strh r0, [r1, -r2]'],
	['ldrd r0, r1, [r2]', 0xE1C200D0, 'ldrd r0, r1, [r2]'],
	['ldrd r4, [sp, #8]', 0xE1CD40D8, 'ldrd r4, r5, [sp, #8]'],
	['strd r2, r3, [r0, #-16]!', 0xE16021F0, 'strd r2, r3, [r0, #-16]!'],
	['ldreqh r0, [r1]', 0x01D100B0, 'ldrheq r0, [r1]'],
	['ldrsbne r0, [r1]', 0x11D100D0, 'ldrsbne r0, [r1]'],
	// Status registers.
	['mrs r0, apsr', 0xE10F0000, 'mrs r0, apsr'],
	['mrs r3, cpsr', 0xE10F3000, 'mrs r3, apsr'],
	['msr apsr_nzcvq, r0', 0xE128F000, 'msr apsr_nzcvq, r0'],
	['msr cpsr_f, #0xF0000000', 0xE328F20F, 'msr apsr_nzcvq, #0xf0000000'],
	['msr apsr_g, r1', 0xE124F001, 'msr apsr_g, r1'],
	['msr cpsr_fc, r2', 0xE129F002, 'msr cpsr_fc, r2'],
	// Branch and exchange.
	['bx lr', 0xE12FFF1E, 'bx lr'],
	['blx r3', 0xE12FFF33, 'blx r3'],
	['bxne r0', 0x112FFF10, 'bxne r0'],
	// Miscellaneous data processing.
	['clz r0, r1', 0xE16F0F11, 'clz r0, r1'],
	['movw r0, #0x1234', 0xE3010234, 'movw r0, #0x1234'],
	['movt r0, #0x1234', 0xE3410234, 'movt r0, #0x1234'],
	['movw r5, #65535', 0xE30F5FFF, 'movw r5, #0xffff'],
	// Multiplies and divides.
	['mls r0, r1, r2, r3', 0xE0603291, 'mls r0, r1, r2, r3'],
	['umull r0, r1, r2, r3', 0xE0810392, 'umull r0, r1, r2, r3'],
	['umlal r0, r1, r2, r3', 0xE0A10392, 'umlal r0, r1, r2, r3'],
	['smull r0, r1, r2, r3', 0xE0C10392, 'smull r0, r1, r2, r3'],
	['smlals r4, r5, r6, r7', 0xE0F54796, 'smlals r4, r5, r6, r7'],
	['sdiv r0, r1, r2', 0xE710F211, 'sdiv r0, r1, r2'],
	['udiv r0, r1, r2', 0xE730F211, 'udiv r0, r1, r2'],
	// Bit fields.
	['ubfx r0, r1, #4, #8', 0xE7E70251, 'ubfx r0, r1, #4, #8'],
	['sbfx r2, r3, #0, #16', 0xE7AF2053, 'sbfx r2, r3, #0, #16'],
	['bfi r0, r1, #4, #8', 0xE7CB0211, 'bfi r0, r1, #4, #8'],
	['bfc r0, #4, #8', 0xE7CB021F, 'bfc r0, #4, #8'],
	// Reversals and extends.
	['rev r0, r1', 0xE6BF0F31, 'rev r0, r1'],
	['rev16 r0, r1', 0xE6BF0FB1, 'rev16 r0, r1'],
	['revsh r0, r1', 0xE6FF0FB1, 'revsh r0, r1'],
	['rbit r0, r1', 0xE6FF0F31, 'rbit r0, r1'],
	['sxtb r0, r1', 0xE6AF0071, 'sxtb r0, r1'],
	['sxth r0, r1', 0xE6BF0071, 'sxth r0, r1'],
	['uxtb r0, r1', 0xE6EF0071, 'uxtb r0, r1'],
	['uxth r0, r1, ror #8', 0xE6FF0471, 'uxth r0, r1, ror #8'],
	['sxtab r0, r1, r2', 0xE6A10072, 'sxtab r0, r1, r2'],
	['uxtah r0, r1, r2, ror #16', 0xE6F10872, 'uxtah r0, r1, r2, ror #16'],
	// Exclusives.
	['ldrex r0, [r1]', 0xE1910F9F, 'ldrex r0, [r1]'],
	['strex r2, r0, [r1]', 0xE1812F90, 'strex r2, r0, [r1]'],
	// Exceptions, hints, barriers and preload.
	['svc #0', 0xEF000000, 'svc #0'],
	['bkpt #0', 0xE1200070, 'bkpt #0'],
	['bkpt #0x1234', 0xE1212374, 'bkpt #0x1234'],
	['udf #0', 0xE7F000F0, 'udf #0'],
	['nop', 0xE320F000, 'nop'],
	['yield', 0xE320F001, 'yield'],
	['wfi', 0xE320F003, 'wfi'],
	['dmb ish', 0xF57FF05B, 'dmb ish'],
	['dsb', 0xF57FF04F, 'dsb sy'],
	['isb', 0xF57FF06F, 'isb'],
	['clrex', 0xF57FF01F, 'clrex'],
	['pld [r0]', 0xF5D0F000, 'pld [r0]'],
	['pld [r1, #-4]', 0xF551F004, 'pld [r1, #-4]'],
	['pld [r2, r3, lsl #2]', 0xF7D2F103, 'pld [r2, r3, lsl #2]'],
	// UAL readings of what ARMv2 had.
	['push {r4, lr}', 0xE92D4010, 'push {r4, lr}'],
	['pop {r4, pc}', 0xE8BD8010, 'pop {r4, pc}'],
	['adds r0, r1, r2', 0xE0910002, 'adds r0, r1, r2'],
	['addeqs r0, r1, r2', 0x00910002, 'addseq r0, r1, r2'],
	['ldrneb r0, [r1], #1', 0x14D10001, 'ldrbne r0, [r1], #1'],
	['mov r0, r1, lsl #2', 0xE1A00101, 'lsl r0, r1, #2'],
	['ldmia r0!, {r1-r3}', 0xE8B0000E, 'ldm r0!, {r1-r3}'],
]

describe('ARMv8 A32 encodings', () => {
	it.each(ENCODINGS)('%s', (line, expected) => {
		expect(one(line)).toBe(expected)
	})

	it.each(ENCODINGS)('%s disassembles from its word', (_line, word, text) => {
		expect(disassembleA32(word, BASE, ARCH_V8)).toBe(text)
	})

	it('builds a MOV of a 16-bit value no rotation fits as MOVW', () => {
		// 0x1234 has no 8-bit rotated form, nor does its complement.
		expect(one('mov r0, #0x1234')).toBe(0xE3010234)
		// One that fits stays a MOV.
		expect(one('mov r0, #0xFF00')).toBe(0xE3A00CFF)
	})

	it('takes :lower16: and :upper16: halves of an address', () => {
		const code = '\tmovw r0, #:lower16:target\n\tmovt r0, #:upper16:target\n\t.equ target, 0x12345678\n'
		expect(words(code)).toEqual([0xE3050678, 0xE3410234])
	})

	it('encodes BLX to a label with its halfword bit', () => {
		// At 0x8000, a label at 0x8010: offset 8 from PC + 8, H clear.
		expect(words('\tblx there\n\tnop\n\tnop\n\tnop\nthere:\n\tnop\n')[0]).toBe(0xFA000002)
		expect(disassembleA32(0xFA000002, 0x8000, ARCH_V8)).toBe('blx 0x00008010')
	})

	it('reads armasm source with the ARMv8 instructions', () => {
		expect(words('\tAREA x, CODE\n\tUDIV r0, r1, r2\n\tBX lr\n\tEND\n', DIALECT_ARMASM)).toEqual([0xE730F211, 0xE12FFF1E])
	})

	it('checks operands', () => {
		expect(errorsOf('\tldrd r1, r2, [r0]\n', ARCH_V8)[0]).toMatch(/even first register/)
		expect(errorsOf('\tldrd r0, r2, [r0]\n', ARCH_V8)[0]).toMatch(/must be r1/)
		expect(errorsOf('\tldrh r0, [r1, #256]\n', ARCH_V8)[0]).toMatch(/-255 to 255/)
		expect(errorsOf('\tubfx r0, r1, #30, #4\n', ARCH_V8)[0]).toMatch(/past bit 31/)
		expect(errorsOf('\tmovw r0, #0x10000\n', ARCH_V8)[0]).toMatch(/16 bits/)
		expect(errorsOf('\tmsr apsr_x, r0\n', ARCH_V8)[0]).toMatch(/_nzcvq/)
		expect(errorsOf('\tsxtb r0, r1, ror #4\n', ARCH_V8)[0]).toMatch(/0, 8, 16 or 24/)
		expect(errorsOf('\tteqp pc, #0\n', ARCH_V8)[0]).toMatch(/ARMv2/)
		expect(errorsOf('\tswp r0, r1, [r2]\n', ARCH_V8)[0]).toMatch(/Unknown instruction/)
	})
})

describe('the ARMv2a profile is unchanged', () => {
	it.each(['ldrh r0, [r1]', 'bx lr', 'clz r0, r1', 'movw r0, #1', 'sdiv r0, r1, r2', 'ubfx r0, r1, #0, #1', 'mrs r0, cpsr', 'push {r4, lr}'])('%s', (line) => {
		const errors = errorsOf(`\t${line}\n`, ARCH_V2A)
		// PUSH was ARMv2a's already, as STMFD SP!.
		if (line.startsWith('push')) expect(errors).toEqual([])
		else expect(errors[0]).toMatch(/Unknown instruction/)
	})

	it('keeps a MOV that no rotation fits an error', () => {
		expect(errorsOf('\tmov r0, #0x1234\n', ARCH_V2A)[0]).toMatch(/not an 8-bit value/)
	})

	it('keeps NOP as MOV r0, r0 and SWP', () => {
		const { image } = assemble('\tnop\n\tswp r0, r1, [r2]\n', ARCH_V2A)
		const view = new DataView(image!.sections[0].bytes.buffer)
		expect([view.getUint32(0, true), view.getUint32(4, true)]).toEqual([0xE1A00000, 0xE1020091])
	})
})

describe('the editor grammar of each profile', () => {
	it('completes and highlights the profile\'s own mnemonics', () => {
		const v8 = armGrammar(ARCH_V8)
		expect(v8.completions).toEqual(expect.arrayContaining(['udiv', 'movw', 'ldrex', 'bx']))
		expect(v8.completions).not.toContain('swp')
		expect(v8.registers).toContain('apsr_nzcvq')
		expect(armGrammar(ARCH_V2A).completions).not.toContain('udiv')
		const keyword = (grammar: typeof v8, word: string) => {
			const rules = grammar.monarch.tokenizer.root as unknown as [RegExp, string][]
			return rules.some(([pattern, token]) => token === 'keyword' && new RegExp(`^(?:${pattern.source})$`, 'i').test(word))
		}
		for (const word of ['ldrsheq', 'ldreqsh', 'strd', 'sdiv', 'bxle']) expect(keyword(v8, word), word).toBe(true)
		expect(keyword(armGrammar(ARCH_V2A), 'sdiv')).toBe(false)
	})
})

describe('the ARMv8 decode map', () => {
	it.each([
		[0xE1D100B0, FORMAT_EXTRA_TRANSFER],
		[0xE10F0000, FORMAT_STATUS],
		[0xE328F20F, FORMAT_STATUS],
		[0xE12FFF1E, FORMAT_EXCHANGE],
		[0xE16F0F11, FORMAT_MEDIA],
		[0xE7E70251, FORMAT_MEDIA],
		[0xE730F211, FORMAT_DIVIDE],
		[0xE3010234, FORMAT_WIDE_MOVE],
		[0xE0810392, FORMAT_MULTIPLY],
		[0xE320F000, FORMAT_HINT],
		[0xF5D0F000, FORMAT_HINT],
		[0xE1200070, FORMAT_BREAKPOINT],
		[0xE1910F9F, FORMAT_EXCLUSIVE],
		[0xFA000002, FORMAT_BLX_IMMEDIATE],
		[0xE0810002, FORMAT_DATA],
		// SWP and the unprivileged halfword forms are gone; UDF stays undefined.
		[0xE1020091, FORMAT_UNDEFINED],
		[0xE0F100B0, FORMAT_UNDEFINED],
		[0xE7F000F0, FORMAT_UNDEFINED],
		// UMAAL, which this library leaves out.
		[0xE0410392, FORMAT_UNDEFINED],
	])('0x%s', (word, format) => {
		expect(formatOf(word, ARCH_V8)).toBe(format)
	})

	it('still reads the same words as ARMv2a under its own profile', () => {
		expect(formatOf(0xE1D100B0, ARCH_V2A)).toBe(FORMAT_UNDEFINED)
		expect(formatOf(0xE1020091, ARCH_V2A)).toBe(FORMAT_SWAP)
		expect(disassembleA32(0x00910002, BASE)).toBe('addeqs r0, r1, r2')
	})

	it('classifies the register traffic of the new forms', () => {
		const ldrd = classifyA32(0xE1C200D0, ARCH_V8)
		expect(ldrd.flags & A32_LOAD).toBeTruthy()
		expect(ldrd.writes).toBe(0b11)
		expect(ldrd.reads).toBe(1 << 2)
		const strd = classifyA32(0xE16021F0, ARCH_V8)
		expect(strd.flags & A32_STORE).toBeTruthy()
		expect(strd.reads).toBe(0b1101)
		expect(strd.writes).toBe(1)
		const umlal = classifyA32(0xE0A10392, ARCH_V8)
		expect(umlal.reads).toBe(0b1111)
		expect(umlal.writes).toBe(0b11)
		const blx = classifyA32(0xE12FFF33, ARCH_V8)
		expect(blx.flags & (A32_CALL | A32_JUMP)).toBe(A32_CALL | A32_JUMP)
		expect(blx.reads).toBe(1 << 3)
		expect(classifyA32(0xE3410234, ARCH_V8).reads).toBe(1)
		expect(classifyA32(0xE7CB0211, ARCH_V8).reads).toBe(0b11)
	})
})
