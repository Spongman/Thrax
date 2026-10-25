import { describe, expect, it } from 'vitest'
import { encodeInstruction, parseOperand } from '../assembler'
import { decode } from '../isa'

// Expected bytes follow the operand specifier formats of the VAX Architecture
// Reference Manual (EY-3459E-DP, chapter 2): mode in bits 7:4, register in 3:0,
// short literals 0-63, 8F immediate, 9F absolute, AF/CF/EF PC-relative.
const symbols: Record<string, number> = { HERE: 0x1000, FAR: 0x20000, TABLE: 0x1100 }
const evaluate = (text: string) => {
	const t = text.trim().toUpperCase()
	if (t in symbols) return symbols[t]
	if (/^\^X[\dA-F]+$/.test(t)) return parseInt(t.slice(2), 16)
	if (/^\^M<.*>$/.test(t)) return t.slice(3, -1).split(',').reduce((mask, r) => mask | 1 << Number(r.trim().slice(1)), 0)
	const n = Number(t)
	if (Number.isNaN(n)) throw new Error(`no value for ${text}`)
	return n
}
const bytes = (mnemonic: string, ...operands: string[]) => encodeInstruction(mnemonic, operands, 0x1000, evaluate).bytes

describe('VAX operand specifier encodings', () => {
	it.each([
		['MOVL', ['R1', 'R2'], [0xd0, 0x51, 0x52]],
		['MOVL', ['#1', 'R0'], [0xd0, 0x01, 0x50]],
		['MOVL', ['#63', 'R0'], [0xd0, 0x3f, 0x50]],
		['MOVL', ['#100', 'R0'], [0xd0, 0x8f, 0x64, 0x00, 0x00, 0x00, 0x50]],
		['MOVL', ['#-1', 'R0'], [0xd0, 0x8f, 0xff, 0xff, 0xff, 0xff, 0x50]],
		['MOVL', ['I^#1', 'R0'], [0xd0, 0x8f, 0x01, 0x00, 0x00, 0x00, 0x50]],
		['MOVW', ['#1000', 'R0'], [0xb0, 0x8f, 0xe8, 0x03, 0x50]],
		['MOVL', ['(R1)', 'R0'], [0xd0, 0x61, 0x50]],
		['MOVL', ['(R1)+', '-(SP)'], [0xd0, 0x81, 0x7e]],
		['MOVL', ['@(R1)+', 'R0'], [0xd0, 0x91, 0x50]],
		['MOVL', ['4(R1)', 'R0'], [0xd0, 0xa1, 0x04, 0x50]],
		['MOVL', ['-4(FP)', 'R0'], [0xd0, 0xad, 0xfc, 0x50]],
		['MOVL', ['300(R1)', 'R0'], [0xd0, 0xc1, 0x2c, 0x01, 0x50]],
		['MOVL', ['70000(R1)', 'R0'], [0xd0, 0xe1, 0x70, 0x11, 0x01, 0x00, 0x50]],
		['MOVL', ['L^4(R1)', 'R0'], [0xd0, 0xe1, 0x04, 0x00, 0x00, 0x00, 0x50]],
		['MOVL', ['@4(R1)', 'R0'], [0xd0, 0xb1, 0x04, 0x50]],
		['MOVL', ['@(R1)', 'R0'], [0xd0, 0xb1, 0x00, 0x50]],
		['MOVL', ['@W^8(AP)', 'R0'], [0xd0, 0xdc, 0x08, 0x00, 0x50]],
		['MOVL', ['(R1)[R2]', 'R0'], [0xd0, 0x42, 0x61, 0x50]],
		['MOVL', ['@#^X1000', 'R0'], [0xd0, 0x9f, 0x00, 0x10, 0x00, 0x00, 0x50]],
		// Relative to the PC after the displacement: 0x1000 - 0x1003.
		['MOVL', ['HERE', 'R0'], [0xd0, 0xaf, 0xfd, 0x50]],
		['MOVL', ['@HERE', 'R0'], [0xd0, 0xbf, 0xfd, 0x50]],
		['MOVL', ['FAR', 'R0'], [0xd0, 0xef, 0xfa, 0xef, 0x01, 0x00, 0x50]],
		['MOVL', ['TABLE[R3]', 'R0'], [0xd0, 0x43, 0xcf, 0xfb, 0x00, 0x50]],
		['ADDL3', ['#3', '#5', 'R0'], [0xc1, 0x03, 0x05, 0x50]],
		['CLRQ', ['-(SP)'], [0x7c, 0x7e]],
		['PUSHR', ['#^M<R2,R3>'], [0xbb, 0x0c]],
		['CALLS', ['#2', '@#^X2000'], [0xfb, 0x02, 0x9f, 0x00, 0x20, 0x00, 0x00]],
		['RET', [], [0x04]],
		['BRB', ['HERE'], [0x11, 0xfe]],
		['BRW', ['HERE'], [0x31, 0xfd, 0xff]],
		['BNEQ', ['^X1010'], [0x12, 0x0e]],
		['AOBLSS', ['#32', 'R4', 'HERE'], [0xf2, 0x20, 0x54, 0xfc]],
		['CHMK', ['#5'], [0xbc, 0x05]],
		['MTPR', ['R0', '#35'], [0xda, 0x50, 0x23]],
		// Floating short literals are 0.1fff x 2^eee: 8 is 1.0, 12 is 1.5, 0 is 0.5.
		['MOVF', ['#1.0', 'R0'], [0x50, 0x08, 0x50]],
		['MOVF', ['#1.5', 'R0'], [0x50, 0x0c, 0x50]],
		['MOVF', ['#0.5', 'R0'], [0x50, 0x00, 0x50]],
		['MOVF', ['#2', 'R0'], [0x50, 0x10, 0x50]],
		// F_floating 1.0 is the longword ^X4080; 0.1 is words 3ECC, CCCD.
		['MOVF', ['I^#1.0', 'R0'], [0x50, 0x8f, 0x80, 0x40, 0x00, 0x00, 0x50]],
		['MOVF', ['#0.1', 'R0'], [0x50, 0x8f, 0xcc, 0x3e, 0xcd, 0xcc, 0x50]],
		['MOVD', ['#-2.5', 'R0'], [0x70, 0x8f, 0x20, 0xc1, 0, 0, 0, 0, 0, 0, 0x50]],
		['ADDG2', ['R0', 'R2'], [0xfd, 0x40, 0x50, 0x52]],
		['MOVG', ['I^#1.0', 'R0'], [0xfd, 0x50, 0x8f, 0x10, 0x40, 0, 0, 0, 0, 0, 0, 0x50]],
		['MOVO', ['(R1)', '(R2)'], [0xfd, 0x7d, 0x61, 0x62]],
	] as const)('encodes %s %j', (mnemonic, operands, expected) => {
		expect(bytes(mnemonic, ...operands)).toEqual(expected)
	})

	it('picks the longword form for a forward reference and keeps a planned choice', () => {
		const unknown = encodeInstruction('MOVL', ['LATER', 'R0'], 0x1000, () => undefined)
		expect(unknown.bytes).toEqual([0xd0, 0xef, 0, 0, 0, 0, 0x50])
		expect(encodeInstruction('MOVL', ['LATER', 'R0'], 0x1000, () => 0x1010, unknown.plan).bytes).toEqual([0xd0, 0xef, 0x0a, 0, 0, 0, 0x50])
		expect(encodeInstruction('MOVL', ['#LATER', 'R0'], 0x1000, () => undefined).bytes).toHaveLength(7)
	})

	it('rejects modes the architecture reserves', () => {
		expect(() => bytes('MOVL', 'R0', '#1')).toThrow(/cannot write/)
		expect(() => bytes('MOVAL', 'R1', 'R0')).toThrow(/address/)
		expect(() => bytes('MOVQ', 'SP', 'R0')).toThrow(/cannot hold/)
		expect(() => bytes('MOVL', '(PC)+', 'R0')).toThrow(/immediate/)
		expect(() => bytes('MOVL', 'R1[R2]', 'R0')).toThrow(/Index mode/)
		expect(() => bytes('MOVL', 'S^#64', 'R0')).toThrow(/short literal/)
		expect(() => bytes('MOVL', 'B^200(R1)', 'R0')).toThrow(/does not fit/)
		expect(() => bytes('BRB', 'FAR')).toThrow(/outside the byte displacement/)
		expect(() => bytes('MOVL', '#1.5', 'R0')).toThrow(/integer operand/)
		expect(() => bytes('MOVL', 'R0')).toThrow(/expects 2 operands/)
	})

	it('parses every general addressing mode', () => {
		expect(parseOperand('@B^-8(fp)[r3]')).toMatchObject({ kind: 'displacement', register: 13, expression: '-8', forced: 1, deferred: true, index: 3 })
		expect(parseOperand('@(R5)+')).toMatchObject({ kind: 'autoinc', register: 5, deferred: true })
		expect(parseOperand('S^#7')).toMatchObject({ kind: 'immediate', forced: 0, expression: '7' })
		expect(parseOperand('@#1000')).toMatchObject({ kind: 'absolute', expression: '1000' })
		expect(parseOperand('@R2')).toMatchObject({ kind: 'deferred', register: 2 })
	})

	it('decodes the bytes it encodes back to VAX MACRO text', () => {
		const memory = new Uint8Array(0x1100)
		const cases: [string, string[], string][] = [
			['MOVL', ['@B^-8(FP)[R3]', '(R1)+'], 'MOVL @B^-8(FP)[R3], (R1)+'],
			['ADDL3', ['#3', 'I^#100', '-(SP)'], 'ADDL3 S^#3, I^#100, -(SP)'],
			['MOVF', ['#1.5', 'R0'], 'MOVF S^#1.5, R0'],
			['MOVL', ['HERE', 'R0'], 'MOVL B^^X1000, R0'],
			['BRB', ['HERE'], 'BRB ^X1000'],
			['ADDG2', ['R0', 'R2'], 'ADDG2 R0, R2'],
		]
		for (const [mnemonic, operands, text] of cases) {
			const encoded = bytes(mnemonic, ...operands)
			memory.fill(0).set(encoded, 0x1000)
			const instruction = decode(memory, 0x1000)
			expect(instruction.text).toBe(text)
			expect(instruction.size).toBe(encoded.length)
		}
	})
})
