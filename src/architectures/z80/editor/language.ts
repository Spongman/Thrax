import type * as Monaco from 'monaco-editor'
import { Z80_DIRECTIVES, Z80_LANGUAGE_ID, Z80_MNEMONICS, Z80_REGISTER_WORDS, z80Configuration, z80Monarch } from './grammar'

import { registerAssemblyLanguage } from '../../../services/assemblyLanguage'

export function registerZ80Language(monaco: typeof Monaco): Monaco.IDisposable {
	const { Keyword, Variable } = monaco.languages.CompletionItemKind
	const lower = (name: string) => name.toLowerCase()
	return registerAssemblyLanguage(monaco, {
		id: Z80_LANGUAGE_ID, extensions: ['.z80'], configuration: z80Configuration, tokens: z80Monarch,
		completions: [
			...[...Z80_MNEMONICS, ...Z80_DIRECTIVES].map((name) => ({ label: lower(name), kind: Keyword, insertText: lower(name) })),
			...Z80_REGISTER_WORDS.map((name) => ({ label: lower(name), kind: Variable, insertText: lower(name) })),
		],
	})
}
