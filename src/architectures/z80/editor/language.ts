import type * as Monaco from 'monaco-editor'
import { Z80_DIRECTIVES, Z80_LANGUAGE_ID, Z80_MNEMONICS, Z80_REGISTER_WORDS, z80Configuration, z80Monarch } from './grammar'

let registered = false

export function registerZ80Language(monaco: typeof Monaco): Monaco.IDisposable {
	// Monaco language identities are permanent; live providers are disposable.
	if (!registered) {
		monaco.languages.register({ id: Z80_LANGUAGE_ID, extensions: ['.z80'] })
		registered = true
	}
	const disposables: Monaco.IDisposable[] = [
		monaco.languages.setLanguageConfiguration(Z80_LANGUAGE_ID, z80Configuration),
		monaco.languages.setMonarchTokensProvider(Z80_LANGUAGE_ID, z80Monarch),
		monaco.languages.registerCompletionItemProvider(Z80_LANGUAGE_ID, {
			provideCompletionItems(model, position) {
				const word = model.getWordUntilPosition(position)
				const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, position.column)
				const { Keyword, Variable } = monaco.languages.CompletionItemKind
				const lower = (name: string) => name.toLowerCase()
				return {
					suggestions: [
						...[...Z80_MNEMONICS, ...Z80_DIRECTIVES].map((name) => ({ label: lower(name), kind: Keyword, insertText: lower(name), range })),
						...Z80_REGISTER_WORDS.map((name) => ({ label: lower(name), kind: Variable, insertText: lower(name), range })),
					],
				}
			},
		}),
	]
	return { dispose: () => disposables.splice(0).reverse().forEach((item) => item.dispose()) }
}
