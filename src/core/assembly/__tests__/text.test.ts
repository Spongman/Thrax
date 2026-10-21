import { describe, expect, it } from 'vitest'
import { splitOperands, stripAssemblyComment } from '../text'
import { integerArithmetic } from '../integerArithmetic'
import { Op } from '../expressions'
import { visitSourceLines } from '../sourceLines'

describe('configurable assembler helpers', () => {
	it('keeps comment markers, commas and escaped quotes inside literals', () => {
		expect(stripAssemblyComment('db "a;\\"b", \';\' ; comment', [';'])).toBe('db "a;\\"b", \';\' ')
		expect(stripAssemblyComment('ldr r0, ="x//y" // comment', ['@', '//'])).toBe('ldr r0, ="x//y" ')
		expect(stripAssemblyComment("ex af,af' ; comment", [';'], true)).toBe("ex af,af' ")
		expect(splitOperands('r0, [r1, #4], {r2,r3}, "a,b", \',\'', { brackets: ['()', '[]', '{}'], unclosed: 'bad operand' })).toEqual(['r0', '[r1, #4]', '{r2,r3}', '"a,b"', "','"])
		expect(() => splitOperands('[r1, #4)', { brackets: ['()', '[]'], unclosed: 'bad operand' })).toThrow('bad operand')
	})

	it('keeps signed/logical shifts distinct and positions zero-division errors', () => {
		const at = { file: 'main.s', line: 3, column: 9 }
		expect(integerArithmetic.binary(Op.Div, -7, 2, at)).toBe(-3)
		expect(integerArithmetic.binary(Op.Sar, -1, 1, at)).toBe(-1)
		expect(integerArithmetic.binary(Op.Shr, -1, 1, at)).toBe(0x7fffffff)
		expect(() => integerArithmetic.binary(Op.Mod, 1, 0, at)).toThrow('Division by zero')
	})

	it('visits repeated relative includes in order and applies traversal bounds', () => {
		const files = [{ name: 'dir/main', code: '@lib\n@lib\nend' }, { name: 'lib', code: 'wrong' }, { name: 'dir/lib', code: 'local' }]
		const seen: string[] = []
		visitSourceLines(files, 'dir/main', { expansions: 3, depth: 2, lines: 8 }, line => {
			if (line.text.startsWith('@')) return line.text.slice(1)
			seen.push(`${line.at.file}:${line.at.line}:${line.text}`)
		})
		expect(seen).toEqual(['dir/lib:1:local', 'dir/lib:1:local', 'dir/main:3:end'])
		expect(() => visitSourceLines(files, 'dir/main', { expansions: 2, depth: 2, lines: 8 }, line => line.text.startsWith('@') ? line.text.slice(1) : undefined)).toThrow('limit')
		expect(() => visitSourceLines([{ name: 'self', code: '@self' }], 'self', { expansions: 10, depth: 10, lines: 10 }, () => 'self')).toThrow('Recursive include')
	})
})
