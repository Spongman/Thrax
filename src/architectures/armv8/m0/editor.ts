import { describeM0Token } from './dataTips'
import { disposableGroup } from '../../../core/disposableScope'
import { registerAssemblyLanguage, registerTokenHover } from '../../../services/assemblyLanguage'
import type * as Monaco from 'monaco-editor'
import { armConfiguration } from '../../arm/editor/grammar'
import type { EditorHost } from '../../contracts'
import { MNEMONICS as mnemonics, LANGUAGE, SPECIAL } from './isa'

/** Share ARM punctuation/configuration; keep M0 completions separate from A32. */
export function installM0Editor(monaco: typeof Monaco, host: EditorHost) {

	return disposableGroup((scope) => {
		scope.add(registerAssemblyLanguage(monaco, {
			id: LANGUAGE, configuration: armConfiguration,
			tokens: {
			ignoreCase: true,
			mnemonics,
			tokenizer: {
				root: [
					[/@.*$|\/\/.*$/, 'comment'],
					[/"([^"\\]|\\.)*"/, 'string'],
					[/\b(?:r(?:[0-9]|1[0-5])|sp|lr|pc|apsr|xpsr|msp|psp|control|primask)\b/, 'variable'],
					[/\.[a-z][\w.]*/, 'keyword'],
					[/\b(?:0x[\da-f]+|\d+)\b/, 'number'],
					[/[\w.$]+:/, 'type.identifier'],
					[/[a-z][\w.]*/, { cases: { '@mnemonics': 'keyword', '@default': 'identifier' } }],
				],
			},
		},
			completions: [...mnemonics, ...Object.keys(SPECIAL)].map((label) => ({
				label, insertText: label, kind: monaco.languages.CompletionItemKind.Keyword,
			})),
		}))
		scope.add(registerTokenHover(monaco, LANGUAGE, (line, offset) => describeM0Token(line, offset, host.inspection())))
	})
}
