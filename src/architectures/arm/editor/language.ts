import type * as Monaco from 'monaco-editor'
import { ARCH_V2A } from '../a32/isa'
import { ARMASM_EXTENSION, GNU_EXTENSIONS } from '../assembler/dialect'
import { ARM_LANGUAGE_ID, armConfiguration, armGrammar } from './grammar'

let registered = false

/** The ARM language as the ARCH_* profile `arch` writes it. */
export function registerArmLanguage(monaco: typeof Monaco, arch = ARCH_V2A): Monaco.IDisposable {
	// Monaco language identities are permanent; live providers are disposable.
	if (!registered) {
		monaco.languages.register({ id: ARM_LANGUAGE_ID, extensions: [...GNU_EXTENSIONS, ARMASM_EXTENSION] })
		registered = true
	}
	const { monarch, completions, registers } = armGrammar(arch)
	const disposables: Monaco.IDisposable[] = [
		monaco.languages.setLanguageConfiguration(ARM_LANGUAGE_ID, armConfiguration),
		monaco.languages.setMonarchTokensProvider(ARM_LANGUAGE_ID, monarch),
		monaco.languages.registerCompletionItemProvider(ARM_LANGUAGE_ID, {
			provideCompletionItems(model, position) {
				const word = model.getWordUntilPosition(position)
				const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, position.column)
				const { Keyword, Variable } = monaco.languages.CompletionItemKind
				return {
					suggestions: [
						...completions.map((name) => ({ label: name, kind: Keyword, insertText: name, range })),
						...registers.map((name) => ({ label: name, kind: Variable, insertText: name, range })),
					],
				}
			},
		}),
	]
	return { dispose: () => disposables.splice(0).reverse().forEach((item) => item.dispose()) }
}
