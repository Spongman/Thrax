import type * as Monaco from 'monaco-editor'
import { ARMASM_EXTENSION, GNU_EXTENSIONS } from '../assembler/dialect'
import { ARM_COMPLETIONS, ARM_LANGUAGE_ID, ARM_REGISTERS, armConfiguration, armMonarch } from './grammar'

let registered = false

export function registerArmLanguage(monaco: typeof Monaco): Monaco.IDisposable {
	// Monaco language identities are permanent; live providers are disposable.
	if (!registered) {
		monaco.languages.register({ id: ARM_LANGUAGE_ID, extensions: [...GNU_EXTENSIONS, ARMASM_EXTENSION] })
		registered = true
	}
	const disposables: Monaco.IDisposable[] = [
		monaco.languages.setLanguageConfiguration(ARM_LANGUAGE_ID, armConfiguration),
		monaco.languages.setMonarchTokensProvider(ARM_LANGUAGE_ID, armMonarch),
		monaco.languages.registerCompletionItemProvider(ARM_LANGUAGE_ID, {
			provideCompletionItems(model, position) {
				const word = model.getWordUntilPosition(position)
				const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, position.column)
				const { Keyword, Variable } = monaco.languages.CompletionItemKind
				return {
					suggestions: [
						...ARM_COMPLETIONS.map((name) => ({ label: name, kind: Keyword, insertText: name, range })),
						...ARM_REGISTERS.map((name) => ({ label: name, kind: Variable, insertText: name, range })),
					],
				}
			},
		}),
	]
	return { dispose: () => disposables.splice(0).reverse().forEach((item) => item.dispose()) }
}
