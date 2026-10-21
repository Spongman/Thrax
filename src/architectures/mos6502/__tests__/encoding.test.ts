import { describe, expect, it } from 'vitest'
import { assembleMos6502 } from '../assembler'
import { disassemble } from '../disassemble'
import { MNEMONICS, OPCODE_INSN } from '../isa'

/** Assembles `code` at $0600 and returns its bytes, failing on any diagnostic. */
function bytes(code: string): number[] {
	const { image, diagnostics } = assembleMos6502({ name: 'test.s', code: `.org $0600\n${code}\n` })
	expect(diagnostics).toEqual([])
	const section = image!.sections.find((candidate) => candidate.address === 0x0600)!
	return [...section.bytes]
}

/** Every documented opcode, from the MOS programming manual's tables. */
const LISTING: readonly [string, number[]][] = [
	['ADC #$44', [0x69, 0x44]], ['ADC $44', [0x65, 0x44]], ['ADC $44,X', [0x75, 0x44]], ['ADC $4400', [0x6D, 0x00, 0x44]],
	['ADC $4400,X', [0x7D, 0x00, 0x44]], ['ADC $4400,Y', [0x79, 0x00, 0x44]], ['ADC ($44,X)', [0x61, 0x44]], ['ADC ($44),Y', [0x71, 0x44]],
	['AND #$44', [0x29, 0x44]], ['AND $44', [0x25, 0x44]], ['AND $44,X', [0x35, 0x44]], ['AND $4400', [0x2D, 0x00, 0x44]],
	['AND $4400,X', [0x3D, 0x00, 0x44]], ['AND $4400,Y', [0x39, 0x00, 0x44]], ['AND ($44,X)', [0x21, 0x44]], ['AND ($44),Y', [0x31, 0x44]],
	['ASL A', [0x0A]], ['ASL $44', [0x06, 0x44]], ['ASL $44,X', [0x16, 0x44]], ['ASL $4400', [0x0E, 0x00, 0x44]], ['ASL $4400,X', [0x1E, 0x00, 0x44]],
	['BIT $44', [0x24, 0x44]], ['BIT $4400', [0x2C, 0x00, 0x44]],
	['BPL *', [0x10, 0xFE]], ['BMI *', [0x30, 0xFE]], ['BVC *', [0x50, 0xFE]], ['BVS *', [0x70, 0xFE]],
	['BCC *', [0x90, 0xFE]], ['BCS *', [0xB0, 0xFE]], ['BNE *', [0xD0, 0xFE]], ['BEQ *', [0xF0, 0xFE]],
	['BRK', [0x00]],
	['CMP #$44', [0xC9, 0x44]], ['CMP $44', [0xC5, 0x44]], ['CMP $44,X', [0xD5, 0x44]], ['CMP $4400', [0xCD, 0x00, 0x44]],
	['CMP $4400,X', [0xDD, 0x00, 0x44]], ['CMP $4400,Y', [0xD9, 0x00, 0x44]], ['CMP ($44,X)', [0xC1, 0x44]], ['CMP ($44),Y', [0xD1, 0x44]],
	['CPX #$44', [0xE0, 0x44]], ['CPX $44', [0xE4, 0x44]], ['CPX $4400', [0xEC, 0x00, 0x44]],
	['CPY #$44', [0xC0, 0x44]], ['CPY $44', [0xC4, 0x44]], ['CPY $4400', [0xCC, 0x00, 0x44]],
	['DEC $44', [0xC6, 0x44]], ['DEC $44,X', [0xD6, 0x44]], ['DEC $4400', [0xCE, 0x00, 0x44]], ['DEC $4400,X', [0xDE, 0x00, 0x44]],
	['EOR #$44', [0x49, 0x44]], ['EOR $44', [0x45, 0x44]], ['EOR $44,X', [0x55, 0x44]], ['EOR $4400', [0x4D, 0x00, 0x44]],
	['EOR $4400,X', [0x5D, 0x00, 0x44]], ['EOR $4400,Y', [0x59, 0x00, 0x44]], ['EOR ($44,X)', [0x41, 0x44]], ['EOR ($44),Y', [0x51, 0x44]],
	['CLC', [0x18]], ['SEC', [0x38]], ['CLI', [0x58]], ['SEI', [0x78]], ['CLV', [0xB8]], ['CLD', [0xD8]], ['SED', [0xF8]],
	['INC $44', [0xE6, 0x44]], ['INC $44,X', [0xF6, 0x44]], ['INC $4400', [0xEE, 0x00, 0x44]], ['INC $4400,X', [0xFE, 0x00, 0x44]],
	['JMP $4400', [0x4C, 0x00, 0x44]], ['JMP ($4400)', [0x6C, 0x00, 0x44]],
	['JSR $4400', [0x20, 0x00, 0x44]],
	['LDA #$44', [0xA9, 0x44]], ['LDA $44', [0xA5, 0x44]], ['LDA $44,X', [0xB5, 0x44]], ['LDA $4400', [0xAD, 0x00, 0x44]],
	['LDA $4400,X', [0xBD, 0x00, 0x44]], ['LDA $4400,Y', [0xB9, 0x00, 0x44]], ['LDA ($44,X)', [0xA1, 0x44]], ['LDA ($44),Y', [0xB1, 0x44]],
	['LDX #$44', [0xA2, 0x44]], ['LDX $44', [0xA6, 0x44]], ['LDX $44,Y', [0xB6, 0x44]], ['LDX $4400', [0xAE, 0x00, 0x44]], ['LDX $4400,Y', [0xBE, 0x00, 0x44]],
	['LDY #$44', [0xA0, 0x44]], ['LDY $44', [0xA4, 0x44]], ['LDY $44,X', [0xB4, 0x44]], ['LDY $4400', [0xAC, 0x00, 0x44]], ['LDY $4400,X', [0xBC, 0x00, 0x44]],
	['LSR A', [0x4A]], ['LSR $44', [0x46, 0x44]], ['LSR $44,X', [0x56, 0x44]], ['LSR $4400', [0x4E, 0x00, 0x44]], ['LSR $4400,X', [0x5E, 0x00, 0x44]],
	['NOP', [0xEA]],
	['ORA #$44', [0x09, 0x44]], ['ORA $44', [0x05, 0x44]], ['ORA $44,X', [0x15, 0x44]], ['ORA $4400', [0x0D, 0x00, 0x44]],
	['ORA $4400,X', [0x1D, 0x00, 0x44]], ['ORA $4400,Y', [0x19, 0x00, 0x44]], ['ORA ($44,X)', [0x01, 0x44]], ['ORA ($44),Y', [0x11, 0x44]],
	['TAX', [0xAA]], ['TXA', [0x8A]], ['DEX', [0xCA]], ['INX', [0xE8]], ['TAY', [0xA8]], ['TYA', [0x98]], ['DEY', [0x88]], ['INY', [0xC8]],
	['ROL A', [0x2A]], ['ROL $44', [0x26, 0x44]], ['ROL $44,X', [0x36, 0x44]], ['ROL $4400', [0x2E, 0x00, 0x44]], ['ROL $4400,X', [0x3E, 0x00, 0x44]],
	['ROR A', [0x6A]], ['ROR $44', [0x66, 0x44]], ['ROR $44,X', [0x76, 0x44]], ['ROR $4400', [0x6E, 0x00, 0x44]], ['ROR $4400,X', [0x7E, 0x00, 0x44]],
	['RTI', [0x40]], ['RTS', [0x60]],
	['SBC #$44', [0xE9, 0x44]], ['SBC $44', [0xE5, 0x44]], ['SBC $44,X', [0xF5, 0x44]], ['SBC $4400', [0xED, 0x00, 0x44]],
	['SBC $4400,X', [0xFD, 0x00, 0x44]], ['SBC $4400,Y', [0xF9, 0x00, 0x44]], ['SBC ($44,X)', [0xE1, 0x44]], ['SBC ($44),Y', [0xF1, 0x44]],
	['STA $44', [0x85, 0x44]], ['STA $44,X', [0x95, 0x44]], ['STA $4400', [0x8D, 0x00, 0x44]], ['STA $4400,X', [0x9D, 0x00, 0x44]],
	['STA $4400,Y', [0x99, 0x00, 0x44]], ['STA ($44,X)', [0x81, 0x44]], ['STA ($44),Y', [0x91, 0x44]],
	['TXS', [0x9A]], ['TSX', [0xBA]], ['PHA', [0x48]], ['PLA', [0x68]], ['PHP', [0x08]], ['PLP', [0x28]],
	['STX $44', [0x86, 0x44]], ['STX $44,Y', [0x96, 0x44]], ['STX $4400', [0x8E, 0x00, 0x44]],
	['STY $44', [0x84, 0x44]], ['STY $44,X', [0x94, 0x44]], ['STY $4400', [0x8C, 0x00, 0x44]],
]

describe('6502 encodings', () => {
	it('lists every documented opcode once', () => {
		const opcodes = LISTING.map(([, encoded]) => encoded[0])
		expect(new Set(opcodes).size).toBe(151)
		expect(OPCODE_INSN.filter((insn) => insn >= 0).length).toBe(256)
		for (const opcode of opcodes) expect(OPCODE_INSN[opcode]).toBeGreaterThanOrEqual(0)
		expect(MNEMONICS.length).toBe(75)
	})

	it.each(LISTING)('assembles %s', (source, expected) => {
		expect(bytes(source)).toEqual(expected)
		expect(bytes(source.toLowerCase())).toEqual(expected)
	})

	it.each(LISTING)('disassembles %s', (source, expected) => {
		const text = disassemble(expected, 0x0600)
		expect(text).toBe(source.replace('*', '$0600'))
	})

	it('follows the group-one pattern aaabbb01 for the eight ALU instructions', () => {
		const modes = ['($44,X)', '$44', '#$44', '$4400', '($44),Y', '$44,X', '$4400,Y', '$4400,X']
		const names = ['ORA', 'AND', 'EOR', 'ADC', 'STA', 'LDA', 'CMP', 'SBC']
		names.forEach((name, aaa) => modes.forEach((mode, bbb) => {
			if (name === 'STA' && mode === '#$44') return
			expect(bytes(`${name} ${mode}`)[0]).toBe((aaa << 5) | (bbb << 2) | 1)
		}))
	})
})

describe('operand sizes and syntax', () => {
	it('takes zero page for a known small value and absolute for a forward reference', () => {
		expect(bytes('zp = $10\nlda zp\nlda later\nlater: nop')).toEqual([0xA5, 0x10, 0xAD, 0x05, 0x06, 0xEA])
		// A label already passed in a low page is known, so it takes zero page.
		const { image } = assembleMos6502({ name: 't.s', code: '.org $20\nvar: .byte 0\n.org $0600\nlda var\nlda var,x\nlda var,y\n' })
		expect([...image!.sections.find((section) => section.address === 0x0600)!.bytes]).toEqual([0xA5, 0x20, 0xB5, 0x20, 0xB9, 0x20, 0x00])
	})

	it('forces a size with a: and z:', () => {
		expect(bytes('lda a:$10\nsta z:later\nlater = $44')).toEqual([0xAD, 0x10, 0x00, 0x85, 0x44])
	})

	it('reads the accumulator operand with or without A', () => {
		expect(bytes('asl\nlsr a\nrol A\nror')).toEqual([0x0A, 0x4A, 0x2A, 0x6A])
	})

	it('reads immediates in hex, binary, decimal, characters and byte selectors', () => {
		const code = 'lda #$10\nlda #%1010\nlda #10\nlda #\'A\'\nlda #<label\nlda #>label\nlda #-1\nlabel = $1234'
		expect(bytes(code)).toEqual([0xA9, 0x10, 0xA9, 0x0A, 0xA9, 0x0A, 0xA9, 0x41, 0xA9, 0x34, 0xA9, 0x12, 0xA9, 0xFF])
	})

	it('evaluates * and ca65 precedence', () => {
		expect(bytes('.word *, *+2*3, (1+2)*3, 1+2*3, 7 & 3 | 8\njmp *')).toEqual([0x00, 0x06, 0x08, 0x06, 9, 0, 7, 0, 11, 0, 0x4C, 0x0A, 0x06])
	})

	it('lays out data directives', () => {
		const code = '.byte 1, "hi", $FF\n.db -1\n.word $1234\n.dw label\n.ascii "ab"\n.asciiz "c"\n.res 2\n.ds 2, $EA\nlabel:'
		expect(bytes(code)).toEqual([1, 0x68, 0x69, 0xFF, 0xFF, 0x34, 0x12, 0x11, 0x06, 0x61, 0x62, 0x63, 0, 0, 0, 0xEA, 0xEA])
	})

	it('sets symbols with =, .equ, equ and .set', () => {
		expect(bytes('one = 1\ntwo .equ 2\nthree equ 3\n.set four, 4\n.byte one, two, three, four')).toEqual([1, 2, 3, 4])
	})

	it('moves the origin with .org and * =', () => {
		const { image } = assembleMos6502({ name: 't.s', code: '* = $0300\nnop\n.org $0400\nnop\n' })
		expect(image!.sections.map((section) => section.address)).toEqual([0x0300, 0x0400, 0xFFFC])
	})

	it('expands macros, with labels local to each expansion', () => {
		const code = '.macro delay count\n\tldx #count\n@loop: dex\n\tbne @loop\n.endmacro\nstart:\n\tdelay 3\n\tdelay 4\n'
		expect(bytes(code)).toEqual([0xA2, 3, 0xCA, 0xD0, 0xFD, 0xA2, 4, 0xCA, 0xD0, 0xFD])
	})

	it('scopes @local labels to the label before them', () => {
		expect(bytes('first:\n@loop: bne @loop\nsecond:\n@loop: bne @loop\n')).toEqual([0xD0, 0xFE, 0xD0, 0xFE])
	})

	it('includes other files', () => {
		const { image, diagnostics } = assembleMos6502(
			{ name: 'main.s', code: '.include "lib/consts.inc"\nlda #VALUE\n' },
			{ files: [{ name: 'lib/consts.inc', code: 'VALUE = 7\n' }] },
		)
		expect(diagnostics).toEqual([])
		expect([...image!.sections[0].bytes]).toEqual([0xA9, 7])
	})

	it('maps each instruction to its line, and a macro\'s to the invoking line', () => {
		const { image } = assembleMos6502({ name: 't.s', code: '.macro two\nnop\nnop\n.endmacro\nlda #1\ntwo\n.byte 9\n' })
		expect(image!.sourceMappings.map(({ address, byteLength, kind, source }) => [address, byteLength, kind, source.line])).toEqual([
			[0x600, 2, 'instruction', 5], [0x602, 1, 'instruction', 6], [0x603, 1, 'instruction', 6], [0x604, 1, 'data', 7],
		])
	})
})

describe('vectors and entry', () => {
	it('points RESET at the first instruction when the program sets no vector', () => {
		const { image } = assembleMos6502({ name: 't.s', code: '.org $0200\ndata: .byte 1\n.org $0800\nstart: nop\n' })
		expect(image!.entryAddress).toBe(0x0800)
		expect(image!.sections[image!.sections.length - 1]).toEqual({ address: 0xFFFC, bytes: Uint8Array.of(0x00, 0x08) })
	})

	it('keeps vectors the program defines', () => {
		const code = '.org $8000\nreset: nop\nnmi: rti\nirq: rti\n.org $FFFA\n.word nmi, reset, irq\n'
		const { image } = assembleMos6502({ name: 't.s', code })
		expect(image!.entryAddress).toBe(0x8000)
		expect(image!.sections.map((section) => section.address)).toEqual([0x8000, 0xFFFA])
	})
})

describe('assembly diagnostics', () => {
	const errors = (code: string) => assembleMos6502({ name: 't.s', code }).diagnostics.map(({ message, line }) => ({ message, line }))

	it('reports a branch out of range with its line', () => {
		const [error] = errors('start: nop\n.res 200\nbne start\n')
		expect(error.line).toBe(3)
		expect(error.message).toMatch(/^Branch out of range: \$0600 is -203 bytes away/)
	})

	it('reports modes an instruction lacks', () => {
		expect(errors('nop\nstx $1234,y\n')[0]).toMatchObject({ line: 2, message: expect.stringContaining('STX has no absolute,Y mode') })
		expect(errors('lda ($10)\n')[0].message).toContain('no indirect mode')
		expect(errors('jmp #3\n')[0].message).toContain('JMP has no immediate mode')
		expect(errors('lda\n')[0].message).toContain('LDA needs an operand')
	})

	it('reports values out of range', () => {
		expect(errors('lda #$100\n')[0].message).toContain('does not fit in a byte')
		expect(errors('lda z:$1234\n')[0].message).toContain('outside the zero page')
		expect(errors('lda ($1234),y\n')[0].message).toContain('outside the zero page')
		expect(errors('.byte 256\n')[0].message).toContain('does not fit')
	})

	it('reports undefined symbols, unknown directives and macros', () => {
		expect(errors('lda nowhere\n')[0]).toMatchObject({ line: 1, message: expect.stringContaining("'nowhere' is undefined") })
		expect(errors('.bogus 1\n')[0].message).toContain("Unrecognised directive '.bogus'")
		expect(errors('frobnicate 1\n')[0].message).toContain("Macro 'frobnicate' has not been defined")
		expect(errors('x: nop\n')[0].message).toContain('reserved')
	})
})
