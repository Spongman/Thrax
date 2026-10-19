import type * as Monaco from 'monaco-editor'
import { UASM_LANGUAGE_ID, UASM_LIBRARY_MACROS, UASM_REGISTERS, uasmConfiguration, uasmMonarch } from './grammar'

let registered = false

export function registerUasmLanguage(monaco: typeof Monaco): Monaco.IDisposable {
	// Monaco language identities are permanent; live providers are disposable.
	if (!registered) {
		monaco.languages.register({ id: UASM_LANGUAGE_ID, extensions: ['.uasm'] })
		registered = true
	}
	const disposables: Monaco.IDisposable[] = [
		monaco.languages.setLanguageConfiguration(UASM_LANGUAGE_ID, uasmConfiguration),
		monaco.languages.setMonarchTokensProvider(UASM_LANGUAGE_ID, uasmMonarch),
		monaco.languages.registerCompletionItemProvider(UASM_LANGUAGE_ID, {
			provideCompletionItems(model, position) {
				const word = model.getWordUntilPosition(position)
				const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, position.column)
				const { Function, Variable } = monaco.languages.CompletionItemKind
				return {
					suggestions: [
						...UASM_LIBRARY_MACROS.map((name) => ({ label: name, kind: Function, insertText: name, range })),
						...UASM_REGISTERS.map((name) => ({ label: name, kind: Variable, insertText: name, range })),
					],
				}
			},
		}),
	]
	return { dispose: () => disposables.splice(0).reverse().forEach((item) => item.dispose()) }
}
