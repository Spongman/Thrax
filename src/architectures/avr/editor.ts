import type * as Monaco from 'monaco-editor'
import type { Disposable, EditorHost } from '../contracts'
import { MNEMONICS } from './isa'

let registered = false

export function installEditor(monaco: typeof Monaco, host: EditorHost): Disposable {
	const parts: Disposable[] = []
	if (!registered) {
		monaco.languages.register({ id: 'avr', extensions: ['.asm', '.s'] })
		registered = true
	}
	parts.push(
		monaco.languages.registerCompletionItemProvider('avr', {
			provideCompletionItems(model, position) {
				const word = model.getWordUntilPosition(position)
				const range = new monaco.Range(
					position.lineNumber,
					word.startColumn,
					position.lineNumber,
					position.column
				)
				return {
					suggestions: MNEMONICS.map((name) => ({
						label: name,
						insertText: name,
						kind: monaco.languages.CompletionItemKind.Keyword,
						range
					}))
				}
			}
		})
	)
	parts.push(
		monaco.languages.setLanguageConfiguration('avr', {
			comments: { lineComment: ';' },
			brackets: [['(', ')']],
			wordPattern: /[A-Za-z_.$][\w.$]*/
		})
	)
	parts.push(
		monaco.languages.setMonarchTokensProvider('avr', {
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
		})
	)
	parts.push(
		monaco.languages.registerHoverProvider('avr', {
			provideHover(model, position) {
				const word = model.getWordAtPosition(position)
				if (!word) return null
				const token = word.word,
					inspection = host.inspection()
				const key = /^r\d+$/i.test(token) ? token.toLowerCase() : token.toUpperCase()
				const value = inspection.registers[key] ?? inspection.labels.get(token)
				if (value === undefined) return null
				return { contents: [{ value: `**${token}** = ${value} (0x${value.toString(16)})` }] }
			}
		})
	)
	return {
		dispose: () =>
			parts
				.splice(0)
				.reverse()
				.forEach((part) => part.dispose())
	}
}
