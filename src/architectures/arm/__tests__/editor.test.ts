import { describe, expect, it } from 'vitest'
import type { DebugInspection } from '../../contracts'
import { describeArmToken } from '../editor/dataTips'
import { armSymbolAt, findArmDefinition } from '../editor/definition'
import { armMonarch } from '../editor/grammar'

type Action = string | { cases: Record<string, string> }
type Rule = [RegExp, Action, string?]

/** Enough of Monarch for this grammar: ordered rules, ignoreCase, `^` at line start, cases, @push and @pop. */
function tokenize(lines: string[]): [string, string][][] {
	const tokenizer = armMonarch.tokenizer as unknown as Record<string, Rule[]>
	const lists: Record<string, Set<string>> = {
		'@registers': new Set(armMonarch.registers as string[]),
		'@armasmDirectives': new Set(armMonarch.armasmDirectives as string[]),
	}
	const stack = ['root']
	return lines.map((line) => {
		const tokens: [string, string][] = []
		let index = 0
		while (index < line.length) {
			let matched = false
			for (const [pattern, action, next] of tokenizer[stack[stack.length - 1]]) {
				const atStart = pattern.source.startsWith('^')
				if (atStart && index > 0) continue
				const sticky = new RegExp(atStart ? pattern.source.slice(1) : pattern.source, 'yi')
				sticky.lastIndex = index
				const match = sticky.exec(line)
				if (!match || match[0] === '') continue
				let token = typeof action === 'string' ? action : action.cases['@default']
				if (typeof action !== 'string') {
					for (const [list, value] of Object.entries(action.cases)) if (lists[list]?.has(match[0].toLowerCase())) { token = value; break }
				}
				if (token === '@brackets') token = 'delimiter.bracket'
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

describe('ARM grammar', () => {
	it('tokenizes GNU lines', () => {
		const [line] = tokenize(['loop:\tldmeqfd sp!, {r0-r3, pc}^  @ return'])
		expect(line).toEqual([
			['loop', 'type'], [':', 'operator'], ['ldmeqfd', 'keyword'], ['sp', 'variable'], ['!', 'operator'], [',', 'operator'],
			['{', 'delimiter.bracket'], ['r0', 'variable'], ['-', 'operator'], ['r3', 'variable'], [',', 'operator'], ['pc', 'variable'],
			['}', 'delimiter.bracket'], ['^', 'operator'], ['@ return', 'comment'],
		])
		expect(tokenize(['\t.asciz "hi\\n"'])[0]).toEqual([['.asciz', 'keyword.directive'], ['"', 'string'], ['hi', 'string'], ['\\n', 'string.escape'], ['"', 'string']])
		expect(tokenize(['\tmov r0, #0x1F']).flat()).toContainEqual(['0x1F', 'number.hex'])
	})

	it('tokenizes armasm lines, labels in column 1', () => {
		const [line] = tokenize(['start\tADDSEQ R0, R0, #&FF ; comment'])
		expect(line).toEqual([
			['start', 'type'], ['ADDSEQ', 'keyword'], ['R0', 'variable'], [',', 'operator'], ['R0', 'variable'], [',', 'operator'],
			['#', 'operator'], ['&FF', 'number.hex'], ['; comment', 'comment'],
		])
		expect(tokenize(['\tAREA Main, CODE'])[0].slice(0, 2)).toEqual([['AREA', 'keyword.directive'], ['Main', 'identifier']])
	})
})

describe('ARM go to definition', () => {
	const files = [{ name: 'a.s', code: '\t.equ COUNT, 3\nloop:\tb loop @ loop: here\n' }, { name: 'b.armasm', code: 'start\tMOV r0, #1\nN\tEQU 4\n' }]

	it('finds GNU labels and equates, and armasm column-1 names', () => {
		expect(findArmDefinition(files, 'loop')).toMatchObject({ file: 'a.s', line: 2, column: 1 })
		expect(findArmDefinition(files, 'COUNT')).toMatchObject({ file: 'a.s', line: 1, column: 7 })
		expect(findArmDefinition(files, 'start')).toMatchObject({ file: 'b.armasm', line: 1, column: 1 })
		expect(findArmDefinition(files, 'N')).toMatchObject({ file: 'b.armasm', line: 2 })
		expect(armSymbolAt('\tbl print_decimal', 6)).toBe('print_decimal')
	})
})

describe('ARM data tips', () => {
	const state: DebugInspection = {
		registers: { R1: 5, R13: 0x100000, PC: 0x8004 },
		memory: { wordBytes: 4, littleEndian: true, byte: () => undefined, word: (address) => address === 0x8010 ? 0xCAFE : undefined },
		labels: new Map([['loop', 0x8010]]),
	}
	const tip = (line: string, text: string) => describeArmToken(line, line.indexOf(text), state, { value: (name) => name === 'COUNT' ? 3 : undefined })

	it('shows registers by number, APCS name and as PC', () => {
		expect(tip('\tadd r1, r1, #1', 'r1')).toMatchObject({ register: 'R1', contents: ['**R1**\n\n`0x00000005 (5, unsigned 5)`'] })
		expect(tip('\tldmfd sp!, {pc}', 'sp')).toMatchObject({ register: 'R13', contents: [expect.stringContaining('R13 (SP)')] })
		expect(tip('\tmov r0, pc', 'pc')).toMatchObject({ register: 'PC' })
	})

	it('shows labels, symbols and numbers, and nothing in a comment', () => {
		expect(tip('\tb loop', 'loop')).toMatchObject({ address: 0x8010, contents: ['**Label loop**\n\n`0x00008010`', expect.stringContaining('0x0000CAFE')] })
		expect(tip('b 0x00008010', '0x00008010')).toMatchObject({ address: 0x8010 })
		expect(tip('\tmov r0, #COUNT', 'COUNT')?.contents[0]).toBe('**COUNT**\n\n`0x00000003 (3, unsigned 3)`')
		expect(tip('\tmov r0, #&FF', '&FF')?.contents[0]).toContain('255')
		expect(tip('\tnop @ r1', 'r1')).toBeNull()
		expect(tip('\tNOP ; r1', 'r1')).toBeNull()
	})
})
