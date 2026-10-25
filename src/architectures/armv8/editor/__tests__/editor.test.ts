import { describe, expect, it } from 'vitest'
import { EMPTY_MEMORY, type DebugInspection, type MemoryInspector } from '../../../contracts'
import { describeA64Token } from '../dataTips'
import { findA64Definition } from '../definition'
import { a64Monarch } from '../grammar'

type Rule = [RegExp, string | { cases: Record<string, string> }, string?]

/** Just enough of Monarch to run this grammar: ordered rules, cases on word lists, @push and @pop. */
function tokenize(lines: string[]): [string, string][][] {
	const tokenizer = a64Monarch.tokenizer as unknown as Record<string, Rule[]>
	const lists = a64Monarch as unknown as Record<string, string[]>
	const stack = ['root']
	return lines.map((line) => {
		const tokens: [string, string][] = []
		let index = 0
		while (index < line.length) {
			let matched = false
			for (const [pattern, action, next] of tokenizer[stack[stack.length - 1]]) {
				const sticky = new RegExp(pattern.source, 'y')
				sticky.lastIndex = index
				const match = sticky.exec(line)
				if (!match || match[0] === '') continue
				let token: string
				if (typeof action === 'string') token = action === '@brackets' ? 'delimiter.bracket' : action
				else {
					const list = Object.keys(action.cases).find((key) => key !== '@default' && lists[key.slice(1)].includes(match[0].toLowerCase()))
					token = action.cases[list ?? '@default']
				}
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

describe('A64 editor language', () => {
	it('colours mnemonics, registers, labels, directives and comments', () => {
		const [first, second, third] = tokenize([
			'loop:\tldr x0, [sp, #8]   // load',
			'\tb.eq loop',
			'\t.quad 0x10\n',
		])
		expect(first).toEqual([
			['loop', 'type'], [':', 'operator'], ['ldr', 'keyword'], ['x0', 'variable'], [',', 'operator'], ['[', 'delimiter.bracket'],
			['sp', 'variable'], [',', 'operator'], ['#', 'operator'], ['8', 'number'], [']', 'delimiter.bracket'], ['// load', 'comment'],
		])
		expect(second).toEqual([['b.eq', 'keyword'], ['loop', 'identifier']])
		expect(third.slice(0, 2)).toEqual([['.quad', 'keyword.directive'], ['0x10', 'number.hex']])
	})

	it('reads :lo12: as one keyword and 1f as a label', () => {
		const [line] = tokenize(['\tadd x0, x0, :lo12:message', ])
		expect(line).toContainEqual([':lo12:', 'keyword'])
		const [local] = tokenize(['\tcbz w1, 1f'])
		expect(local).toContainEqual(['1f', 'type'])
	})
})

describe('A64 go to definition', () => {
	const files = [
		{ name: 'main.s', code: '// start: not this\n_start:\tbl helper\nouter: inner:\tnop\n\t.equ COUNT, 3\nLIMIT = 10\n\t.macro push reg\n\t.endm\n' },
		{ name: 'lib.s', code: 'helper:\n\tret\n' },
	]

	it('finds labels, symbols and macros', () => {
		expect(findA64Definition(files, '_start')).toEqual({ file: 'main.s', line: 2, column: 1, endColumn: 7 })
		expect(findA64Definition(files, 'inner')).toEqual({ file: 'main.s', line: 3, column: 8, endColumn: 13 })
		expect(findA64Definition(files, 'COUNT')).toMatchObject({ line: 4, column: 7 })
		expect(findA64Definition(files, 'LIMIT')).toMatchObject({ line: 5, column: 1 })
		expect(findA64Definition(files, 'push')).toMatchObject({ line: 6, column: 9 })
		expect(findA64Definition(files, 'helper')).toMatchObject({ file: 'lib.s', line: 1 })
		expect(findA64Definition(files, 'start')).toBeNull()
	})
})

describe('A64 data tips', () => {
	const words = new Map([[0x420000, 0x89ABCDEF], [0x420004, 0x01234567]])
	const memory: MemoryInspector = { ...EMPTY_MEMORY, word: (address) => words.get(address) }
	const inspection: DebugInspection = {
		registers: { X1: 0xFFFF_FFFF_0000_0005n, SP: 0x41FFF8n },
		memory,
		labels: new Map([['table', 0x420000]]),
	}

	it('shows X registers at 64 bits and W registers at 32', () => {
		expect(describeA64Token('\tmov x0, x1', 9, inspection)).toMatchObject({ register: 'X1', contents: ['**X1**\n\n`0xFFFFFFFF00000005 (-4294967291, unsigned 18446744069414584325)`'] })
		expect(describeA64Token('\tmov w0, w1', 9, inspection)).toMatchObject({ register: 'W1', contents: ['**W1**\n\n`0x00000005 (5, unsigned 5)`'] })
		expect(describeA64Token('\tmov x0, xzr', 10, inspection)?.contents[0]).toContain('always 0')
	})

	it('works out an effective address and what is there', () => {
		const tip = describeA64Token('\tldr x0, [sp, #8]', 13, inspection)
		expect(tip).toMatchObject({ register: 'SP', address: 0x420000 })
		expect(tip?.contents[2]).toBe('`[0x00420000]` = `0x0123456789ABCDEF (81985529216486895, unsigned 81985529216486895)`')
	})

	it('names labels and numbers, and leaves comments alone', () => {
		expect(describeA64Token('\tldr x0, =table', 11, inspection)).toMatchObject({ address: 0x420000 })
		expect(describeA64Token('\tb 0x00420000', 4, inspection)?.contents[0]).toContain('**table**')
		expect(describeA64Token('\tmov x0, #1 // x1', 15, inspection)).toBeNull()
	})
})

describe('A64 floating point in the editor', () => {
	it('colours FP registers, system registers and real numbers', () => {
		const [line] = tokenize(['\tfmadd d0, d1, s2, q31 // x', ])
		expect(line.filter(([, token]) => token === 'variable').map(([text]) => text)).toEqual(['d0', 'd1', 's2', 'q31'])
		const [move] = tokenize(['\tfmov s0, #-2.5e3'])
		expect(move).toContainEqual(['2.5e3', 'number.float'])
		const [system] = tokenize(['\tmrs x0, fpcr'])
		expect(system).toContainEqual(['fpcr', 'variable'])
	})

	it('shows S and D registers as floats from the V register', () => {
		const inspection: DebugInspection = { registers: { V2: 0x3FC00000, 'V2:hi': 0, V3: 0, 'V3:hi': 0xC0040000 }, memory: EMPTY_MEMORY, labels: new Map() }
		expect(describeA64Token('\tfadd s0, s2, s2', 10, inspection)).toMatchObject({ register: 'V2', contents: ['**S2 (V2)**\n\n`1.5 (0x3FC00000)`'] })
		expect(describeA64Token('\tfadd d0, d3, d3', 10, inspection)).toMatchObject({ register: 'V3', contents: ['**D3 (V3)**\n\n`-2.5 (0xC004000000000000)`'] })
		expect(describeA64Token('\tfsqrt d0, d3', 1, inspection)?.contents.join()).toMatch(/Square root/)
	})
})
