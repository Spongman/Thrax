import { describe, expect, it } from 'vitest'
import { findUasmDefinition, uasmSymbolAt } from '../editor/definition'
import { UASM_LIBRARY_MACROS, uasmMonarch } from '../editor/grammar'
import { BetaSourceIndex } from '../sourceIndex'
import { assembleUasm, betaLibrary } from '../uasm'

type Rule = [RegExp, string | { cases: Record<string, string> }, string?]

/** Just enough of Monarch to run this grammar: ordered rules, cases on @macros, @push and @pop. */
function tokenize(lines: string[]): [string, string][][] {
	const tokenizer = uasmMonarch.tokenizer as unknown as Record<string, Rule[]>
	const macros = new Set(uasmMonarch.macros as string[])
	const stack = ['root']
	return lines.map((line) => {
		const tokens: [string, string][] = []
		let index = 0
		while (index < line.length) {
			const rules = tokenizer[stack[stack.length - 1]]
			let matched = false
			for (const [pattern, action, next] of rules) {
				const sticky = new RegExp(pattern.source, 'y')
				sticky.lastIndex = index
				const match = sticky.exec(line)
				if (!match || match[0] === '') continue
				const token = typeof action === 'string'
					? action === '@brackets' ? 'delimiter.bracket' : action
					: macros.has(match[0]) ? action.cases['@macros'] : action.cases['@default']
				if (token !== 'white') tokens.push([match[0], token])
				if (next === '@pop') stack.pop()
				else if (next) stack.push(next.slice(1))
				index += match[0].length
				matched = true
				break
			}
			if (!matched) throw new Error(`No rule at ${index} of ${line}`)
		}
		return tokens
	})
}

describe('UASM grammar', () => {
	it('knows the library macros', () => {
		for (const name of ['ADD', 'ADDC', 'BR', 'CALL', 'RTN', 'PUSH', 'WRCHAR', 'LONG', 'betaopc']) expect(UASM_LIBRARY_MACROS).toContain(name)
	})

	it('tokenizes registers, numbers, labels, directives and calls', () => {
		const [line] = tokenize(['loop: ADDC(R31, 0x1F, SP) BEQ(r3, done, LP) MY(0b101, 017, 9)'])
		expect(line).toEqual([
			['loop', 'type'], [':', 'operator'],
			['ADDC', 'keyword'], ['(', 'delimiter.bracket'], ['R31', 'variable'], [',', 'operator'], ['0x1F', 'number.hex'], [',', 'operator'], ['SP', 'variable'], [')', 'delimiter.bracket'],
			['BEQ', 'keyword'], ['(', 'delimiter.bracket'], ['r3', 'variable'], [',', 'operator'], ['done', 'identifier'], [',', 'operator'], ['LP', 'variable'], [')', 'delimiter.bracket'],
			['MY', 'function'], ['(', 'delimiter.bracket'], ['0b101', 'number.binary'], [',', 'operator'], ['017', 'number.octal'], [',', 'operator'], ['9', 'number'], [')', 'delimiter.bracket'],
		])
	})

	it('tokenizes directives, strings, characters and the location counter', () => {
		const lines = tokenize(['.include "beta.uasm"', '.options tty', 'msg: .text "a\\n"', '. = .+4', "CMOVE('\\n', R0)"])
		expect(lines[0]).toEqual([['.include', 'keyword.directive'], ['"', 'string'], ['beta.uasm', 'string'], ['"', 'string']])
		expect(lines[1]).toEqual([['.options', 'keyword.directive'], ['tty', 'identifier']])
		expect(lines[2].slice(2)).toEqual([['.text', 'keyword.directive'], ['"', 'string'], ['a', 'string'], ['\\n', 'string.escape'], ['"', 'string']])
		expect(lines[3]).toEqual([['.', 'keyword'], ['=', 'operator'], ['.', 'keyword'], ['+', 'operator'], ['4', 'number']])
		expect(lines[4][2]).toEqual(["'\\n'", 'string'])
		expect(tokenize(['.macro M(X) { X }'])[0][0]).toEqual(['.macro', 'keyword.directive'])
	})

	it('tokenizes line and block comments across lines', () => {
		const lines = tokenize(['ADD(R1, R2, R3) // sum', '/* one', 'two */ R4'])
		expect(lines[0][lines[0].length - 1]).toEqual(['// sum', 'comment'])
		expect(lines[1]).toEqual([['/*', 'comment'], [' one', 'comment']])
		expect(lines[2]).toEqual([['two ', 'comment'], ['*/', 'comment'], ['R4', 'variable']])
	})

	it('does not read a longer name as a register', () => {
		expect(tokenize(['R32 R1x SPACE'])[0].map(([, token]) => token)).toEqual(['identifier', 'identifier', 'identifier'])
	})
})

describe('UASM goto-definition', () => {
	const main = { name: 'main.uasm', code: '.include "lib.uasm"\n// start: not here\nCOUNT = 3\nstart:\tTWICE(R1)\n\tBR(start)\n' }
	const lib = { name: 'lib.uasm', code: '.include "beta.uasm" /* .macro TWICE(X) */\n.macro TWICE(X) { ADDC(X, 1, X) ADDC(X, 1, X) }\n' }

	it('finds the name under the cursor', () => {
		expect(uasmSymbolAt('\tBR(start)', 5)).toBe('start')
		expect(uasmSymbolAt('\tBR(start)', 4)).toBeNull()
	})

	it('finds labels, symbols and macros, skipping comments', () => {
		expect(findUasmDefinition([main, lib], 'start')).toEqual({ file: 'main.uasm', line: 4, column: 1, endColumn: 6 })
		expect(findUasmDefinition([main, lib], 'COUNT')).toEqual({ file: 'main.uasm', line: 3, column: 1, endColumn: 6 })
		expect(findUasmDefinition([main, lib], 'TWICE')).toEqual({ file: 'lib.uasm', line: 2, column: 8, endColumn: 13 })
		expect(findUasmDefinition([main, lib], 'nowhere')).toBeNull()
	})

	it('falls back to the source index for library macros', () => {
		const { image, diagnostics } = assembleUasm(main, { files: [lib] })
		expect(diagnostics).toEqual([])
		const index = new BetaSourceIndex(image!)
		expect(findUasmDefinition([main], 'ADDC')).toBeNull()
		const found = findUasmDefinition([main], 'ADDC', index)!
		expect(found.file).toBe(betaLibrary.name)
		expect(betaLibrary.code.split('\n')[found.line - 1]).toMatch(/^\.macro ADDC\(/)
	})
})
