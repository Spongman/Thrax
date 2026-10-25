import { describe, expect, it } from 'vitest'
import { encodeAbsolute } from '../assembler'
import { assemble, imageBytes, line, MODEL_30, MODEL_50, S370 } from './helpers'

const hex = (bytes: readonly number[]) => bytes.map(byte => byte.toString(16).toUpperCase().padStart(2, '0')).join('')

// Expected bytes follow the GA22-6821 formats (RR op|R1R2, RX op|R1X2|B2D2,
// RS op|R1R3|B2D2, SI op|I2|B1D1, SS op|L|B1D1|B2D2), and match the object code
// of the standard linkage printed in OS/360 assembler listings
// (STM 14,12,12(13) = 90ECD00C, BALR 12,0 = 05C0, BR 14 = 07FE).
describe('System/360 instruction formats', () => {
	it.each([
		['LR', ['3', '4'], '1834'],
		['SR', ['15', '15'], '1BFF'],
		['BALR', ['12', '0'], '05C0'],
		['BR', ['14'], '07FE'],
		['BER', ['14'], '078E'],
		['NOPR', ['0'], '0700'],
		['SVC', ['35'], '0A23'],
		['SPM', ['1'], '0410'],
		['L', ['3', '16(4,12)'], '5834C010'],
		['LA', ['1', '1(,1)'], '41101001'],
		['ST', ['1', '4095(0,15)'], '5010FFFF'],
		['LE', ['0', '0(1)'], '78010000'],
		['B', ['8(,12)'], '47F0C008'],
		['BNE', ['0(15)'], '477F0000'],
		['STM', ['14', '12', '12(13)'], '90ECD00C'],
		['LM', ['14', '12', '12(13)'], '98ECD00C'],
		['SLL', ['3', '4'], '89300004'],
		['SRDA', ['2', '32'], '8E200020'],
		['MVI', ['0(12)', "C' '"], '9240C000'],
		['CLI', ['4(2)', "X'FF'"], '95FF2004'],
		['TS', ['0(5)'], '93005000'],
		['MVC', ['0(8,1)', '0(2)'], 'D20710002000'],
		['AP', ['0(3,1)', '0(2,2)'], 'FA2110002000'],
		['ICM', ['1', '7', '0(2)'], 'BF172000'],
		['SRP', ['0(3,1)', '62(0)', '5'], 'F0251000003E'],
	] as const)('encodes %s %j', (name, operands, expected) => {
		expect(hex(encodeAbsolute(name, operands, Number))).toBe(expected)
	})

	it('rejects bad registers, displacements and lengths', () => {
		expect(() => encodeAbsolute('LR', ['16', '1'], Number)).toThrow(/outside 0-15/)
		expect(() => encodeAbsolute('L', ['1', '4096(0,12)'], Number)).toThrow(/Displacement 4096/)
		expect(() => encodeAbsolute('MVC', ['0(257,1)', '0(2)'], Number)).toThrow(/Length 257/)
		expect(() => encodeAbsolute('AP', ['0(17,1)', '0(2,2)'], Number)).toThrow(/Length 17/)
		expect(() => encodeAbsolute('SVC', ['256'], Number)).toThrow(/SVC number/)
	})
})

describe('IBM assembler source', () => {
	it('resolves symbolic operands through USING', async () => {
		const code = [
			line('CSECT', '', 'T'),
			line('BALR', '12,0'),            // 1000
			line('USING', '*,12'),           // base 1002
			line('L', '3,DATA'),             // 1002: DATA aligns to 100C, displacement A
			line('L', '4,DATA(5)'),          // 1006: indexed by R5
			line('DC', "F'7'", 'DATA'),
			line('END', 'T'),
		].join('\n')
		const { program } = await assemble(code)
		expect(program.diagnostics).toEqual([])
		expect(hex(imageBytes(program, 0x1000, 10))).toBe('05C0' + '5830C00A' + '5845C00A')
		expect(hex(imageBytes(program, 0x100c, 4))).toBe('00000007')
		expect(program.labels.get('DATA')).toBe(0x100c)
	})

	it('prefers the USING with the smallest displacement and the highest register on a tie', async () => {
		const code = [
			line('CSECT', '', 'T'),
			line('BALR', '12,0'),
			line('USING', '*,12'),
			line('LA', '11,HERE'),
			line('USING', 'HERE,11'),
			line('USING', 'HERE,10'),
			line('L', '1,HERE+4', 'HERE'),
			line('DROP', '10,11'),
			line('L', '1,HERE+4'),
			line('END'),
		].join('\n')
		const { program } = await assemble(code)
		expect(program.diagnostics).toEqual([])
		// HERE = 1006; with R10/R11 dropped, R12 (base 1002) gives displacement 8.
		expect(hex(imageBytes(program, 0x1006, 8))).toBe('5810B004' + '5810C008')
	})

	it('reports an operand no USING covers', async () => {
		const { program } = await assemble([line('CSECT', '', 'T'), line('L', '1,DATA'), line('DC', "F'1'", 'DATA')].join('\n'))
		expect(program.diagnostics).toMatchObject([{ severity: 'error', message: 'No active USING for operand', line: 2 }])
	})

	it('covers 8192 bytes with a two-register USING', async () => {
		const code = [
			line('CSECT', '', 'T'),
			line('BALR', '12,0'),
			line('USING', '*,12,11'),
			line('L', '1,FAR'),
			line('DS', 'XL5000'),
			line('DC', "F'1'", 'FAR'),
		].join('\n')
		const { program } = await assemble(code)
		expect(program.diagnostics).toEqual([])
		// FAR = 1002 + 4 + 5000 aligned = 0x2390 -> R11 base 0x2002, displacement 0x38E.
		expect(program.labels.get('FAR')).toBe(0x2390)
		expect(hex(imageBytes(program, 0x1002, 4))).toBe('5810B38E')
	})

	it('maps a DSECT through its own USING and takes implicit lengths from the length attribute', async () => {
		const code = [
			line('CSECT', '', 'T'),
			line('BALR', '12,0'),
			line('USING', '*,12'),
			line('USING', 'REC,5'),
			line('MVC', 'NAME,BLANKS'),     // L'NAME = 8
			line('MVC', 'NAME(2),BLANKS'),
			line('CLC', 'CODE,=C\'AB\''),
			line('BR', '14'),
			line('DC', "CL8' '", 'BLANKS'),
			line('LTORG'),
			line('DSECT', '', 'REC'),
			line('DS', 'CL4', 'CODE'),
			line('DS', 'CL8', 'NAME'),
		].join('\n')
		const { program } = await assemble(code)
		expect(program.diagnostics).toEqual([])
		const blanks = program.labels.get('BLANKS')! - 0x1002
		const literal = 0x1020 - 0x1002
		expect(hex(imageBytes(program, 0x1002, 18))).toBe(
			`D2075004C${blanks.toString(16).toUpperCase().padStart(3, '0')}` +
			`D2015004C${blanks.toString(16).toUpperCase().padStart(3, '0')}` +
			`D5035000C${literal.toString(16).toUpperCase().padStart(3, '0')}`)
		expect(program.labels.has('NAME')).toBe(false)
	})

	it('assembles DC types with duplication, lengths, alignment and EBCDIC text', async () => {
		const code = [
			line('CSECT', '', 'T'),
			line('DC', "C'Hi',X'0A0B'", 'A1'),
			line('DC', "2H'-1'", 'A2'),
			line('DC', "F'1',A(A1),Y(A2-A1)", 'A3'),
			line('DC', "CL4'AB',XL3'FF',BL2'101'", 'A4'),
			line('DC', "E'1',D'-1.5'", 'A5'),
			line('DC', "P'-123',PL3'45',Z'-12'", 'A6'),
			line('DC', "AL2(A6-A1),FL1'5'", 'A7'),
			line('DS', '0D', 'A8'),
			line('EQU', 'A8-A1', 'SIZE'),
		].join('\n')
		const { program } = await assemble(code)
		expect(program.diagnostics).toEqual([])
		expect(hex(imageBytes(program, 0x1000, 4))).toBe('C8890A0B')                    // C'Hi' is EBCDIC C8 89
		expect(hex(imageBytes(program, 0x1004, 4))).toBe('FFFFFFFF')
		expect(hex(imageBytes(program, 0x1008, 10))).toBe('00000001' + '00001000' + '0004')
		expect(hex(imageBytes(program, 0x1012, 9))).toBe('C1C24040' + '0000FF' + '0005')
		expect(hex(imageBytes(program, 0x101c, 12))).toBe('41100000' + 'C118000000000000')
		expect(hex(imageBytes(program, 0x1028, 7))).toBe('123D' + '00045C' + 'F1D2')
		expect(hex(imageBytes(program, 0x102f, 3))).toBe('002805')
		expect(program.labels.get('SIZE')).toBe(0x38)
	})

	it('places literals at LTORG by alignment and shares duplicates', async () => {
		const code = [
			line('CSECT', '', 'T'),
			line('BALR', '12,0'),
			line('USING', '*,12'),
			line('LH', "1,=H'5'"),
			line('L', "2,=F'7'"),
			line('LD', "0,=D'1'"),
			line('L', "3,=F'7'"),
			line('LTORG'),
		].join('\n')
		const { program } = await assemble(code)
		expect(program.diagnostics).toEqual([])
		// Code ends at 0x1012; the pool starts at 0x1018: D, then F, then H.
		expect(hex(imageBytes(program, 0x1018, 14))).toBe('4110000000000000' + '00000007' + '0005')
		expect(hex(imageBytes(program, 0x1002, 16))).toBe('4810C022' + '5820C01E' + '6800C016' + '5830C01E')
	})

	it('accepts lower case, remarks, comment lines, ORG and CNOP', async () => {
		const code = [
			'* a comment line',
			'.* a macro comment',
			line('csect', '', 'low'),
			line('balr', '12,0', '') + '            set the base',
			line('cnop', '0,4'),
			line('dc', "c'a b'", 'text') + '   remarks after a blank',
			line('org', 'text+1'),
			line('dc', "c'X'"),
			line('org'),
		].join('\n')
		const { program } = await assemble(code)
		expect(program.diagnostics).toEqual([])
		expect(hex(imageBytes(program, 0x1000, 7))).toBe('05C00700' + '81E782')
	})

	it('reports unknown operations, undefined symbols and duplicate names', async () => {
		const { program } = await assemble([line('CSECT', '', 'T'), line('FOO', '1'), line('DC', 'A(NOWHERE)'), line('DS', 'F', 'T')].join('\n'))
		expect(program.diagnostics.map(d => [d.line, d.message])).toEqual([
			[2, 'Unknown operation FOO'],
			[4, 'Symbol T is already defined at line 1'],
			[3, 'Undefined symbol NOWHERE'],
		])
	})

	it('gates instructions by model and feature', async () => {
		const decimal = [line('CSECT', '', 'T'), line('AP', '0(2,1),0(2,2)')].join('\n')
		const float = [line('CSECT', '', 'T'), line('LER', '0,2')].join('\n')
		const s370 = [line('CSECT', '', 'T'), line('MVCL', '2,4')].join('\n')
		expect((await assemble(decimal, MODEL_30)).program.diagnostics).toMatchObject([{ message: 'AP requires the decimal feature, which System/360 Model 30 does not have' }])
		expect((await assemble(float, MODEL_30)).program.diagnostics).toMatchObject([{ message: /^LER requires the floating-point feature/ }])
		expect((await assemble(decimal, { ...MODEL_30, decimal: true })).program.diagnostics).toEqual([])
		expect((await assemble(s370, MODEL_50)).program.diagnostics).toMatchObject([{ message: /^MVCL requires System\/370/ }])
		expect((await assemble(s370, S370)).program.diagnostics).toEqual([])
	})
})
