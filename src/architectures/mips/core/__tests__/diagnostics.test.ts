import { describe, expect, it } from 'vitest'
import { assembleMips } from '../../assembler'
import { assemble } from './helpers'

describe('assembly diagnostics', () => {
	it('positions an undefined label at the line that names it', () => {
		const { diagnostics } = assembleMips([{ name: 'main.asm', code: 'main:\n\tnop\n\tj missing\n' }])

		expect(diagnostics).toHaveLength(1)
		expect(diagnostics[0]).toMatchObject({ severity: 'error', file: 'main.asm', line: 3, column: 2 })
		expect(diagnostics[0].message).toBe('Undefined label: missing at main.asm:3:2')
	})

	it('reports every bad instruction, not just the first', () => {
		const { diagnostics } = assembleMips([{ name: 'main.asm', code: 'main:\n\tj missingOne\n\tnop\n\tj missingTwo\n' }])

		expect(diagnostics.map((diagnostic) => [diagnostic.line, diagnostic.message])).toEqual([
			[2, 'Undefined label: missingOne at main.asm:2:2'],
			[4, 'Undefined label: missingTwo at main.asm:4:2'],
		])
	})

	it('reports a bad operand and a missing label in one pass', () => {
		const { diagnostics } = assembleMips('mult $t0, 5\nla $t1, absent\n')

		expect(diagnostics).toHaveLength(2)
		expect(diagnostics[0]).toMatchObject({ line: 1, message: 'Expected a register, found the value 5 at line 1:1' })
		expect(diagnostics[1]).toMatchObject({ line: 2, message: 'Undefined label: absent at line 2:1' })
	})

	it('stops at the first parse error, since the token stream is broken', () => {
		const { diagnostics, machineCode } = assembleMips('main:\n\t)\n\tnop\n')

		expect(diagnostics).toHaveLength(1)
		expect(diagnostics[0].line).toBe(2)
		expect(machineCode).toHaveLength(0)
	})

	it('positions a directive operand error, which used to carry none', () => {
		const { diagnostics } = assembleMips('.data\n.align 99\n')

		expect(diagnostics[0].message).toBe('Invalid alignment for .align at line 2:1')
	})

	it('assembles a good program without diagnostics', () => {
		const { diagnostics, machineCode } = assembleMips('main:\n\tnop\n\tj main\n')

		expect(diagnostics).toEqual([])
		expect(machineCode).toHaveLength(2)
	})

	it('still throws through the test helpers, first error first', () => {
		expect(() => assemble('j missingOne\nj missingTwo\n')).toThrow('Undefined label: missingOne at line 1:1')
	})
})

/**
 * Every instruction is matched against its `isa.ts` signatures before it is
 * expanded, the way MARS matches operand token types
 * (`OperandFormat.tokenOperandMatch`, `OperandFormat.java:60`).  Each of these
 * assembled in silence before: a missing or out-of-range operand encoded as a
 * zero field, and `lw $t0` escaped as a raw TypeError.
 */
describe('operand validation', () => {
	/** The messages of one assembly, which reports rather than throws. */
	function messages(source: string): string[] {
		return assembleMips(`.text\nmain:\n${source}\n`).diagnostics.map((diagnostic) => diagnostic.message)
	}

	it('rejects a missing operand', () => {
		expect(messages('addi $t0, $t1')).toEqual(['Expected an immediate value, found the register $t1 at line 3:1'])
	})

	it('rejects a shift amount above 31', () => {
		expect(messages('sll $t2, $t3, 32')).toEqual(['Operand 3 of SLL is out of range; expected: sll $t1,$t2,10 at line 3:1'])
	})

	it('rejects a jump with no target', () => {
		expect(messages('j')).toEqual(['Too few operands for J; expected: j target at line 3:1'])
	})

	it('reports a load with no address instead of crashing', () => {
		expect(messages('lw $t0')).toEqual(['Too few operands for LW; expected: lw $t1,-100($t2) at line 3:1'])
	})

	it('rejects an excess operand', () => {
		expect(messages('add $t0, $t1, $t2, $t3')).toEqual(['Too many operands for ADD; expected: add $t1,$t2,$t3 at line 3:1'])
	})

	it('names an unknown register', () => {
		expect(messages('add $t0, $t1, $nope')).toEqual(['Unknown register: $nope at line 3:1'])
	})

	it('emits nothing for the instruction it rejected', () => {
		const { machineCode } = assembleMips('.text\nmain:\nsll $t2, $t3, 32\nnop\n')

		expect(machineCode).toEqual([0])
	})

	it('encodes every mnemonic the lexer accepts', () => {
		// A5 closed the last encoder gap, so nothing reaches `Unknown instruction`
		// any more; `isaEncoding.test.ts` assembles all 155 basic forms.
		expect(messages('movn $t0, $t1, $t2')).toEqual([])
	})

	// The shapes MARS spells unusually, each a form of its own in the isa table.
	it.each([
		'l.d $f2, ($t2)',
		'jalr $t1',
		'jalr $t1, $t2',
		'break',
		'break 100',
		'bal target',
		'li.s $f0, 1.5',
		'li.d $f2, 1.5',
		'mfc0 $t0, $13',
		'and $t0, 10',
	])('keeps accepting %s', (source) => {
		expect(messages(`${source}\ntarget:\nnop`)).toEqual([])
	})

	it('carries a lexer warning into the assembly result', () => {
		const { diagnostics } = assembleMips('.text\nmain:\nli $t0, 0129\n')

		expect(diagnostics).toHaveLength(1)
		expect(diagnostics[0]).toMatchObject({ severity: 'warning', code: 'leading-zero-literal', line: 3 })
	})
})
