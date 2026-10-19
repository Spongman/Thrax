import type * as Monaco from 'monaco-editor'
import { A64_DIRECTIVES, A64_MNEMONICS } from '../a64/assembler'
import { A64_LANGUAGE_ID, A64_REGISTER_NAMES, a64Configuration, a64Monarch } from './grammar'

let registered = false

export function registerA64Language(monaco: typeof Monaco): Monaco.IDisposable {
	// Monaco language identities are permanent; live providers are disposable.
	if (!registered) {
		monaco.languages.register({ id: A64_LANGUAGE_ID })
		registered = true
	}
	const disposables: Monaco.IDisposable[] = [
		monaco.languages.setLanguageConfiguration(A64_LANGUAGE_ID, a64Configuration),
		monaco.languages.setMonarchTokensProvider(A64_LANGUAGE_ID, a64Monarch),
		monaco.languages.registerCompletionItemProvider(A64_LANGUAGE_ID, {
			provideCompletionItems(model, position) {
				const word = model.getWordUntilPosition(position)
				const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, position.column)
				const { Keyword, Variable, Module } = monaco.languages.CompletionItemKind
				return {
					suggestions: [
						...A64_MNEMONICS.map((name) => ({ label: name, kind: Keyword, insertText: name, range })),
						...A64_REGISTER_NAMES.map((name) => ({ label: name, kind: Variable, insertText: name, range })),
						...A64_DIRECTIVES.map((name) => ({ label: name, kind: Module, insertText: name, range })),
					],
				}
			},
		}),
	]
	return { dispose: () => disposables.splice(0).reverse().forEach((item) => item.dispose()) }
}
