import type * as Monaco from 'monaco-editor'
import { A64_DIRECTIVES, A64_MNEMONICS } from '../a64/assembler'
import { A64_LANGUAGE_ID, A64_REGISTER_NAMES, a64Configuration, a64Monarch } from './grammar'

import { registerAssemblyLanguage } from '../../../services/assemblyLanguage'

export function registerA64Language(monaco: typeof Monaco): Monaco.IDisposable {
	const { Keyword, Variable, Module } = monaco.languages.CompletionItemKind
	return registerAssemblyLanguage(monaco, {
		id: A64_LANGUAGE_ID, configuration: a64Configuration, tokens: a64Monarch,
		completions: [
			...A64_MNEMONICS.map((name) => ({ label: name, kind: Keyword, insertText: name })),
			...A64_REGISTER_NAMES.map((name) => ({ label: name, kind: Variable, insertText: name })),
			...A64_DIRECTIVES.map((name) => ({ label: name, kind: Module, insertText: name })),
		],
	})
}
