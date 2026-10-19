import { describe, expect, it } from 'vitest'
import { assembleA64 } from '../assembler'
import { disassemble } from '../disassemble'
import { TEXT_BASE } from '../layout'

/** Words and their preferred disassembly, per the alias rules of the Arm ARM (C6.2). */
const CASES: [number, string][] = [
	[0xD2800000, 'mov x0, #0'],
	[0xD2800BA8, 'mov x8, #0x5d'],
	[0x92800000, 'mov x0, #-1'],
	[0x12800000, 'mov w0, #-1'],
	[0x12BFFFE0, 'movn w0, #0xffff, lsl #16'],
	[0xD2A00000, 'movz x0, #0, lsl #16'],
	[0xF2A24680, 'movk x0, #0x1234, lsl #16'],
	[0xB2103FE0, 'mov x0, #0xffff0000ffff0000'],
	[0xB2400FE0, 'orr x0, xzr, #0xf'],
	[0xAA0103E0, 'mov x0, x1'],
	[0x910003FD, 'mov x29, sp'],
	[0x91000420, 'add x0, x1, #1'],
	[0xD10043FF, 'sub sp, sp, #0x10'],
	[0x91400420, 'add x0, x1, #1, lsl #12'],
	[0xF100001F, 'cmp x0, #0'],
	[0x6B01001F, 'cmp w0, w1'],
	[0x8B020C20, 'add x0, x1, x2, lsl #3'],
	[0x8B2163E0, 'add x0, sp, x1'],
	[0x8B22C820, 'add x0, x1, w2, sxtw #2'],
	[0xCB2073FF, 'sub sp, sp, x0, lsl #4'],
	[0xCB0103E0, 'neg x0, x1'],
	[0xDA0103E0, 'ngc x0, x1'],
	[0x92401C20, 'and x0, x1, #0xff'],
	[0x7200001F, 'tst w0, #1'],
	[0xEA01001F, 'tst x0, x1'],
	[0x2A2103E0, 'mvn w0, w1'],
	[0x2AC21020, 'orr w0, w1, w2, ror #4'],
	[0xD37DF020, 'lsl x0, x1, #3'],
	[0xD343FC20, 'lsr x0, x1, #3'],
	[0x9343FC20, 'asr x0, x1, #3'],
	[0xD3442C20, 'ubfx x0, x1, #4, #8'],
	[0xD37E7420, 'ubfiz x0, x1, #2, #30'],
	[0xB3780C20, 'bfi x0, x1, #8, #4'],
	[0x33041C20, 'bfxil w0, w1, #4, #4'],
	[0x93407C20, 'sxtw x0, w1'],
	[0x53001C20, 'uxtb w0, w1'],
	[0x13003C20, 'sxth w0, w1'],
	[0x93C12020, 'ror x0, x1, #8'],
	[0x93C22020, 'extr x0, x1, x2, #8'],
	[0x9AC22020, 'lsl x0, x1, x2'],
	[0x9B027C20, 'mul x0, x1, x2'],
	[0x9B020C20, 'madd x0, x1, x2, x3'],
	[0x9B227C20, 'smull x0, w1, w2'],
	[0x9BC27C20, 'umulh x0, x1, x2'],
	[0x9AC20C20, 'sdiv x0, x1, x2'],
	[0x5AC00820, 'rev w0, w1'],
	[0xDAC00C20, 'rev x0, x1'],
	[0x1A9F17E0, 'cset w0, eq'],
	[0xDA9F03E0, 'csetm x0, ne'],
	[0x9A811420, 'cinc x0, x1, eq'],
	[0x5A815420, 'cneg w0, w1, mi'],
	[0x9A82B020, 'csel x0, x1, x2, lt'],
	[0xFA421800, 'ccmp x0, #2, #0, ne'],
	[0xD65F03C0, 'ret'],
	[0xD61F0200, 'br x16'],
	[0xD4000001, 'svc #0'],
	[0xD503201F, 'nop'],
	[0xF9400420, 'ldr x0, [x1, #8]'],
	[0xB9000FE0, 'str w0, [sp, #12]'],
	[0x39C00020, 'ldrsb w0, [x1]'],
	[0xB9800020, 'ldrsw x0, [x1]'],
	[0xF85F83A0, 'ldur x0, [x29, #-8]'],
	[0x38001422, 'strb w2, [x1], #1'],
	[0xF81F0FE0, 'str x0, [sp, #-16]!'],
	[0xF8627820, 'ldr x0, [x1, x2, lsl #3]'],
	[0xB8625820, 'ldr w0, [x1, w2, uxtw #2]'],
	[0xA9BF7BFD, 'stp x29, x30, [sp, #-16]!'],
	[0xA8C17BFD, 'ldp x29, x30, [sp], #16'],
	[0x69400440, 'ldpsw x0, x1, [x2]'],
	[0x00000000, '.inst 0x00000000'],
]

describe('A64 disassembly', () => {
	it.each(CASES)('%i reads as %s', (word, text) => {
		expect(disassemble(word, TEXT_BASE)).toBe(text)
	})

	it('names branch targets as addresses', () => {
		expect(disassemble(0x14000002, TEXT_BASE)).toBe('b 0x00400008')
		expect(disassemble(0x97FFFFFF, TEXT_BASE + 4)).toBe('bl 0x00400000')
		expect(disassemble(0x54FFFFC1, TEXT_BASE + 8)).toBe('b.ne 0x00400000')
		expect(disassemble(0xB647FF61, TEXT_BASE + 20)).toBe('tbz x1, #40, 0x00400000')
		expect(disassemble(0xB0000003, TEXT_BASE + 28)).toBe('adrp x3, 0x00401000')
		expect(disassemble(0x58000080, TEXT_BASE)).toBe('ldr x0, 0x00400010')
	})

	it('reassembles what it prints to the same word', () => {
		for (const [word] of CASES.slice(0, -1)) {
			const result = assembleA64({ name: 'round.s', code: `\t${disassemble(word, TEXT_BASE)}\n` })
			expect(result.diagnostics).toEqual([])
			const bytes = result.image!.sections[0].bytes
			expect(new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true).toString(16)).toBe(word.toString(16))
		}
	})
})
