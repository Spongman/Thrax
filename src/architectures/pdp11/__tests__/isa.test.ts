import { describe, expect, it } from 'vitest'
import { assemble, BASE, EIS, FIS, FP11, words } from './helpers'
import { instructionLink } from '../instructionHelp'

// Expected words are the octal opcodes of the PDP-11 Architecture Handbook
// (EB-23657-18), Table 5-1 and Chapter 6, composed by hand from the mode and
// register fields (mode << 3 | register), not by this encoder.
describe('PDP-11 encodings', () => {
	it.each([
		['MOV R0, R1', ['010001']],
		['MOV (R1), R2', ['011102']],
		['MOVB (R1)+, R0', ['112100']],
		['MOV @(R2)+, R3', ['013203']],
		['MOV R0, -(SP)', ['010046']],
		['MOV @-(R2), R3', ['015203']],
		['MOV 2(R5), R0', ['016500', '000002']],
		['MOV -2(R5), R0', ['016500', '177776']],
		['MOV @4(R5), R0', ['017500', '000004']],
		['MOV @(R5), R0\n.WORD 1', ['017500', '000000', '000001']],
		['MOV #10, R0', ['012700', '000010']],
		['MOV #10., R0', ['012700', '000012']],
		['MOV @#177566, R0', ['013700', '177566']],
		['MOV 2(R1), 4(R2)', ['016162', '000002', '000004']],
		['MOV #1, @#2000', ['012737', '000001', '002000']],
		['SWAB R0', ['000300']],
		['CLR (R3)+', ['005023']],
		['TSTB @#177564', ['105737', '177564']],
		['SXT R1', ['006701']],
		['XOR R5, R0', ['074500']],
		['MUL R2, R0', ['070002']],
		['DIV #256., R0', ['071027', '000400']],
		['ASH #-7, R2', ['072227', '177771']],
		['ASHC R2, R0', ['073002']],
		['RTS PC', ['000207']],
		['MARK 2', ['006402']],
		['EMT 3', ['104003']],
		['TRAP', ['104400']],
		['TRAP 377', ['104777']],
		['WAIT\nRTI\nBPT\nIOT\nRESET\nRTT', ['000001', '000002', '000003', '000004', '000005', '000006']],
		['NOP\nCLC\nSEC\nCCC\nSCC\nSEN', ['000240', '000241', '000261', '000257', '000277', '000270']],
	] as const)('%s', async (code, expected) => {
		expect(await words(code)).toEqual(expected)
	})

	it('encodes PC-relative operands from the word after the index', async () => {
		// X is at 1012. The index word at 1002 is followed by 1004, so its offset is 6; the one at 1006 gives 2.
		expect(await words('MOV X, R0\nMOV @X, R0\n.WORD 0\nX: .WORD 0')).toEqual(['016700', '000006', '017700', '000002'])
	})

	it('encodes branches, SOB and JSR targets', async () => {
		expect(await words('A: BR A\nBNE B\nB: BEQ A')).toEqual(['000777', '001000', '001775'])
		expect(await words('A: SOB R1, A\nSOB R0, A')).toEqual(['077101', '077002'])
		expect(await words('JSR PC, S\nS: RTS PC')).toEqual(['004767', '000000', '000207'])
		expect(await words('JSR R5, @(R4)+')).toEqual(['004534'])
	})

	it('encodes FP11 instructions with accumulator and floating immediate fields', async () => {
		expect(await words('CFCC\nSETF\nSETI\nSETD\nSETL', FP11)).toEqual(['170000', '170001', '170002', '170011', '170012'])
		expect(await words('LDF (R1), AC0\nADDF AC1, AC0\nSTF AC0, (R2)\nMULF AC0, AC2\nSTF AC2, AC4', FP11)).toEqual(['172411', '172001', '174012', '171200', '174204'])
		// 4.0 is 0.5 x 2^3: exponent 203, so the upper word is 040600; 1.0 is 040200.
		expect(await words('CMPF #4, AC2\nLDF #1.0, AC0\nLDCIF #22., AC0', FP11)).toEqual(['173627', '040600', '172427', '040200', '177027', '000026'])
		expect(await words('LDCIF R3, AC0\nSTCFI AC0, R0\nSTEXP AC1, R2\nLDEXP R2, AC1\nLDCDF (R1), AC3\nSTCFD AC3, -(SP)', FP11)).toEqual(['177003', '175400', '175102', '176502', '177711', '176346'])
		expect(await words('LDFPS R1\nSTFPS R1\nSTST R1\nCLRF AC5\nTSTD AC1\nABSF (R0)\nNEGD -(R2)', FP11)).toEqual(['170101', '170201', '170301', '170405', '170501', '170610', '170742'])
	})

	it('encodes FIS and the LSI-11 PSW moves', async () => {
		expect(await words('FADD R1\nFSUB SP\nFMUL R0\nFDIV R5', FIS)).toEqual(['075001', '075016', '075020', '075035'])
		expect(await words('MFPS R0\nMTPS #340', { cpuModel: 'lsi1123', floatingPoint: 'none' })).toEqual(['106700', '106427', '000340'])
		expect(await words('SPL 7', { cpuModel: 'pdp1145', floatingPoint: 'none' })).toEqual(['000237'])
	})
})

describe('MACRO-11 syntax', () => {
	it('reads octal by default, decimal with a point, and the ^B ^O ^D ^X forms', async () => {
		expect(await words('.WORD 17, 17., ^B101, ^O17, ^D17, ^X1F, -1, ^C0')).toEqual(['000017', '000021', '000005', '000017', '000021', '000037', '177777', '177777'])
	})
	it('evaluates left to right and groups with angle brackets', async () => {
		expect(await words('.WORD 1+2*3, 1+<2*3>, 7&3!10')).toEqual(['000011', '000007', '000013'])
	})
	it('reads character constants and delimited .ASCII text', async () => {
		expect(await words('.WORD \'A, "AB\nMOV #\';, R0')).toEqual(['000101', '041101', '012700', '000073'])
		expect(await words('.ASCII /a;b/<15>\n.ASCIZ "c"')).toEqual(['035541', '006542', '000143'])
	})
	it('scopes n$ labels between ordinary labels', async () => {
		expect(await words('A: 1$: BR 1$\nB: 1$: BR 1$\nBR A')).toEqual(['000777', '000777', '000775'])
	})
	it('reserves, aligns, assigns and starts at .END', async () => {
		const { services, program } = await assemble('.BYTE 1\n.EVEN\nX = . + 2\n.BLKW 2\nY: .WORD X\nSTART: HALT\n.END START\nBOGUS')
		expect(program.diagnostics).toEqual([])
		expect(program.labels.get('Y')).toBe(0o1006)
		expect(services.createMachine(program, EIS, { speed: null, historyLimit: 10 }).pc).toBe(0o1010)
	})
	it('reports bad digits, unknown directives and model-gated instructions', async () => {
		const diagnostics = async (code: string, settings = EIS) => (await assemble(code, settings)).program.diagnostics.map(d => d.message)
		expect(await diagnostics('.WORD 18')).toEqual([expect.stringContaining('base-8')])
		expect(await diagnostics('.TITLE ok\n.FROB 1')).toEqual([expect.stringContaining('Unknown directive')])
		expect(await diagnostics('MUL R1, R0\nSOB R0, .\nXOR R0, R1\nSXT R0\nMARK 1\nRTT', BASE)).toEqual([
			expect.stringContaining('MUL requires the EIS'), expect.stringContaining('SOB requires'), expect.stringContaining('XOR requires'),
			expect.stringContaining('SXT requires'), expect.stringContaining('MARK requires'), expect.stringContaining('RTT requires'),
		])
		expect(await diagnostics('LDF (R0), AC0')).toEqual([expect.stringContaining('FP11')])
		expect(await diagnostics('FADD R0', FP11)).toEqual([expect.stringContaining('FIS')])
		expect(await diagnostics('SPL 7')).toEqual([expect.stringContaining('PDP-11/45')])
		expect(await diagnostics('LDF (R0), AC4', FP11)).toEqual([expect.stringContaining('AC0-AC3')])
		expect(await diagnostics('JMP R0')).toEqual([expect.stringContaining('register')])
		expect(await diagnostics('DIV R2, R1')).toEqual([expect.stringContaining('even register')])
		expect(await diagnostics('A: .BLKW 200\nBR A')).toEqual([expect.stringContaining('Branch offset')])
	})
})

describe('PDP-11 disassembly', () => {
	it('shows MACRO-11 operands in octal', async () => {
		const { services, program } = await assemble('MOV #177566, R1\nMOVB -(R2), @6(R3)\nX: BNE X\nMOV X, R0\nJSR PC, @#2000\n.WORD 070001')
		const machine = services.createMachine(program, EIS, { speed: null, historyLimit: 10 })
		const text = (address: number) => services.disassembly.at(machine.inspectMemory(), address)
		expect(text(0o1000)).toBe('MOV #177566, R1')
		expect(text(0o1004)).toBe('MOVB -(R2), @6(R3)')
		expect(text(0o1010)).toBe('BNE 1010')
		expect(text(0o1012)).toBe('MOV 1010, R0')
		expect(text(0o1016)).toBe('JSR PC, @#2000')
		expect(text(0o1022)).toBe('MUL R1, R0')
	})
})

describe('PDP-11 instruction links', () => {
	it('uses individual core scans and retains FP handbook pages', () => {
		const base = 'https://bitsavers.org/pdf/dec/pdp11/handbooks/EB-23657-18_PDP-11_Architecture_Handbook_1983.pdf'
		expect(instructionLink('MOV')).toBe('https://pdos.csail.mit.edu/6.828/2005/pdp11/pdp11-40-000069.html')
		expect(instructionLink('movb')).toBe('https://pdos.csail.mit.edu/6.828/2005/pdp11/pdp11-40-000069.html')
		expect(instructionLink('SOB')).toBe('https://pdos.csail.mit.edu/6.828/2005/pdp11/pdp11-40-000109.html')
		expect(instructionLink('LDD')).toBe(`${base}#page=156`)
		expect(instructionLink('FSUB')).toBe(`${base}#page=320`)
		expect(instructionLink('NOSUCH')).toBeUndefined()
	})
})
