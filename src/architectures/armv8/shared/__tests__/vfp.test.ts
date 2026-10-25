/**
 * VFPv4-D16 encodings checked against words worked out by hand from the
 * Arm ARM's encoding diagrams (DDI 0487, F6: VADD, VLDR, VMRS...), and the
 * UAL the disassembler writes for them. ARMv2a and Cortex-M0 still reject
 * every VFP instruction and the float directives.
 */

import { describe, expect, it } from 'vitest'
import { assembleArm, DIALECT_ARMASM, DIALECT_GNU } from '../assembler'
import { ARCH_V2A, ARCH_V8, FORMAT_COPROCESSOR, FORMAT_VFP, formatOf } from '../a32/isa'
import { armGrammar } from '../editor/grammar'
import { describeArmToken } from '../editor/dataTips'
import { armInstructionHelp } from '../instructionHelp'
import type { DebugInspection } from '../../../contracts'
import { disassembleA32 } from '../a32/disassemble'
import { decodeVfp } from '../a32/vfp'
import { assembleArm26 } from '../../arm26/assemble'
import { assembleM0 } from '../../m0/assembler'

const BASE = 0x8000

function assemble(code: string, dialect = DIALECT_GNU, floatingPoint = true) {
	return assembleArm({ name: dialect === DIALECT_GNU ? 'test.s' : 'test.armasm', code }, { textBase: BASE, addressLimit: 2 ** 26, arch: ARCH_V8, floatingPoint })
}

function words(code: string, dialect = DIALECT_GNU): number[] {
	const { image, diagnostics } = assemble(code, dialect)
	expect(diagnostics).toEqual([])
	const bytes = image!.sections[0].bytes
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	return Array.from({ length: bytes.length / 4 }, (_unused, index) => view.getUint32(index * 4, true))
}

const one = (line: string) => words(`\t${line}\n`)[0]

/** Source, its hand-encoded word, and the UAL disassembly writes for it. */
const CASES: [string, number, string][] = [
	['vadd.f32 s0, s1, s2', 0xEE300A81, 'vadd.f32 s0, s1, s2'],
	['vadd.f64 d0, d1, d2', 0xEE310B02, 'vadd.f64 d0, d1, d2'],
	['vsub.f32 s0, s1, s2', 0xEE300AC1, 'vsub.f32 s0, s1, s2'],
	['vmul.f32 s0, s1, s2', 0xEE200A81, 'vmul.f32 s0, s1, s2'],
	['vnmul.f32 s0, s1, s2', 0xEE200AC1, 'vnmul.f32 s0, s1, s2'],
	['vdiv.f64 d0, d1, d2', 0xEE810B02, 'vdiv.f64 d0, d1, d2'],
	['vmla.f32 s0, s1, s2', 0xEE000A81, 'vmla.f32 s0, s1, s2'],
	['vmls.f32 s0, s1, s2', 0xEE000AC1, 'vmls.f32 s0, s1, s2'],
	['vnmls.f32 s0, s1, s2', 0xEE100A81, 'vnmls.f32 s0, s1, s2'],
	['vnmla.f32 s0, s1, s2', 0xEE100AC1, 'vnmla.f32 s0, s1, s2'],
	['vfma.f64 d0, d1, d2', 0xEEA10B02, 'vfma.f64 d0, d1, d2'],
	['vfms.f64 d0, d1, d2', 0xEEA10B42, 'vfms.f64 d0, d1, d2'],
	['vfnma.f32 s0, s1, s2', 0xEE900AC1, 'vfnma.f32 s0, s1, s2'],
	['vfnms.f32 s0, s1, s2', 0xEE900A81, 'vfnms.f32 s0, s1, s2'],
	['vsqrt.f64 d0, d1', 0xEEB10BC1, 'vsqrt.f64 d0, d1'],
	['vabs.f32 s0, s1', 0xEEB00AE0, 'vabs.f32 s0, s1'],
	['vneg.f64 d1, d2', 0xEEB11B42, 'vneg.f64 d1, d2'],
	['vmov.f32 s0, s1', 0xEEB00A60, 'vmov.f32 s0, s1'],
	['vmov.f32 s0, #1.0', 0xEEB70A00, 'vmov.f32 s0, #1.0'],
	['vmov.f64 d0, #1.5', 0xEEB70B08, 'vmov.f64 d0, #1.5'],
	['vmov.f32 s3, #-0.125', 0xEEFC1A00, 'vmov.f32 s3, #-0.125'],
	['vcmp.f32 s0, s1', 0xEEB40A60, 'vcmp.f32 s0, s1'],
	['vcmpe.f64 d0, d1', 0xEEB40BC1, 'vcmpe.f64 d0, d1'],
	['vcmp.f32 s0, #0', 0xEEB50A40, 'vcmp.f32 s0, #0.0'],
	['vcmpe.f64 d2, #0.0', 0xEEB52BC0, 'vcmpe.f64 d2, #0.0'],
	['vcvt.f64.f32 d0, s0', 0xEEB70AC0, 'vcvt.f64.f32 d0, s0'],
	['vcvt.f32.f64 s0, d1', 0xEEB70BC1, 'vcvt.f32.f64 s0, d1'],
	['vcvt.s32.f32 s0, s0', 0xEEBD0AC0, 'vcvt.s32.f32 s0, s0'],
	['vcvtr.s32.f64 s0, d1', 0xEEBD0B41, 'vcvtr.s32.f64 s0, d1'],
	['vcvt.u32.f32 s1, s2', 0xEEFC0AC1, 'vcvt.u32.f32 s1, s2'],
	['vcvt.f64.s32 d0, s0', 0xEEB80BC0, 'vcvt.f64.s32 d0, s0'],
	['vcvt.f32.u32 s0, s1', 0xEEB80A60, 'vcvt.f32.u32 s0, s1'],
	['vcvt.s32.f32 s0, s0, #16', 0xEEBE0AC8, 'vcvt.s32.f32 s0, s0, #16'],
	['vcvt.f64.u16 d0, d0, #4', 0xEEBB0B46, 'vcvt.f64.u16 d0, d0, #4'],
	['vcvt.u16.f64 d3, d3, #8', 0xEEBF3B44, 'vcvt.u16.f64 d3, d3, #8'],
	['vcvt.s32.f32 s1, s1, #1', 0xEEFE0AEF, 'vcvt.s32.f32 s1, s1, #1'],
	['vmov r0, s0', 0xEE100A10, 'vmov r0, s0'],
	['vmov s1, r2', 0xEE002A90, 'vmov s1, r2'],
	['vmov d0, r0, r1', 0xEC410B10, 'vmov d0, r0, r1'],
	['vmov r2, r3, d1', 0xEC532B11, 'vmov r2, r3, d1'],
	['vmov s0, s1, r0, r1', 0xEC410A10, 'vmov s0, s1, r0, r1'],
	['vmrs APSR_nzcv, fpscr', 0xEEF1FA10, 'vmrs APSR_nzcv, fpscr'],
	['vmrs r1, fpscr', 0xEEF11A10, 'vmrs r1, fpscr'],
	['vmsr fpscr, r2', 0xEEE12A10, 'vmsr fpscr, r2'],
	['vldr d0, [r0]', 0xED900B00, 'vldr d0, [r0]'],
	['vstr s1, [r1, #-8]', 0xED410A02, 'vstr s1, [r1, #-8]'],
	['vldr s2, [r3, #1020]', 0xED931AFF, 'vldr s2, [r3, #1020]'],
	['vpush {d8}', 0xED2D8B02, 'vpush {d8}'],
	['vpush {d8-d9}', 0xED2D8B04, 'vpush {d8-d9}'],
	['vpop {s16, s17}', 0xECBD8A02, 'vpop {s16-s17}'],
	['vldmia r0!, {s0-s3}', 0xECB00A04, 'vldmia r0!, {s0-s3}'],
	['vstmdb r1!, {d1-d2}', 0xED211B04, 'vstmdb r1!, {d1-d2}'],
	['vldm r2, {d0}', 0xEC920B02, 'vldmia r2, {d0}'],
	['vaddeq.f32 s0, s1, s2', 0x0E300A81, 'vaddeq.f32 s0, s1, s2'],
	['vmovne r0, s0', 0x1E100A10, 'vmovne r0, s0'],
	['vcvtrlt.s32.f32 s0, s1', 0xBEBD0A60, 'vcvtrlt.s32.f32 s0, s1'],
]

describe('VFP encodings', () => {
	it.each(CASES)('%s', (source, word) => {
		expect(one(source) >>> 0).toBe(word >>> 0)
	})

	it.each(CASES)('disassembles %s', (_source, word, text) => {
		expect(formatOf(word, ARCH_V8)).toBe(FORMAT_VFP)
		expect(disassembleA32(word, BASE, ARCH_V8)).toBe(text)
	})

	it('reads armasm, the precision taken from the registers', () => {
		// armasm's tokenizer cannot read `.` (a decimal point or `.f32`), so no float constants here.
		expect(words('\tvadd s0, s1, s2\n\tvcmpe d0, d1\n', DIALECT_ARMASM)).toEqual([0xEE300A81, 0xEEB40BC1])
	})

	it('reaches a label from the PC', () => {
		// At 0x8000 the PC reads 0x8008; the constant is at 0x8010.
		expect(words('\tvldr d0, value\n\tnop\n\tnop\n\tnop\nvalue:\t.double 2.5\n')[0]).toBe(0xED9F0B02)
	})

	it('lays out .float and .double', () => {
		const data = words('\t.float 1.5, -2.0e-1\n\t.double 1.0e3\n')
		expect(data).toEqual([0x3FC00000, 0xBE4CCCCD, 0x00000000, 0x408F4000])
	})

	it('rejects what VFPv4-D16 lacks', () => {
		const errors = (line: string) => assemble(`\t${line}\n`).diagnostics.map((diagnostic) => diagnostic.message)
		expect(errors('vadd.f64 d16, d0, d1')[0]).toMatch(/VFPv4-D16/)
		expect(errors('vadd.f64 s0, s1, s2')[0]).toMatch(/F64/)
		expect(errors('vmov.f32 s0, #0.1')[0]).toMatch(/not a VMOV immediate/)
		expect(errors('vldr s0, [r0, #2]')[0]).toMatch(/multiple of 4/)
		expect(errors('vstmdb r0, {s0}')[0]).toMatch(/writeback/)
		expect(errors('vpush {s0, s2}')[0]).toMatch(/consecutive/)
	})

	it('rejects VFP when floating point is off', () => {
		const { diagnostics } = assemble('\tvadd.f32 s0, s1, s2\n', DIALECT_GNU, false)
		expect(diagnostics[0].message).toMatch(/Floating point setting/)
	})

	it('decodes D16-D31, odd FLDMX counts and half precision as undefined', () => {
		// vadd.f64 d16, d0, d1 (D set), vldmia r0, {d0} with imm8 3, vcvtb.f32.f16.
		for (const word of [0xEE710B01, 0xEC900B03, 0xEEB20A40]) {
			expect(decodeVfp(word)).toBeNull()
			expect(formatOf(word, ARCH_V8)).toBe(FORMAT_COPROCESSOR)
		}
	})
})

describe('VFP stays out of ARMv2a and Cortex-M0', () => {
	const arm26Errors = (code: string) => assembleArm26({ name: 'test.s', code }).diagnostics.filter((diagnostic) => diagnostic.severity === 'error')

	it.each(['vadd.f32 s0, s1, s2', 'vldr d0, [r0]', 'vmrs APSR_nzcv, fpscr', '.float 1.5'])('ARMv2a rejects %s', (line) => {
		expect(arm26Errors(`\t${line}\n`).length).toBeGreaterThan(0)
	})

	it('decodes VFP words as coprocessor space on ARMv2a', () => {
		expect(formatOf(0xEE300A81)).toBe(FORMAT_COPROCESSOR)
		expect(disassembleA32(0xEE300A81, 0)).not.toMatch(/vadd/)
	})

	it.each(['vadd.f32 s0, s1, s2', 'vldr d0, [r0]', 'vmrs APSR_nzcv, fpscr', '.float 1.5'])('Cortex-M0 rejects %s', (line) => {
		const program = assembleM0({ files: [{ name: 'test.s', code: `\t.text\n\t${line}\n` }], entries: ['test.s'] }, 1 << 16)
		expect(program.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(true)
	})
})

describe('VFP in the A32 editor', () => {
	const keyword = (arch: number) => {
		const rules = (armGrammar(arch).monarch.tokenizer as unknown as { root: [RegExp, unknown][] }).root
		return new RegExp(`^(?:${rules.find(([, action]) => action === 'keyword')![0].source})$`, 'i')
	}

	it('highlights VFP mnemonics, registers and float directives on ARMv8 only', () => {
		for (const text of ['vaddeq.f32', 'vcvtr.s32.f64', 'vpush', 'vldmia', 'vmrs']) {
			expect(keyword(ARCH_V8).test(text), text).toBe(true)
			expect(keyword(ARCH_V2A).test(text), text).toBe(false)
		}
		expect(armGrammar(ARCH_V8).registers).toEqual(expect.arrayContaining(['s31', 'd15', 'fpscr', 'apsr_nzcv']))
		expect(armGrammar(ARCH_V2A).registers).not.toContain('s0')
		expect(armGrammar(ARCH_V8).completions).toContain('vfma')
	})

	it('describes S and D registers as floats, and VFP mnemonics', () => {
		const state = { registers: { S0: 0x3FC00000, S1: 0, S2: 0, S3: 0x3FF80000 }, labels: new Map(), memory: { word: () => undefined } } as unknown as DebugInspection
		expect(describeArmToken('vadd.f32 s0, s0, s0', 9, state, { arch: ARCH_V8 })?.contents[0]).toMatch(/S0.*1\.5.*0x3fc00000/s)
		expect(describeArmToken('vmov.f64 d1, d1', 9, state, { arch: ARCH_V8 })?.contents[0]).toMatch(/D1.*1\.5/s)
		expect(describeArmToken('vcvtrlt.s32.f32 s0, s1', 2, state, { arch: ARCH_V8 })?.contents.join('\n')).toMatch(/rounding as FPSCR says.*signed less/s)
		expect(armInstructionHelp('vadd.f32', ARCH_V2A)).toBeNull()
		expect(describeArmToken('vadd.f32 s0, s0, s0', 9, state)?.register).toBeUndefined()
	})
})
