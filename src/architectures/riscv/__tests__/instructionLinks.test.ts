import { describe, expect, it } from 'vitest'
import { riscvInstructionHelp } from '../instructionHelp'

const MANUAL = 'https://docs.riscv.org/reference/isa/v20260120/unpriv/'

describe('RISC-V instruction links', () => {
	it.each([
		['addi', 'rv32.html#norm:addi_op'],
		['bgeu', 'rv32.html#norm:bge_bgeu_op'],
		['mv', 'rv32.html#norm:addi_op'],
		['fence', 'rv32.html#norm:fence_op'],
		['mulhsu', 'm-st-ext.html#norm:mulh_mulhu_mulhsu_op'],
		['fmadd.s', 'f-st-ext.html#norm:fmadd-s_op'],
		['fcvt.d.wu', 'd-st-ext.html#norm:fcvt-wu-d_fcvt-lu-d_fcvt-d-wu_fcvt-d-lu_op'],
		['c.fsdsp', 'c-st-ext.html#norm:c-fsdwsp_op'],
		['csrsi', 'zicsr.html#norm:csrrwi_csrrsi_csrrci_ops'],
	])('links %s to its normative rule in the ratified manual', (name, page) => {
		expect(riscvInstructionHelp(name)!.contents[0]).toBe(`**[${name.toUpperCase()}](${MANUAL}${page} "Open ${name.toUpperCase()} in the manual")**`)
	})
})
