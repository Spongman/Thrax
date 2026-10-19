import { describe, it, expect } from 'vitest'
import { Lexer } from '../../assembler/lexer'
import { ItemKind, Parser } from '../../assembler/parser'
import { AssemblyError } from '../../../../core/diagnostics'

function numbers(source: string): string[] {
	return new Lexer(source).tokenize().filter((token) => token.type === 'NUMBER').map((token) => token.value)
}

/** The immediate the parser ends up with, which is what an operand encodes. */
function immediate(literal: string): number {
	const tokens = new Lexer(`li $t0, ${literal}`).tokenize()
	const item = new Parser(tokens).parse().items[0]
	if (item.kind !== ItemKind.Instruction) throw new Error('expected an instruction')
	const argument = item.instruction.args[1]
	if (argument.type !== 'immediate') throw new Error(`"${literal}" is not an immediate`)
	return argument.value
}

describe('number literals', () => {
	it('accepts an upper-case hexadecimal prefix', () => {
		// `Integer.decode`, which `Binary.stringToInt` delegates to, takes 0x and 0X.
		expect(numbers('li $t0, 0XFF')).toEqual(['0XFF'])
		expect(immediate('0XFF')).toBe(immediate('0xff'))
		expect(immediate('0XFF')).toBe(255)
	})

	it('lexes 0XFF as one token, not 0 then an identifier', () => {
		const types = new Lexer('0XFF').tokenize().map((token) => token.type)
		expect(types).toEqual(['NUMBER', 'EOF'])
	})

	it('rejects a hexadecimal prefix with no digits', () => {
		// The real cause of `li $t0, 0x` silently assembling to zero.
		expect(() => new Lexer('li $t0, 0x').tokenize()).toThrow(AssemblyError)
		expect(() => new Lexer('li $t0, 0x').tokenize()).toThrow(/no digits/)
		expect(() => new Lexer('li $t0, 0X').tokenize()).toThrow(/no digits/)
	})

	it('has no binary prefix', () => {
		// `0b1010` is 0 followed by the identifier `b1010`.
		const tokens = new Lexer('0b1010').tokenize()
		expect(tokens[0]).toMatchObject({ type: 'NUMBER', value: '0' })
		expect(tokens[1]).toMatchObject({ type: 'IDENTIFIER', value: 'b1010' })
	})

	it('warns on a leading-zero literal with a digit above 7', () => {
		// A leading zero otherwise means octal; `0129` is read as decimal 129.
		const lexer = new Lexer('li $t0, 0129')
		lexer.tokenize()
		expect(lexer.diagnostics).toHaveLength(1)
		expect(lexer.diagnostics[0]).toMatchObject({ severity: 'warning', code: 'leading-zero-literal', line: 1 })
		expect(lexer.diagnostics[0].message).toMatch(/decimal 129/)
	})

	it('does not warn where the literal already reads as octal', () => {
		for (const source of ['li $t0, 0123', 'li $t0, 0', 'li $t0, 123', 'li $t0, 0x89']) {
			const lexer = new Lexer(source)
			lexer.tokenize()
			expect(lexer.diagnostics, source).toEqual([])
		}
		expect(immediate('0123')).toBe(83)
	})
})
