import { describe, expect, it } from 'vitest'
import { assembleZ80 } from '../asm'
import { disassembleBytes } from '../disassemble'

/** The bytes one line assembles to at address 0x100. */
function bytesOf(line: string): number[] {
	const { image, diagnostics } = assembleZ80({ name: 'test.z80', code: `\torg $100\n\t${line}\n` })
	expect(diagnostics, line).toEqual([])
	return Array.from(image!.sections[0].bytes)
}

const errorsOf = (code: string) => assembleZ80({ name: 'test.z80', code }).diagnostics

/**
 * Expected bytes from the Zilog Z80 CPU User Manual (UM0080) opcode tables,
 * checked by hand, not produced by this assembler.
 */
const ENCODINGS: [string, number[]][] = [
	['nop', [0x00]],
	['ld a,5', [0x3E, 0x05]],
	['ld b,c', [0x41]],
	['ld (hl),a', [0x77]],
	['ld a,(hl)', [0x7E]],
	['ld (hl),$99', [0x36, 0x99]],
	['ld hl,$1234', [0x21, 0x34, 0x12]],
	['ld sp,$ff00', [0x31, 0x00, 0xFF]],
	['ld ix,$1234', [0xDD, 0x21, 0x34, 0x12]],
	['ld iy,$1234', [0xFD, 0x21, 0x34, 0x12]],
	['ld a,(ix+5)', [0xDD, 0x7E, 0x05]],
	['ld (iy-2),b', [0xFD, 0x70, 0xFE]],
	['ld (ix+3),$42', [0xDD, 0x36, 0x03, 0x42]],
	['ld h,(ix+1)', [0xDD, 0x66, 0x01]],
	['ld a,($8000)', [0x3A, 0x00, 0x80]],
	['ld ($8000),a', [0x32, 0x00, 0x80]],
	['ld a,(bc)', [0x0A]],
	['ld (de),a', [0x12]],
	['ld hl,($4000)', [0x2A, 0x00, 0x40]],
	['ld ($4000),hl', [0x22, 0x00, 0x40]],
	['ld bc,($4000)', [0xED, 0x4B, 0x00, 0x40]],
	['ld ($4000),de', [0xED, 0x53, 0x00, 0x40]],
	['ld sp,($4000)', [0xED, 0x7B, 0x00, 0x40]],
	['ld ix,($4000)', [0xDD, 0x2A, 0x00, 0x40]],
	['ld ($4000),iy', [0xFD, 0x22, 0x00, 0x40]],
	['ld sp,hl', [0xF9]],
	['ld sp,ix', [0xDD, 0xF9]],
	['ld a,i', [0xED, 0x57]],
	['ld a,r', [0xED, 0x5F]],
	['ld i,a', [0xED, 0x47]],
	['ld r,a', [0xED, 0x4F]],
	['ld ixh,a', [0xDD, 0x67]],
	['ld a,iyl', [0xFD, 0x7D]],
	['ld ixh,ixl', [0xDD, 0x65]],
	['ld iyl,7', [0xFD, 0x2E, 0x07]],
	['push af', [0xF5]],
	['pop ix', [0xDD, 0xE1]],
	['push iy', [0xFD, 0xE5]],
	['pop bc', [0xC1]],
	['ex af,af\'', [0x08]],
	['ex de,hl', [0xEB]],
	['ex (sp),hl', [0xE3]],
	['ex (sp),ix', [0xDD, 0xE3]],
	['exx', [0xD9]],
	['add a,b', [0x80]],
	['adc a,$10', [0xCE, 0x10]],
	['sub 5', [0xD6, 0x05]],
	['sbc a,(hl)', [0x9E]],
	['and (ix+1)', [0xDD, 0xA6, 0x01]],
	['xor a', [0xAF]],
	['or c', [0xB1]],
	['cp $0a', [0xFE, 0x0A]],
	['add a,ixh', [0xDD, 0x84]],
	['add hl,de', [0x19]],
	['add ix,sp', [0xDD, 0x39]],
	['add iy,iy', [0xFD, 0x29]],
	['adc hl,bc', [0xED, 0x4A]],
	['sbc hl,de', [0xED, 0x52]],
	['sbc hl,sp', [0xED, 0x72]],
	['inc a', [0x3C]],
	['dec (hl)', [0x35]],
	['inc (iy+4)', [0xFD, 0x34, 0x04]],
	['inc bc', [0x03]],
	['dec sp', [0x3B]],
	['inc ix', [0xDD, 0x23]],
	['dec ixl', [0xDD, 0x2D]],
	['rlc b', [0xCB, 0x00]],
	['rr (hl)', [0xCB, 0x1E]],
	['sla (ix+2)', [0xDD, 0xCB, 0x02, 0x26]],
	['srl a', [0xCB, 0x3F]],
	['sll d', [0xCB, 0x32]],
	['bit 7,a', [0xCB, 0x7F]],
	['res 0,(hl)', [0xCB, 0x86]],
	['set 3,(iy-1)', [0xFD, 0xCB, 0xFF, 0xDE]],
	['bit 2,(ix+0)', [0xDD, 0xCB, 0x00, 0x56]],
	['res 1,(ix+5),a', [0xDD, 0xCB, 0x05, 0x8F]],
	['rlc (iy+1),b', [0xFD, 0xCB, 0x01, 0x00]],
	['jp $1234', [0xC3, 0x34, 0x12]],
	['jp nz,$1234', [0xC2, 0x34, 0x12]],
	['jp m,0', [0xFA, 0x00, 0x00]],
	['jp c,$0', [0xDA, 0x00, 0x00]],
	['jp (hl)', [0xE9]],
	['jp (ix)', [0xDD, 0xE9]],
	['jp (iy)', [0xFD, 0xE9]],
	['jr $', [0x18, 0xFE]],
	['jr nz,$+2', [0x20, 0x00]],
	['jr c,$+129', [0x38, 0x7F]],
	['djnz $', [0x10, 0xFE]],
	['call $1234', [0xCD, 0x34, 0x12]],
	['call z,$1234', [0xCC, 0x34, 0x12]],
	['call pe,$1234', [0xEC, 0x34, 0x12]],
	['ret', [0xC9]],
	['ret nc', [0xD0]],
	['ret p', [0xF0]],
	['rst $38', [0xFF]],
	['rst 8', [0xCF]],
	['rst 0', [0xC7]],
	['im 0', [0xED, 0x46]],
	['im 1', [0xED, 0x56]],
	['im 2', [0xED, 0x5E]],
	['in a,($10)', [0xDB, 0x10]],
	['in b,(c)', [0xED, 0x40]],
	['in f,(c)', [0xED, 0x70]],
	['out ($fe),a', [0xD3, 0xFE]],
	['out (c),e', [0xED, 0x59]],
	['out (c),0', [0xED, 0x71]],
	['ldir', [0xED, 0xB0]],
	['lddr', [0xED, 0xB8]],
	['cpir', [0xED, 0xB1]],
	['cpdr', [0xED, 0xB9]],
	['inir', [0xED, 0xB2]],
	['otir', [0xED, 0xB3]],
	['indr', [0xED, 0xBA]],
	['otdr', [0xED, 0xBB]],
	['ldi', [0xED, 0xA0]],
	['cpd', [0xED, 0xA9]],
	['neg', [0xED, 0x44]],
	['reti', [0xED, 0x4D]],
	['retn', [0xED, 0x45]],
	['rld', [0xED, 0x6F]],
	['rrd', [0xED, 0x67]],
	['daa', [0x27]],
	['cpl', [0x2F]],
	['scf', [0x37]],
	['ccf', [0x3F]],
	['rlca', [0x07]],
	['rra', [0x1F]],
	['halt', [0x76]],
	['di', [0xF3]],
	['ei', [0xFB]],
]

describe('Z80 encodings', () => {
	it.each(ENCODINGS)('%s', (line, bytes) => {
		expect(bytesOf(line)).toEqual(bytes)
	})

	it('reads upper and lower case alike', () => {
		expect(bytesOf('LD A,(IX+5)')).toEqual(bytesOf('ld a,(ix+5)'))
	})

	it('disassembles each encoding back to the same bytes', () => {
		for (const [line, bytes] of ENCODINGS) {
			const { text, length } = disassembleBytes(bytes, 0x100)
			expect(length, line).toBe(bytes.length)
			expect(bytesOf(text), `${line} -> ${text}`).toEqual(bytes)
		}
	})
})

describe('Z80 numbers and expressions', () => {
	it.each([
		['$FF', 0xFF], ['#ff', 0xFF], ['0xFF', 0xFF], ['0FFh', 0xFF], ['%1010', 10], ['0b1010', 10], ['1010b', 10],
		['17o', 15], ['255', 255], ['\'A\'', 65], ['"A"', 65], ['LOW($1234)', 0x34], ['HIGH($1234)', 0x12],
		['3 + 4 * 2', 11], ['(3 + 4) * 2', 14], ['7 % 4', 3], ['1 << 4', 16], ['$F0 | $0F', 0xFF], ['5 > 3', 1], ['-1 & $FF', 0xFF],
	])('%s', (expression, value) => {
		expect(bytesOf(`db ${expression}`)).toEqual([value])
	})

	it('takes $ as the current address', () => {
		expect(bytesOf('dw $')).toEqual([0x00, 0x01])
	})
})

describe('Z80 directives', () => {
	const assemble = (code: string) => {
		const result = assembleZ80({ name: 'test.z80', code })
		expect(result.diagnostics).toEqual([])
		return result
	}

	it('lays out data, labels and equates', () => {
		const { image, values } = assemble([
			'COUNT equ 3',
			'size = 2',
			'start:',
			'\tdb 1, "hi", COUNT',
			'\tdefw start, $1234',
			'\tds size, $AA',
			'\tdefs 2',
			'last\tdb 0',
		].join('\n'))
		expect(Array.from(image!.sections[0].bytes)).toEqual([1, 0x68, 0x69, 3, 0x00, 0x00, 0x34, 0x12, 0xAA, 0xAA, 0, 0, 0])
		expect(values.get('last')).toBe(12)
		expect(values.get('COUNT')).toBe(3)
	})

	it('places code with ORG and aligns', () => {
		const { image } = assemble('\torg $8000\n\tnop\n\talign 4\n\tdb 7\n')
		expect(image!.sections[0].address).toBe(0x8000)
		expect(Array.from(image!.sections[0].bytes)).toEqual([0, 0, 0, 0, 7])
	})

	it('resolves forward references', () => {
		const { image } = assemble('\tjp later\n\tjr later\nlater:\tret\n')
		expect(Array.from(image!.sections[0].bytes)).toEqual([0xC3, 0x05, 0x00, 0x18, 0x00, 0xC9])
	})

	it('takes local labels under the global before them', () => {
		const { values } = assemble('one:\n.loop:\tdjnz .loop\ntwo:\n.loop:\tdjnz .loop\n')
		expect(values.get('one.loop')).toBe(0)
		expect(values.get('two.loop')).toBe(2)
	})

	it('expands macros with register and value parameters', () => {
		const { image } = assemble([
			'load macro reg, value',
			'\tld reg, value',
			'\tendm',
			'\tMACRO twice op',
			'\top',
			'\top',
			'\tENDM',
			'\tload b, 5',
			'\ttwice inc a',
			'\tload a, LOW($1234)',
		].join('\n'))
		expect(Array.from(image!.sections[0].bytes)).toEqual([0x06, 0x05, 0x3C, 0x3C, 0x3E, 0x34])
	})

	it('gives each macro expansion its own dot labels', () => {
		const { image } = assemble('wait macro\n.spin:\tdjnz .spin\n\tendm\n\twait\n\twait\n')
		expect(Array.from(image!.sections[0].bytes)).toEqual([0x10, 0xFE, 0x10, 0xFE])
	})

	it('maps a macro expansion to the line that invoked it', () => {
		const { image } = assemble('twice macro\n\tnop\n\tnop\n\tendm\n\ttwice\n')
		const lines = image!.sourceMappings.map((mapping) => mapping.source.line)
		expect(lines).toEqual([5, 5])
		expect(image!.sourceMappings[0].expansion[0].macro).toBe('twice')
	})

	it('includes other files', () => {
		const { image } = assembleZ80({ name: 'main.z80', code: '\tinclude "lib.z80"\n\tret\n' }, { files: [{ name: 'lib.z80', code: '\tnop\n' }] })
		expect(Array.from(image!.sections[0].bytes)).toEqual([0x00, 0xC9])
	})

	it('stops at END', () => {
		const { image } = assemble('\tnop\n\tend\n\tthis is not assembled\n')
		expect(Array.from(image!.sections[0].bytes)).toEqual([0])
	})
})

describe('Z80 diagnostics', () => {
	it('reports a relative jump out of range on its line', () => {
		const [error] = errorsOf('\tjr far\n\tds 200\nfar:\tret\n')
		expect(error.message).toMatch(/out of range/)
		expect(error.line).toBe(1)
	})

	it('reports invalid operand combinations', () => {
		for (const line of ['ld (hl),(hl)', 'ld ixh,h', 'ld (ix+1),ixh', 'add ix,hl', 'jr pe,$', 'ex bc,de', 'push sp', 'inc af', 'im 3', 'rst 7', 'bit 8,a', 'ld a,(ix+200)', 'ld a,256']) {
			const errors = errorsOf(`\tnop\n\t${line}\n`)
			expect(errors.length, line).toBeGreaterThan(0)
			expect(errors[0].line, line).toBe(2)
		}
	})

	it('reports unknown instructions, undefined symbols and duplicate labels', () => {
		expect(errorsOf('\tfrob a\n')[0].message).toMatch(/Unknown instruction/)
		expect(errorsOf('\tjp nowhere\n')[0].message).toMatch(/nowhere/)
		expect(errorsOf('a1:\na1:\n')[0].message).toMatch(/already defined/)
		expect(errorsOf('\tld a,b+1\n')[0].message).toMatch(/Register/)
	})
})
