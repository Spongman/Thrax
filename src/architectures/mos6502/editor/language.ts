import type * as Monaco from 'monaco-editor'
import { MNEMONICS } from '../isa'
import { MOS6502_DIRECTIVES, MOS6502_LANGUAGE_ID, mos6502Configuration, mos6502Monarch } from './grammar'

let registered = false

export function registerMos6502Language(monaco: typeof Monaco): Monaco.IDisposable {
	// Monaco language identities are permanent; live providers are disposable.
	if (!registered) {
		monaco.languages.register({ id: MOS6502_LANGUAGE_ID, extensions: ['.a65', '.s65'] })
		registered = true
	}
	const disposables: Monaco.IDisposable[] = [
		monaco.languages.setLanguageConfiguration(MOS6502_LANGUAGE_ID, mos6502Configuration),
		monaco.languages.setMonarchTokensProvider(MOS6502_LANGUAGE_ID, mos6502Monarch),
		monaco.languages.registerCompletionItemProvider(MOS6502_LANGUAGE_ID, {
			provideCompletionItems(model, position) {
				const word = model.getWordUntilPosition(position)
				const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, position.column)
				const { Keyword, Function } = monaco.languages.CompletionItemKind
				return {
					suggestions: [
						...MNEMONICS.map((name) => ({ label: name.toLowerCase(), kind: Keyword, insertText: name.toLowerCase(), range })),
						...MOS6502_DIRECTIVES.map((name) => ({ label: `.${name}`, kind: Function, insertText: `.${name}`, range })),
					],
				}
			},
		}),
	]
	return { dispose: () => disposables.splice(0).reverse().forEach((item) => item.dispose()) }
}
