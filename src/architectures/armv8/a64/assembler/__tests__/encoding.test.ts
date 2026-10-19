import { describe, expect, it } from 'vitest'
import { assembleA64 } from '..'
import { DATA_BASE, TEXT_BASE } from '../../layout'

/** Every word the program assembles to, from the start of the text. */
function words(code: string): number[] {
	const result = assembleA64({ name: 'test.s', code })
	expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([])
	const text = result.image!.sections.find((section) => section.address === TEXT_BASE)!
	const view = new DataView(text.bytes.buffer, text.bytes.byteOffset, text.bytes.byteLength)
	return Array.from({ length: text.bytes.length / 4 }, (_, index) => view.getUint32(index * 4, true))
}

const one = (line: string) => words(`\t${line}\n`)[0]

function errors(code: string): string[] {
	return assembleA64({ name: 'test.s', code }).diagnostics.filter((diagnostic) => diagnostic.severity === 'error').map((diagnostic) => diagnostic.message)
}

/**
 * Expected words are worked out by hand from the encoding diagrams in the Arm
 * ARM (DDI 0487) and agree with GNU as; they are not produced by this assembler.
 */
const CASES: [string, number][] = [
	['mov x0, #0', 0xD2800000],
	['mov x0, #1', 0xD2800020],
	['mov w0, #42', 0x52800540],
	['mov x8, #93', 0xD2800BA8],
	['mov x0, #-1', 0x92800000],
	['mov w0, #-1', 0x12800000],
	['mov x0, #0x10000', 0xD2A00020],
	['mov x0, #0xffff0000ffff0000', 0xB2103FE0],
	['movk x0, #0x1234, lsl #16', 0xF2A24680],
	['movz w1, #0xbeef', 0x5297DDE1],
	['movn x2, #5, lsl #32', 0x92C000A2],
	['mov x0, x1', 0xAA0103E0],
	['mov w0, w1', 0x2A0103E0],
	['mov x29, sp', 0x910003FD],
	['mov sp, x1', 0x9100003F],
	['add x0, x1, #1', 0x91000420],
	['sub sp, sp, #16', 0xD10043FF],
	['add x0, x1, #1, lsl #12', 0x91400420],
	['add x0, x1, #0x5000', 0x91401420],
	['add x0, x1, #-8', 0xD1002020],
	['adds w3, w4, #4095', 0x313FFC83],
	['cmp x0, #0', 0xF100001F],
	['cmn w1, #1', 0x3100043F],
	['cmp w0, w1', 0x6B01001F],
	['add x0, x0, x1', 0x8B010000],
	['sub x0, x0, x1', 0xCB010000],
	['add x0, x1, x2, lsl #3', 0x8B020C20],
	['subs w0, w1, w2, asr #31', 0x6B827C20],
	['add x0, sp, x1', 0x8B2163E0],
	['add x0, x1, w2, sxtw #2', 0x8B22C820],
	['sub sp, sp, x0, lsl #4', 0xCB2073FF],
	['neg x0, x1', 0xCB0103E0],
	['negs w0, w1, lsl #2', 0x6B010BE0],
	['adc x0, x1, x2', 0x9A020020],
	['sbcs w0, w1, w2', 0x7A020020],
	['ngc x0, x1', 0xDA0103E0],
	['and x0, x1, #0xff', 0x92401C20],
	['orr w0, w1, #1', 0x32000020],
	['eor x3, x4, #0x5555555555555555', 0xD200F083],
	['ands w0, w1, #0xf0', 0x721C0C20],
	['tst w0, #1', 0x7200001F],
	['and sp, x0, #0xfffffffffffffff0', 0x927CEC1F],
	['bic x0, x0, #7', 0x927DF000],
	['and x0, x1, x2', 0x8A020020],
	['orr w0, w1, w2, ror #4', 0x2AC21020],
	['eon x0, x1, x2', 0xCA220020],
	['bics x0, x1, x2', 0xEA220020],
	['tst x0, x1', 0xEA01001F],
	['mvn w0, w1', 0x2A2103E0],
	['lsl x0, x1, #3', 0xD37DF020],
	['lsr x0, x1, #3', 0xD343FC20],
	['asr x0, x1, #3', 0x9343FC20],
	['lsl w0, w1, #1', 0x531F7820],
	['ror x0, x1, #8', 0x93C12020],
	['lsl x0, x1, x2', 0x9AC22020],
	['asr w0, w1, w2', 0x1AC22820],
	['ubfx x0, x1, #4, #8', 0xD3442C20],
	['sbfx w0, w1, #0, #16', 0x13003C20],
	['ubfiz x0, x1, #2, #30', 0xD37E7420],
	['bfi x0, x1, #8, #4', 0xB3780C20],
	['bfxil w0, w1, #4, #4', 0x33041C20],
	['sxtw x0, w1', 0x93407C20],
	['sxtb x0, w1', 0x93401C20],
	['sxth w0, w1', 0x13003C20],
	['uxtb w0, w1', 0x53001C20],
	['uxth w0, w1', 0x53003C20],
	['extr x0, x1, x2, #8', 0x93C22020],
	['mul x0, x1, x2', 0x9B027C20],
	['madd x0, x1, x2, x3', 0x9B020C20],
	['msub w0, w1, w2, w3', 0x1B028C20],
	['mneg x0, x1, x2', 0x9B02FC20],
	['smull x0, w1, w2', 0x9B227C20],
	['umull x0, w1, w2', 0x9BA27C20],
	['smaddl x0, w1, w2, x3', 0x9B220C20],
	['umsubl x0, w1, w2, x3', 0x9BA28C20],
	['smulh x0, x1, x2', 0x9B427C20],
	['umulh x0, x1, x2', 0x9BC27C20],
	['sdiv x0, x1, x2', 0x9AC20C20],
	['udiv w0, w1, w2', 0x1AC20820],
	['rbit w0, w1', 0x5AC00020],
	['rev w0, w1', 0x5AC00820],
	['rev x0, x1', 0xDAC00C20],
	['rev32 x0, x1', 0xDAC00820],
	['rev16 w0, w1', 0x5AC00420],
	['clz x0, x1', 0xDAC01020],
	['cls w0, w1', 0x5AC01420],
	['csel x0, x1, x2, lt', 0x9A82B020],
	['csinc w0, w1, w2, ge', 0x1A82A420],
	['csinv x0, x1, x2, hs', 0xDA822020],
	['csneg w0, w1, w2, lo', 0x5A823420],
	['cset w0, eq', 0x1A9F17E0],
	['csetm x0, ne', 0xDA9F03E0],
	['cinc x0, x1, eq', 0x9A811420],
	['cinv w0, w1, gt', 0x5A81D020],
	['cneg w0, w1, mi', 0x5A815420],
	['ccmp x0, #2, #0, ne', 0xFA421800],
	['ccmn w1, w2, #4, eq', 0x3A420024],
	['br x16', 0xD61F0200],
	['blr x1', 0xD63F0020],
	['ret', 0xD65F03C0],
	['ret x1', 0xD65F0020],
	['svc #0', 0xD4000001],
	['hlt #0', 0xD4400000],
	['brk #1', 0xD4200020],
	['nop', 0xD503201F],
	['ldr x0, [x1]', 0xF9400020],
	['ldr x0, [x1, #8]', 0xF9400420],
	['str w0, [sp, #12]', 0xB9000FE0],
	['ldrb w0, [x1]', 0x39400020],
	['ldrh w2, [x3, #6]', 0x79400C62],
	['strh w2, [x3, #2]', 0x79000462],
	['ldrsb x0, [x1]', 0x39800020],
	['ldrsb w0, [x1]', 0x39C00020],
	['ldrsh x0, [x1, #2]', 0x79800420],
	['ldrsw x0, [x1]', 0xB9800020],
	['ldr x0, [x1, #-8]', 0xF85F8020],
	['ldr x0, [x1, #3]', 0xF8403020],
	['ldur x0, [x29, #-8]', 0xF85F83A0],
	['stur w1, [sp, #4]', 0xB80043E1],
	['ldursw x0, [x1, #-4]', 0xB89FC020],
	['strb w2, [x1], #1', 0x38001422],
	['ldr x0, [sp, #-16]!', 0xF85F0FE0],
	['str x0, [sp, #-16]!', 0xF81F0FE0],
	['ldr x0, [sp], #16', 0xF84107E0],
	['ldr x0, [x1, x2, lsl #3]', 0xF8627820],
	['ldr w0, [x1, w2, uxtw #2]', 0xB8625820],
	['ldrb w0, [x1, x2]', 0x38626820],
	['str x0, [x1, w2, sxtw]', 0xF822C820],
	['stp x29, x30, [sp, #-16]!', 0xA9BF7BFD],
	['ldp x29, x30, [sp], #16', 0xA8C17BFD],
	['stp w0, w1, [sp, #8]', 0x290107E0],
	['ldp x0, x1, [x2, #-16]', 0xA97F0440],
	['ldpsw x0, x1, [x2]', 0x69400440],
	['ldr x0, =1', 0xD2800020],
	['ldr w0, =-1', 0x12800000],
	['.inst 0x12345678', 0x12345678],
]

describe('A64 encodings', () => {
	it.each(CASES)('%s', (line, expected) => {
		expect(one(line).toString(16)).toBe(expected.toString(16))
	})

	it('encodes PC-relative targets', () => {
		const code = `
	.equ far, 0x401000
_start:
	b next
	bl _start
next:
	b.ne _start
	cbz x0, done
	tbnz w0, #3, done
	tbz x1, #40, _start
	adr x2, _start
	adrp x3, far
	bne next
done:
	b .
`
		expect(words(code).map((word) => word.toString(16))).toEqual([
			0x14000002, 0x97FFFFFF, 0x54FFFFC1, 0xB40000C0, 0x371800A0, 0xB647FF61, 0x10FFFF42, 0xB0000003, 0x54FFFF41, 0x14000000,
		].map((word) => word.toString(16)))
	})

	it('places a literal pool after the code, doublewords first', () => {
		const result = assembleA64({ name: 'pool.s', code: '\tldr x0, =0x123456789abcdef1\n\tldr w1, =0x12345678\n\tldr x2, =0x123456789abcdef1\n\tret\n' })
		const text = result.image!.sections[0]
		const view = new DataView(text.bytes.buffer, text.bytes.byteOffset)
		// ldr x0 at +0 reads +16; ldr w1 at +4 reads +24; ldr x2 at +8 shares +16.
		expect(view.getUint32(0, true).toString(16)).toBe((0x58000000 | (4 << 5)).toString(16))
		expect(view.getUint32(4, true).toString(16)).toBe((0x18000000 | (5 << 5) | 1).toString(16))
		expect(view.getUint32(8, true).toString(16)).toBe((0x58000000 | (2 << 5) | 2).toString(16))
		expect(view.getBigUint64(16, true)).toBe(0x123456789ABCDEF1n)
		expect(view.getUint32(24, true)).toBe(0x12345678)
	})

	it('flushes the pool at .ltorg', () => {
		const result = assembleA64({ name: 'pool.s', code: '\tldr x0, =label\n\tb over\n\t.ltorg\nover:\n\tret\nlabel:\n' })
		const view = new DataView(result.image!.sections[0].bytes.buffer)
		// ldr at +0, b at +4, pool at +8, over at +16, label at +20.
		expect(view.getUint32(0, true).toString(16)).toBe((0x58000000 | (2 << 5)).toString(16))
		expect(view.getBigUint64(8, true)).toBe(BigInt(TEXT_BASE + 20))
	})

	it('lays data out from DATA_BASE', () => {
		const result = assembleA64({ name: 'data.s', code: `
	.data
bytes:	.byte 1, 2, -1
	.align 3
quad:	.quad 0xfedcba9876543210, -2
half:	.hword 0x1234
word:	.word bytes
str:	.asciz "hi\\n"
	.balign 4
space:	.space 3, 0xaa
	.text
	adrp x0, quad
	add x0, x0, :lo12:quad
	ldr x1, [x0, :lo12:quad]
` })
		expect(result.diagnostics).toEqual([])
		const data = result.image!.sections.find((section) => section.address === DATA_BASE)!
		const view = new DataView(data.bytes.buffer, data.bytes.byteOffset)
		expect([...data.bytes.slice(0, 3)]).toEqual([1, 2, 255])
		expect(view.getBigUint64(8, true)).toBe(0xFEDCBA9876543210n)
		expect(view.getBigUint64(16, true)).toBe(0xFFFFFFFFFFFFFFFEn)
		expect(view.getUint16(24, true)).toBe(0x1234)
		expect(view.getUint32(26, true)).toBe(DATA_BASE)
		expect([...data.bytes.slice(30, 34)]).toEqual([104, 105, 10, 0])
		expect([...data.bytes.slice(36, 39)]).toEqual([0xAA, 0xAA, 0xAA])
		expect(result.values.get('space')).toBe(DATA_BASE + 36)
		const text = new DataView(result.image!.sections.find((section) => section.address === TEXT_BASE)!.bytes.buffer)
		// quad is on page 0x420000, 0x20 pages past the code.
		expect(text.getUint32(0, true).toString(16)).toBe(((0x90000000 | (0x20 >> 2 << 5)) >>> 0).toString(16))
		expect(text.getUint32(4, true).toString(16)).toBe(((0x91000000 | (8 << 10)) >>> 0).toString(16))
		expect(text.getUint32(8, true).toString(16)).toBe(((0xF9400000 | (1 << 10) | 1) >>> 0).toString(16))
	})

	it('expands macros, repeats and local labels', () => {
		const code = `
	.equ COUNT, 3
	.macro push reg
	str \\reg, [sp, #-16]!
	.endm
	.macro inc reg, by=1
	add \\reg, \\reg, #\\by
	.endm
	push x0
	inc x1
	inc x2, 5
	.rept COUNT
	nop
	.endr
1:	subs x0, x0, #1
	b.ne 1b
	cbz x0, 1f
1:	ret
`
		expect(words(code).map((word) => word.toString(16))).toEqual([
			0xF81F0FE0, 0x91000421, 0x91001442, 0xD503201F, 0xD503201F, 0xD503201F, 0xF1000400, 0x54FFFFE1, 0xB4000020, 0xD65F03C0,
		].map((word) => word.toString(16)))
	})

	it('keeps statements after a macro on its line in order', () => {
		expect(words('\t.macro two\n\tnop\n\tnop\n\t.endm\n\ttwo; ret\n').map((word) => word.toString(16))).toEqual(['d503201f', 'd503201f', 'd65f03c0'])
	})

	it('reports what it cannot encode', () => {
		expect(errors('\tand x0, x1, #0\n')[0]).toMatch(/bitmask/)
		expect(errors('\tmov x0, #0x123456789\n')[0]).toMatch(/cannot be moved in one instruction/)
		expect(errors('\tadd x0, x1, #4097\n')[0]).toMatch(/out of range/)
		expect(errors('\tadd x0, w1, x2\n')[0]).toMatch(/X or all be W/)
		expect(errors('\tldrb x0, [x1]\n')[0]).toMatch(/W register/)
		expect(errors('\tadd x0, xzr, #1\n')[0]).toMatch(/stack pointer/)
		expect(errors('\tfoo x0\n')[0]).toMatch(/Unknown instruction foo/)
		expect(errors('\tb.ne 1f\n')[0]).toMatch(/Local label 1/)
		expect(errors('\tldr x0, [x1, #4097]\n')[0]).toMatch(/neither a multiple/)
		expect(errors('\tcset x0, al\n')[0]).toMatch(/al or nv/)
		expect(errors('\tb nowhere\n')[0]).toMatch(/nowhere/)
	})

	it('positions diagnostics on their line', () => {
		const [diagnostic] = assembleA64({ name: 'x.s', code: 'main:\n\tmov x0, #1\n\tbogus x1\n' }).diagnostics
		expect(diagnostic).toMatchObject({ file: 'x.s', line: 3 })
	})

	it('starts at _start, else main', () => {
		expect(assembleA64({ name: 'a.s', code: '\tnop\nmain:\n\tret\n' }).image!.entryAddress).toBe(TEXT_BASE + 4)
		expect(assembleA64({ name: 'a.s', code: '\tnop\n_start:\n\tnop\nmain:\n\tret\n' }).image!.entryAddress).toBe(TEXT_BASE + 4)
		expect(assembleA64({ name: 'a.s', code: '\tret\n' }).image!.entryAddress).toBe(TEXT_BASE)
	})
})
