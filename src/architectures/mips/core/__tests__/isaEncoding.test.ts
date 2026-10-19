import { describe, expect, it } from 'vitest'
import { assembleMips } from '../../assembler'
import { firstError } from '../../../../core/diagnostics'
import { BASIC_INSTRUCTIONS, PSEUDO_INSTRUCTIONS, findByBinary, type BasicInstruction } from '../isa'
import { words } from './helpers'

/**
 * The thirty basic families A5 adds and the condition codes A6 adds, encoded
 * from the isa table rather than from a hand-written opcode map.  Each word is
 * checked against the mask and match MARS itself publishes for that form
 * (`BasicInstruction.java:83-84`), so the oracle is MARS's bit pattern and not
 * a constant retyped here.
 */

/** Assembles one instruction, labelled so a branch target resolves to itself. */
function encode(source: string): number {
	return words(`.text\nlbl: ${source}\n`)[0] >>> 0
}

function formOf(example: string): BasicInstruction {
	const form = BASIC_INSTRUCTIONS.find((candidate) => candidate.example === example)
	if (!form) throw new Error(`No isa form spelled "${example}"`)
	return form
}

/** The value `word` carries in the run of `letter` the form's pattern names. */
function fieldOf(example: string, word: number, letter: 'f' | 's' | 't'): number {
	const field = formOf(example).fields.find((candidate) => candidate.letter === letter)
	if (!field) throw new Error(`"${example}" has no ${letter} field`)
	return (word >>> field.shift) & (2 ** field.width - 1)
}

/** The word's fixed bits are the form's, and no sibling form claims it first. */
function expectForm(word: number, example: string) {
	const form = formOf(example)
	expect((word & form.mask) >>> 0, example).toBe(form.match)
	expect(findByBinary(word)?.example, example).toBe(example)
}

/** The first error assembling `source`, or '' when it assembles. */
function errorFor(source: string): string {
	const { diagnostics } = assembleMips(`.text\nlbl: ${source}\n`)
	return firstError(diagnostics)?.message ?? ''
}

/** One source line, the isa form it must encode, and its f, s and t fields. */
interface Case { source: string; example: string; f: number; s?: number; t?: number }

function checkCase({ source, example, f, s, t }: Case) {
	const word = encode(source)
	expectForm(word, example)
	expect(fieldOf(example, word, 'f'), `${source} f`).toBe(f)
	if (s !== undefined) expect(fieldOf(example, word, 's'), `${source} s`).toBe(s)
	if (t !== undefined) expect(fieldOf(example, word, 't'), `${source} t`).toBe(t)
}

describe('branch and link', () => {
	// `InstructionSet.java:909` and `:961`; opcode 1 tells them apart on rt.
	it.each<Case>([
		{ source: 'bgezal $t1, lbl', example: 'bgezal $t1,label', f: 9, s: 0xffff },
		{ source: 'bltzal $t1, lbl', example: 'bltzal $t1,label', f: 9, s: 0xffff },
	])('encodes $source', checkCase)
})

describe('bit counting and HI-LO accumulate', () => {
	// `InstructionSet.java:1419` (clo) onward; all opcode 0x1c.
	it.each<Case>([
		{ source: 'clo $t1, $t2', example: 'clo $t1,$t2', f: 9, s: 10 },
		{ source: 'clz $t1, $t2', example: 'clz $t1,$t2', f: 9, s: 10 },
		{ source: 'madd $t1, $t2', example: 'madd $t1,$t2', f: 9, s: 10 },
		{ source: 'maddu $t1, $t2', example: 'maddu $t1,$t2', f: 9, s: 10 },
		{ source: 'msub $t1, $t2', example: 'msub $t1,$t2', f: 9, s: 10 },
		{ source: 'msubu $t1, $t2', example: 'msubu $t1,$t2', f: 9, s: 10 },
	])('encodes $source', checkCase)

	it('codes clo and clz with a zero rt, as MARS does', () => {
		// MARS deliberately zeroes rt rather than repeating rd (`InstructionSet.java:1421-1435`).
		expect((encode('clo $t1, $t2') >>> 16) & 0x1f).toBe(0)
		expect((encode('clz $t1, $t2') >>> 16) & 0x1f).toBe(0)
	})
})

describe('conditional moves', () => {
	// `InstructionSet.java:1075` (movn/movz) and `:2625` (the FP forms).
	it.each<Case>([
		{ source: 'movn $t1, $t2, $t3', example: 'movn $t1,$t2,$t3', f: 9, s: 10, t: 11 },
		{ source: 'movz $t1, $t2, $t3', example: 'movz $t1,$t2,$t3', f: 9, s: 10, t: 11 },
		{ source: 'movn.s $f0, $f1, $t3', example: 'movn.s $f0,$f1,$t3', f: 0, s: 1, t: 11 },
		{ source: 'movz.s $f0, $f1, $t3', example: 'movz.s $f0,$f1,$t3', f: 0, s: 1, t: 11 },
		{ source: 'movn.d $f2, $f4, $t3', example: 'movn.d $f2,$f4,$t3', f: 2, s: 4, t: 11 },
		{ source: 'movz.d $f2, $f4, $t3', example: 'movz.d $f2,$f4,$t3', f: 2, s: 4, t: 11 },
		{ source: 'movf.s $f0, $f1', example: 'movf.s $f0,$f1', f: 0, s: 1 },
		{ source: 'movt.s $f0, $f1', example: 'movt.s $f0,$f1', f: 0, s: 1 },
		{ source: 'movf.d $f2, $f4', example: 'movf.d $f2,$f4', f: 2, s: 4 },
		{ source: 'movt.d $f2, $f4', example: 'movt.d $f2,$f4', f: 2, s: 4 },
	])('encodes $source', checkCase)

	it('rejects an odd register where a double is wanted', () => {
		expect(errorFor('movn.d $f1, $f4, $t3')).toBe('$f1 must be an even-numbered floating-point register at line 2:6')
	})
})

describe('traps', () => {
	// `InstructionSet.java:2829` onward.  The register forms share funct 0x30-0x36
	// under opcode 0; the immediate forms share opcode 1 and select on rt.
	it.each<Case>([
		{ source: 'teq $t1, $t2', example: 'teq $t1,$t2', f: 9, s: 10 },
		{ source: 'tne $t1, $t2', example: 'tne $t1,$t2', f: 9, s: 10 },
		{ source: 'tge $t1, $t2', example: 'tge $t1,$t2', f: 9, s: 10 },
		{ source: 'tgeu $t1, $t2', example: 'tgeu $t1,$t2', f: 9, s: 10 },
		{ source: 'tlt $t1, $t2', example: 'tlt $t1,$t2', f: 9, s: 10 },
		{ source: 'tltu $t1, $t2', example: 'tltu $t1,$t2', f: 9, s: 10 },
		{ source: 'teqi $t1, -100', example: 'teqi $t1,-100', f: 9, s: 0xff9c },
		{ source: 'tnei $t1, -100', example: 'tnei $t1,-100', f: 9, s: 0xff9c },
		{ source: 'tgei $t1, -100', example: 'tgei $t1,-100', f: 9, s: 0xff9c },
		{ source: 'tgeiu $t1, -100', example: 'tgeiu $t1,-100', f: 9, s: 0xff9c },
		{ source: 'tlti $t1, -100', example: 'tlti $t1,-100', f: 9, s: 0xff9c },
		{ source: 'tltiu $t1, -100', example: 'tltiu $t1,-100', f: 9, s: 0xff9c },
	])('encodes $source', checkCase)

	it('gives the twelve traps twelve distinct words', () => {
		const sources = [
			'teq $t1, $t2', 'tne $t1, $t2', 'tge $t1, $t2', 'tgeu $t1, $t2', 'tlt $t1, $t2', 'tltu $t1, $t2',
			'teqi $t1, -100', 'tnei $t1, -100', 'tgei $t1, -100', 'tgeiu $t1, -100', 'tlti $t1, -100', 'tltiu $t1, -100',
		]
		expect(new Set(sources.map(encode)).size).toBe(12)
	})
})

describe('leading condition codes', () => {
	// `bc1t 1,label` (`InstructionSet.java:1986`) and `c.eq.s 1,$f0,$f1` (`:2054`)
	// put the code first; the code-less spelling means condition code 0.
	it('encodes bc1t 1,label differently from bc1t label', () => {
		const coded = encode('bc1t 1, lbl')
		const plain = encode('bc1t lbl')

		expectForm(coded, 'bc1t 1,label')
		expectForm(plain, 'bc1t label')
		expect(fieldOf('bc1t 1,label', coded, 'f')).toBe(1)
		// The code-less form fixes cc 0 in its pattern, so read the bits directly.
		expect((plain >>> 18) & 7).toBe(0)
		expect(coded).not.toBe(plain)
		// Only the condition code differs: same tf bit, same offset.
		expect(coded & ~(7 << 18)).toBe(plain & ~(7 << 18))
	})

	it.each([0, 1, 2, 3, 4, 5, 6, 7])('carries condition code %i on bc1t and bc1f', (code) => {
		const taken = encode(`bc1t ${code}, lbl`)
		const notTaken = encode(`bc1f ${code}, lbl`)

		expect((taken >>> 18) & 7).toBe(code)
		expect((notTaken >>> 18) & 7).toBe(code)
		expect((taken >>> 16) & 1).toBe(1)
		expect((notTaken >>> 16) & 1).toBe(0)
	})

	it('encodes c.eq.s 1,$f0,$f1 differently from c.eq.s $f0,$f1', () => {
		const coded = encode('c.eq.s 1, $f0, $f1')
		const plain = encode('c.eq.s $f0, $f1')

		expectForm(coded, 'c.eq.s 1,$f0,$f1')
		expectForm(plain, 'c.eq.s $f0,$f1')
		// The code occupies the top three bits of the fd field, and nothing else moves.
		expect(fieldOf('c.eq.s 1,$f0,$f1', coded, 'f')).toBe(1)
		expect(fieldOf('c.eq.s 1,$f0,$f1', coded, 's')).toBe(0)
		expect(fieldOf('c.eq.s 1,$f0,$f1', coded, 't')).toBe(1)
		expect(coded).toBe(plain | (1 << 8))
	})

	it.each<Case>([
		{ source: 'c.lt.s 3, $f0, $f1', example: 'c.lt.s 1,$f0,$f1', f: 3, s: 0, t: 1 },
		{ source: 'c.le.s 7, $f0, $f1', example: 'c.le.s 1,$f0,$f1', f: 7, s: 0, t: 1 },
		{ source: 'c.eq.d 2, $f2, $f4', example: 'c.eq.d 1,$f2,$f4', f: 2, s: 2, t: 4 },
		{ source: 'c.lt.d 1, $f2, $f4', example: 'c.lt.d 1,$f2,$f4', f: 1, s: 2, t: 4 },
		{ source: 'c.le.d 5, $f2, $f4', example: 'c.le.d 1,$f2,$f4', f: 5, s: 2, t: 4 },
	])('encodes $source', checkCase)
})

describe('trailing condition codes', () => {
	// The conditional moves put the code last: `movt $t1,$t2,1`.
	it('encodes movt $t1,$t2,1 differently from movt $t1,$t2', () => {
		const coded = encode('movt $t1, $t2, 1')
		const plain = encode('movt $t1, $t2')

		expectForm(coded, 'movt $t1,$t2,1')
		expectForm(plain, 'movt $t1,$t2')
		expect(fieldOf('movt $t1,$t2,1', coded, 't')).toBe(1)
		expect((plain >>> 18) & 7).toBe(0)
		expect(coded).toBe(plain | (1 << 18))
	})

	it.each<Case>([
		{ source: 'movf $t1, $t2, 3', example: 'movf $t1,$t2,1', f: 9, s: 10, t: 3 },
		{ source: 'movt.s $f0, $f1, 1', example: 'movt.s $f0,$f1,1', f: 0, s: 1, t: 1 },
		{ source: 'movf.s $f0, $f1, 7', example: 'movf.s $f0,$f1,1', f: 0, s: 1, t: 7 },
		{ source: 'movt.d $f2, $f4, 2', example: 'movt.d $f2,$f4,1', f: 2, s: 4, t: 2 },
		{ source: 'movf.d $f2, $f4, 1', example: 'movf.d $f2,$f4,1', f: 2, s: 4, t: 1 },
	])('encodes $source', checkCase)

	it('keeps the tf bit as the only difference between movt and movf', () => {
		expect(encode('movt $t1, $t2, 5')).toBe(encode('movf $t1, $t2, 5') | (1 << 16))
		expect(encode('movt.s $f0, $f1, 5')).toBe(encode('movf.s $f0, $f1, 5') | (1 << 16))
	})
})

describe('condition code range', () => {
	// A condition code is three bits, so MARS accepts 0-7 and nothing else.
	it.each([
		['bc1t 8, lbl', 'Operand 1 of BC1T is out of range; expected: bc1t 1,label at line 2:6'],
		['bc1f 8, lbl', 'Operand 1 of BC1F is out of range; expected: bc1f 1,label at line 2:6'],
		['c.eq.s 8, $f0, $f1', 'Operand 1 of C.EQ.S is out of range; expected: c.eq.s 1,$f0,$f1 at line 2:6'],
		['movt $t1, $t2, 8', 'Operand 3 of MOVT is out of range; expected: movt $t1,$t2,1 at line 2:6'],
		['movf.s $f0, $f1, 8', 'Operand 3 of MOVF.S is out of range; expected: movf.s $f0,$f1,1 at line 2:6'],
	])('rejects %s', (source, message) => {
		expect(errorFor(source)).toBe(message)
	})

	it('accepts 7 where it rejects 8', () => {
		expect(errorFor('bc1t 7, lbl')).toBe('')
		expect(errorFor('movt $t1, $t2, 7')).toBe('')
	})
})

describe('the whole table encodes', () => {
	/**
	 * Every example in the isa table assembles, and every basic one assembles to
	 * a word its own form claims.  This is what replaces the old
	 * `Unknown instruction: MOVN` guard: after A5 and A6 no mnemonic the lexer
	 * accepts reaches the encoder's fallthrough.
	 */
	it.each(BASIC_INSTRUCTIONS.map((form) => form.example))('encodes the basic form %s', (example) => {
		const word = encode(example.replace(/\btarget\b/, 'lbl').replace(/\blabel\b/, 'lbl'))

		expect((word & formOf(example).mask) >>> 0).toBe(formOf(example).match)
	})

	it('assembles every pseudo example too', () => {
		const failed = PSEUDO_INSTRUCTIONS
			.map((form) => form.example)
			.filter((example) => errorFor(example.replace(/\btarget\b/, 'lbl').replace(/\blabel\b/, 'lbl')) !== '')

		expect(failed).toEqual([])
	})
})
