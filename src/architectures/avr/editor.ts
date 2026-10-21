import { stripAssemblyComment } from '../../core/assembly/text'
import type * as Monaco from 'monaco-editor'
import type { DebugInspection, EditorHost, TokenDescription } from '../contracts'
import { disposableGroup } from '../../core/disposableScope'
import { registerAssemblyLanguage, registerTokenHover } from '../../services/assemblyLanguage'
import { MNEMONICS } from './isa'
import { avrInstructionHelp } from './instructionHelp'

export function describeAvrToken(line: string, offset: number, state: DebugInspection): TokenDescription | null {
	const comment = stripAssemblyComment(line, [';']).length
	if (comment >= 0 && offset >= comment) return null
	for (const match of line.matchAll(/[A-Za-z_.$][\w.$]*/g)) {
		if (offset < match.index || offset >= match.index + match[0].length) continue
		const token = match[0], span = { start: match.index, length: token.length }
		const key = /^r\d+$/i.test(token) ? token.toLowerCase() : token.toUpperCase()
		const value = state.registers[key]
		if (value !== undefined) return { ...span, register: key, contents: [`**${token}** = ${value} (0x${value.toString(16)})`] }
		const address = state.labels.get(token)
		if (address !== undefined) return { ...span, address, contents: [`**${token}** = ${address} (0x${address.toString(16)})`] }
		const contents = avrInstructionHelp(token)
		return contents ? { ...span, ...contents } : null
	}
	return null
}

export function installEditor(monaco: typeof Monaco, host: EditorHost) {
	return disposableGroup((scope) => {
		scope.add(registerAssemblyLanguage(monaco, {
			id: 'avr', extensions: ['.asm', '.s'],
			configuration: { comments: { lineComment: ';' }, brackets: [['(', ')']], wordPattern: /[A-Za-z_.$][\w.$]*/ },
			tokens: {
			ignoreCase: true,
			mnemonics: MNEMONICS,
			tokenizer: {
				root: [
					[/;.*$/, 'comment'],
					[/\.[A-Za-z]+/, 'keyword.directive'],
					[/\br(?:[12]?\d|3[01])\b/i, 'variable'],
					[/\b(?:PC|SP|SREG|X|Y|Z)\b/i, 'variable'],
					[/\b(?:0x[\da-f]+|0b[01]+|\d+)\b/i, 'number'],
					[/[A-Za-z_.$][\w.$]*/, { cases: { '@mnemonics': 'keyword', '@default': 'identifier' } }]
				]
			}
		},
			completions: MNEMONICS.map((name) => ({ label: name, insertText: name, kind: monaco.languages.CompletionItemKind.Keyword })),
		}))
		scope.add(registerTokenHover(monaco, 'avr', (line, offset) => describeAvrToken(line, offset, host.inspection())))
	})
}
