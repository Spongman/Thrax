import { describe, expect, it } from 'vitest'
import { editor } from '../editor'

type Action = string | { token?: string, next?: string, cases?: Record<string, { token: string, next?: string }> }
type Rule = [RegExp, Action]

/** Just enough of Monarch for this grammar: line-start rules, cases on @directives, @popall and named states. */
function tokenize(lines: string[]): [string, string][][] {
	const tokenizer = editor.tokens.tokenizer as unknown as Record<string, Rule[]>
	const directives = new Set((editor.tokens.directives as string[]).map(name => name.toLowerCase()))
	const stack = ['root']
	return lines.map(text => {
		const tokens: [string, string][] = []
		for (let pos = 0; pos <= text.length;) {
			let matched = false
			for (const [pattern, action] of tokenizer[stack[stack.length - 1]]) {
				const source = pattern.source.startsWith('^') ? pattern.source.slice(1) : pattern.source
				if (pattern.source.startsWith('^') && pos > 0) continue
				const match = new RegExp(`^(?:${source})`, 'i').exec(text.slice(pos))
				if (!match) continue
				let token = typeof action === 'string' ? action : action.token ?? '', next = typeof action === 'string' ? undefined : action.next
				if (typeof action !== 'string' && action.cases) {
					const chosen = directives.has(match[0].toLowerCase()) ? action.cases['@directives'] : action.cases['@default']
					token = chosen.token; next = chosen.next
				}
				if (!match[0] && !next) continue
				if (next === '@popall') stack.splice(1)
				else if (next) stack.push(next.slice(1))
				if (match[0]) tokens.push([match[0], token])
				pos += match[0].length
				matched = true
				break
			}
			if (!matched) { if (pos >= text.length) break; throw new Error(`No rule at ${pos} of ${text}`) }
		}
		return tokens.filter(([, token]) => token !== 'white')
	})
}

describe('System/360 editor grammar', () => {
	it('tokenizes the name, operation, operands and remarks fields', () => {
		const [comment, statement, directive, constant, next] = tokenize([
			'* a comment line',
			"LOOP     MVC   0(8,1),=C'A B'     move it",
			'         USING *,12',
			"MSG      DC    AL2(L'MSG),CL8' '",
			'         BR    14',
		])
		expect(comment).toEqual([['* a comment line', 'comment']])
		expect(statement).toEqual([['LOOP', 'type.identifier'], ['MVC', 'keyword'], ['0', 'number'], ['(', 'delimiter'], ['8', 'number'], [',', 'delimiter'], ['1', 'number'], [')', 'delimiter'], [',', 'delimiter'], ['=', 'operator'], ["C'A B'", 'string'], ['     move it', 'comment']])
		expect(directive).toEqual([['USING', 'keyword.directive'], ['*', 'operator'], [',', 'delimiter'], ['12', 'number']])
		expect(constant.slice(0, 7)).toEqual([['MSG', 'type.identifier'], ['DC', 'keyword.directive'], ['AL2', 'identifier'], ['(', 'delimiter'], ["L'", 'operator'], ['MSG', 'identifier'], [')', 'delimiter']])
		expect(next).toEqual([['BR', 'keyword'], ['14', 'number']])
	})

	it('finds column-1 definitions and GNU-style .equ', () => {
		const [label, equ] = editor.definitions('LOOP')
		expect(label.exec('LOOP     BCT   1,LOOP')?.index).toBe(0)
		expect(label.exec('         B     LOOP')).toBeNull()
		expect(equ.exec('.equ LOOP, 4')?.[1]).toBe('.equ ')
	})
})
