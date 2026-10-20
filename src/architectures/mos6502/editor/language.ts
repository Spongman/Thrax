import type * as Monaco from 'monaco-editor'
import { NMOS_MODEL, type CpuModel } from '../isa'
import { MOS6502_DIRECTIVES, MOS6502_LANGUAGE_ID, mos6502Configuration, mos6502Monarch } from './grammar'

const registered = new Set<string>()

export function registerMos6502Language(monaco: typeof Monaco, model: CpuModel = NMOS_MODEL): Monaco.IDisposable {
	const language = model.cmos ? 'ca65-w65c02' : MOS6502_LANGUAGE_ID
	// Monaco language identities are permanent; live providers are disposable.
	if (!registered.has(language)) {
		monaco.languages.register({ id: language, extensions: model.cmos ? [] : ['.a65', '.s65'] })
		registered.add(language)
	}
	const disposables: Monaco.IDisposable[] = [
		monaco.languages.setLanguageConfiguration(language, mos6502Configuration),
		monaco.languages.setMonarchTokensProvider(language, { ...mos6502Monarch, mnemonics: model.mnemonics.flatMap(name => [name, name.toLowerCase()]) }),
		monaco.languages.registerCompletionItemProvider(language, {
			provideCompletionItems(textModel, position) {
				const word = textModel.getWordUntilPosition(position)
				const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, position.column)
				const { Keyword, Function } = monaco.languages.CompletionItemKind
				return {
					suggestions: [
						...model.mnemonics.map((name) => ({ label: name.toLowerCase(), kind: Keyword, insertText: name.toLowerCase(), range })),
						...MOS6502_DIRECTIVES.map((name) => ({ label: `.${name}`, kind: Function, insertText: `.${name}`, range })),
					],
				}
			},
		}),
	]
	return { dispose: () => disposables.splice(0).reverse().forEach((item) => item.dispose()) }
}
