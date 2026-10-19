import { describe, it, expect } from 'vitest'
import {
	BASIC_INSTRUCTIONS,
	BASIC_MNEMONICS,
	INSTRUCTION_MNEMONICS,
	PSEUDO_INSTRUCTIONS,
	PSEUDO_MNEMONICS,
	basicForms,
	findByBinary,
	pseudoForms,
} from '../isa'
import { Lexer } from '../../assembler/lexer'

/**
 * The 139 mnemonics of the 155 basic forms, listed separately so the table is
 * checked against a second copy rather than against itself.
 */
const EXPECTED_BASIC_MNEMONICS = [
	'ABS.D', 'ABS.S', 'ADD', 'ADD.D', 'ADD.S', 'ADDI', 'ADDIU', 'ADDU', 'AND', 'ANDI',
	'BC1F', 'BC1T', 'BEQ', 'BGEZ', 'BGEZAL', 'BGTZ', 'BLEZ', 'BLTZ', 'BLTZAL', 'BNE', 'BREAK',
	'C.EQ.D', 'C.EQ.S', 'C.LE.D', 'C.LE.S', 'C.LT.D', 'C.LT.S', 'CEIL.W.D', 'CEIL.W.S',
	'CLO', 'CLZ', 'CVT.D.S', 'CVT.D.W', 'CVT.S.D', 'CVT.S.W', 'CVT.W.D', 'CVT.W.S',
	'DIV', 'DIV.D', 'DIV.S', 'DIVU', 'ERET', 'FLOOR.W.D', 'FLOOR.W.S',
	'J', 'JAL', 'JALR', 'JR', 'LB', 'LBU', 'LDC1', 'LH', 'LHU', 'LL', 'LUI', 'LW', 'LWC1', 'LWL', 'LWR',
	'MADD', 'MADDU', 'MFC0', 'MFC1', 'MFHI', 'MFLO', 'MOV.D', 'MOV.S',
	'MOVF', 'MOVF.D', 'MOVF.S', 'MOVN', 'MOVN.D', 'MOVN.S', 'MOVT', 'MOVT.D', 'MOVT.S',
	'MOVZ', 'MOVZ.D', 'MOVZ.S', 'MSUB', 'MSUBU', 'MTC0', 'MTC1', 'MTHI', 'MTLO',
	'MUL', 'MUL.D', 'MUL.S', 'MULT', 'MULTU', 'NEG.D', 'NEG.S', 'NOP', 'NOR', 'OR', 'ORI',
	'ROUND.W.D', 'ROUND.W.S', 'SB', 'SC', 'SDC1', 'SH', 'SLL', 'SLLV', 'SLT', 'SLTI', 'SLTIU', 'SLTU',
	'SQRT.D', 'SQRT.S', 'SRA', 'SRAV', 'SRL', 'SRLV', 'SUB', 'SUB.D', 'SUB.S', 'SUBU',
	'SW', 'SWC1', 'SWL', 'SWR', 'SYSCALL',
	'TEQ', 'TEQI', 'TGE', 'TGEI', 'TGEIU', 'TGEU', 'TLT', 'TLTI', 'TLTIU', 'TLTU', 'TNE', 'TNEI',
	'TRUNC.W.D', 'TRUNC.W.S', 'XOR', 'XORI',
]

/** The 83 mnemonics of the 388 pseudo forms. */
const EXPECTED_PSEUDO_MNEMONICS = [
	'ABS', 'ADD', 'ADDI', 'ADDIU', 'ADDU', 'AND', 'ANDI', 'B', 'BEQ', 'BEQZ', 'BGE', 'BGEU',
	'BGT', 'BGTU', 'BLE', 'BLEU', 'BLT', 'BLTU', 'BNE', 'BNEZ', 'DIV', 'DIVU',
	'L.D', 'L.S', 'LA', 'LB', 'LBU', 'LD', 'LDC1', 'LH', 'LHU', 'LI', 'LL', 'LW', 'LWC1', 'LWL', 'LWR',
	'MFC1.D', 'MOVE', 'MTC1.D', 'MUL', 'MULO', 'MULOU', 'MULU', 'NEG', 'NEGU', 'NOT', 'OR', 'ORI',
	'REM', 'REMU', 'ROL', 'ROR', 'S.D', 'S.S', 'SB', 'SC', 'SD', 'SDC1', 'SEQ', 'SGE', 'SGEU',
	'SGT', 'SGTU', 'SH', 'SLE', 'SLEU', 'SNE', 'SUB', 'SUBI', 'SUBIU', 'SUBU', 'SW', 'SWC1', 'SWL', 'SWR',
	'ULH', 'ULHU', 'ULW', 'USH', 'USW', 'XOR', 'XORI',
]

/** The three forms this port adds. */
const THRAX_EXTRA_MNEMONICS = ['BAL', 'LI.D', 'LI.S']

describe('basic instruction table', () => {
	it('has 155 forms over 139 mnemonics', () => {
		expect(BASIC_INSTRUCTIONS).toHaveLength(155)
		expect(BASIC_MNEMONICS.size).toBe(139)
	})

	it('matches the transcribed mnemonic set', () => {
		expect([...BASIC_MNEMONICS].sort()).toEqual([...EXPECTED_BASIC_MNEMONICS].sort())
	})

	it('spends its 16 extra forms on 16 dual-form mnemonics', () => {
		const dual = [...BASIC_MNEMONICS].filter((mnemonic) => basicForms(mnemonic).length > 1).sort()
		expect(dual).toEqual([
			'BC1F', 'BC1T', 'BREAK',
			'C.EQ.D', 'C.EQ.S', 'C.LE.D', 'C.LE.S', 'C.LT.D', 'C.LT.S',
			'JALR', 'MOVF', 'MOVF.D', 'MOVF.S', 'MOVT', 'MOVT.D', 'MOVT.S',
		].sort())
		expect(BASIC_INSTRUCTIONS.length - BASIC_MNEMONICS.size).toBe(16)
	})

	it('carries a 32-bit pattern whose mask and match agree with it', () => {
		for (const instruction of BASIC_INSTRUCTIONS) {
			expect(instruction.pattern, instruction.example).toHaveLength(32)
			expect(instruction.pattern, instruction.example).toMatch(/^[01fstc]{32}$/)

			// Mask is 1 exactly where the pattern fixes a bit, match those bits' values.
			const mask = [...instruction.pattern].map((bit) => ('01'.includes(bit) ? '1' : '0')).join('')
			const match = [...instruction.pattern].map((bit) => (bit === '1' ? '1' : '0')).join('')
			expect(instruction.mask >>> 0, instruction.example).toBe(Number.parseInt(mask, 2) >>> 0)
			expect(instruction.match >>> 0, instruction.example).toBe(Number.parseInt(match, 2) >>> 0)
			expect((instruction.match & ~instruction.mask) >>> 0, instruction.example).toBe(0)
		}
	})

	it('gives every operand of every example a kind', () => {
		for (const instruction of BASIC_INSTRUCTIONS) {
			const operands = instruction.example.includes(' ') ? instruction.example.split(' ')[1].split(',') : []
			expect(instruction.operands, instruction.example).toHaveLength(operands.length)
		}
	})

	it('places the condition code of a C.cond.fmt form in the top of the fd field', () => {
		// The condition code has no field of its own.
		const [plain, coded] = basicForms('c.eq.s')
		expect(plain.operands).toEqual(['fpr', 'fpr'])
		expect(coded.operands).toEqual(['imm3', 'fpr', 'fpr'])
		expect(coded.fields[0]).toEqual({ letter: 'f', shift: 8, width: 3 })
	})

	it('marks the FP operands that have to be even', () => {
		expect(basicForms('add.d')[0].operands).toEqual(['fpr-even', 'fpr-even', 'fpr-even'])
		expect(basicForms('add.s')[0].operands).toEqual(['fpr', 'fpr', 'fpr'])
		// `floor.w.d $f1,$f2`: only the source is a double.
		expect(basicForms('floor.w.d')[0].operands).toEqual(['fpr', 'fpr-even'])
		expect(basicForms('movn.d')[0].operands).toEqual(['fpr-even', 'fpr-even', 'gpr'])
	})

	it('names the CP0 and memory operand kinds', () => {
		expect(basicForms('mfc0')[0].operands).toEqual(['gpr', 'cp0'])
		expect(basicForms('lw')[0].operands).toEqual(['gpr', 'mem'])
		expect(basicForms('j')[0].operands).toEqual(['target26'])
		expect(basicForms('sll')[0].operands).toEqual(['gpr', 'gpr', 'imm5'])
		expect(basicForms('addi')[0].operands).toEqual(['gpr', 'gpr', 'imm16s'])
		expect(basicForms('andi')[0].operands).toEqual(['gpr', 'gpr', 'imm16u'])
	})
})

describe('findByBinary', () => {
	it('resolves the longest mask first, so a zero word is nop and not sll', () => {
		expect(findByBinary(0)?.example).toBe('nop')
		// sll $t1,$t2,10
		expect(findByBinary(0x000a4a80)?.example).toBe('sll $t1,$t2,10')
	})

	it('selects on rt for every opcode-1 form', () => {
		const forms: [number, string][] = [
			[0x00, 'bltz'], [0x01, 'bgez'], [0x10, 'bltzal'], [0x11, 'bgezal'],
			[0x08, 'tgei'], [0x09, 'tgeiu'], [0x0a, 'tlti'], [0x0b, 'tltiu'],
			[0x0c, 'teqi'], [0x0e, 'tnei'],
		]
		for (const [rt, mnemonic] of forms) {
			const word = (0b000001 << 26) | (9 << 21) | (rt << 16) | 0x0004
			expect(findByBinary(word)?.mnemonic, mnemonic).toBe(mnemonic)
		}
	})

	it('prefers the explicit zero form over the coded one', () => {
		// break, then break 100
		expect(findByBinary(0x0000000d)?.example).toBe('break')
		expect(findByBinary(0x0000190d)?.example).toBe('break 100')
		// movf $t1,$t2 is cc 0; movf $t1,$t2,1 is any other cc.
		expect(findByBinary(0x01404801)?.example).toBe('movf $t1,$t2')
		expect(findByBinary(0x01444801)?.example).toBe('movf $t1,$t2,1')
	})

	it('selects a COP1 form on rs, then funct, then the tf bit', () => {
		expect(findByBinary(0x46000000)?.mnemonic).toBe('add.s')
		expect(findByBinary(0x46200000)?.mnemonic).toBe('add.d')
		expect(findByBinary(0x45010004)?.mnemonic).toBe('bc1t')
		expect(findByBinary(0x45000004)?.mnemonic).toBe('bc1f')
	})

	it('reaches every one of the 155 forms', () => {
		// Distinct operand values, so a form is never confused with a sibling that
		// fixes the field this one leaves free.
		const value = { f: 1, s: 2, t: 3 }
		for (const instruction of BASIC_INSTRUCTIONS) {
			let word = instruction.match
			for (const field of instruction.fields) word |= value[field.letter] << field.shift
			expect(findByBinary(word)?.example, instruction.example).toBe(instruction.example)
		}
	})

	it('has no form for a reserved encoding', () => {
		// opcode 1, rt 2 is not a MIPS32 form.
		expect(findByBinary((0b000001 << 26) | (9 << 21) | (2 << 16))).toBeUndefined()
	})
})

describe('pseudo-instruction table', () => {
	it('has the 388 forms plus the three extras', () => {
		expect(PSEUDO_INSTRUCTIONS.filter((form) => !form.thraxExtension)).toHaveLength(388)
		expect(PSEUDO_INSTRUCTIONS.filter((form) => form.thraxExtension)).toHaveLength(3)
	})

	it('matches the transcribed mnemonic set plus BAL, LI.S and LI.D', () => {
		expect([...PSEUDO_MNEMONICS].sort()).toEqual([...EXPECTED_PSEUDO_MNEMONICS, ...THRAX_EXTRA_MNEMONICS].sort())
	})

	it('marks only the THRAX extras as extensions', () => {
		const extensions = PSEUDO_INSTRUCTIONS.filter((form) => form.thraxExtension).map((form) => form.example)
		expect(extensions).toEqual(['bal label', 'li.s $f1,1.5', 'li.d $f2,1.5'])
		expect(pseudoForms('li.d')[0].operands).toEqual(['fpr-even', 'float'])
		expect(pseudoForms('li.s')[0].operands).toEqual(['fpr', 'float'])
		expect(pseudoForms('bal')[0].operands).toEqual(['label'])
	})

	it('names the extended operand shapes spelled unusually', () => {
		const forms = new Map(pseudoForms('lw').map((form) => [form.example, form.operands]))
		expect(forms.get('lw $t1,($t2)')).toEqual(['gpr', 'base'])
		expect(forms.get('lw $t1,label')).toEqual(['gpr', 'label'])
		expect(forms.get('lw $t1,label($t2)')).toEqual(['gpr', 'label-mem'])
		expect(forms.get('lw $t1,label+100000')).toEqual(['gpr', 'label-offset'])
		expect(forms.get('lw $t1,label+100000($t2)')).toEqual(['gpr', 'label-offset-mem'])
		expect(forms.get('lw $t1,100000')).toEqual(['gpr', 'imm32'])
		expect(pseudoForms('l.d')[0].operands).toEqual(['fpr-even', 'base'])
	})
})

describe('lexer.isInstruction reads the table', () => {
	const lexer = new Lexer('')

	it('accepts every transcribed mnemonic', () => {
		for (const mnemonic of [...EXPECTED_BASIC_MNEMONICS, ...EXPECTED_PSEUDO_MNEMONICS]) {
			expect(lexer.isInstruction(mnemonic), mnemonic).toBe(true)
		}
	})

	it('accepts bal, li.s and li.d', () => {
		// Without them these three would lex as identifiers.
		for (const mnemonic of THRAX_EXTRA_MNEMONICS) {
			expect(lexer.isInstruction(mnemonic), mnemonic).toBe(true)
		}
		for (const source of ['bal loop', 'li.s $f0, 1.5', 'li.d $f2, 1.5']) {
			expect(new Lexer(source).tokenize()[0].type, source).toBe('INSTRUCTION')
		}
	})

	it('is exactly the union, and no wider', () => {
		expect(INSTRUCTION_MNEMONICS.size).toBe(190)
		expect(lexer.isInstruction('LOOP')).toBe(false)
		expect(lexer.isInstruction('MAIN')).toBe(false)
	})
})
