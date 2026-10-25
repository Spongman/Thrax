import { describe, expect, it } from 'vitest'
import { ARCH_V2A, ARCH_V8 } from '../shared/a32/isa'
import { armInstructionHelp } from '../shared/instructionHelp'
import { a64InstructionHelp } from '../instructionHelp'
import { m0InstructionHelp } from '../m0/instructionHelp'

const A64 = 'https://developer.arm.com/documentation/ddi0602/2026-09/'
const A32 = 'https://developer.arm.com/documentation/ddi0597/2026-09/'
const M0 = 'https://developer.arm.com/documentation/dui0497/a/the-cortex-m0-instruction-set/'
const ARM3 = 'https://www.riscos.com/support/developers/asm/instrset.html'

const linked = (name: string, url: string) => `**[${name.toUpperCase()}](${url} "Open ${name.toUpperCase()} in the manual")**`

describe('ARM instruction links', () => {
	it.each([
		['add', `${A64}Base-Instructions/ADD--shifted-register---Add-optionally-shifted-register-`],
		['b.ne', `${A64}Base-Instructions/B-cond--Branch-conditionally-`],
		['ldur', `${A64}Base-Instructions/LDUR--Load-register--unscaled--`],
		['fmadd', `${A64}SIMD-FP-Instructions/FMADD--Floating-point-fused-multiply-add--scalar--`],
		['scvtf', `${A64}SIMD-FP-Instructions/SCVTF--scalar--integer---Signed-integer-convert-to-floating-point--scalar--`],
	])('A64 %s links to its DDI 0602 page', (name, url) => {
		expect(a64InstructionHelp(name)!.contents[0]).toBe(linked(name, url))
	})

	it.each([
		['addseq', `${A32}Base-Instructions/ADD--ADDS--register---Add--register--`],
		['ldrsh', `${A32}Base-Instructions/LDRSH--immediate---Load-Register-Signed-Halfword--immediate--`],
		['swi', `${A32}Base-Instructions/SVC--Supervisor-Call-`],
		['vldmia', `${A32}SIMD-FP-Instructions/VLDM--VLDMDB--VLDMIA--Load-Multiple-SIMD-FP-registers-`],
	])('A32 %s links to its DDI 0597 page', (name, url) => {
		expect(armInstructionHelp(name, ARCH_V8)!.contents[0]).toBe(linked(name, url))
	})

	it.each([
		['addseq', 39219], ['bl', 87420], ['mla', 57266], ['ldrb', 10903], ['stmfd', 70501], ['swp', 41730], ['swi', 36610], ['mcr', 53274],
	])('ARM26 %s links to section %i of the Acorn manual', (name, page) => {
		expect(armInstructionHelp(name, ARCH_V2A)!.contents[0]).toBe(linked(name, `${ARM3}#${page}`))
	})

	it.each([
		['adds', 'general-data-processing-instructions/adc--add--rsb--sbc--and-sub'],
		['bne', 'branch-and-control-instructions/b--bl--bx--and-blx'],
		['ldrsb', 'memory-access-instructions/ldr-and-str--register-offset'],
		['cpsid', 'miscellaneous-instructions/cps'],
		['wfi', 'miscellaneous-instructions/wfi'],
	])('Cortex-M0 %s links to its DUI 0497 page', (name, page) => {
		expect(m0InstructionHelp(name)!.contents[0]).toBe(linked(name, M0 + page))
	})

	it('leaves mnemonics without a manual page unlinked', () => {
		expect(m0InstructionHelp('yield')!.contents[0]).toBe('**YIELD**')
	})
})
