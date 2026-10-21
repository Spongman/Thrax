import type * as Monaco from 'monaco-editor'
import { NMOS_MODEL, type CpuModel } from '../isa'
import { MOS6502_DIRECTIVES, MOS6502_LANGUAGE_ID, mos6502Configuration, mos6502Monarch } from './grammar'

import { registerAssemblyLanguage } from '../../../services/assemblyLanguage'

export function registerMos6502Language(monaco: typeof Monaco, model: CpuModel = NMOS_MODEL): Monaco.IDisposable {
	const language = model.cmos ? 'ca65-w65c02' : MOS6502_LANGUAGE_ID
	const { Keyword, Function } = monaco.languages.CompletionItemKind
	return registerAssemblyLanguage(monaco, {
		id: language, extensions: model.cmos ? [] : ['.a65', '.s65'], configuration: mos6502Configuration,
		tokens: { ...mos6502Monarch, mnemonics: model.mnemonics.flatMap((name) => [name, name.toLowerCase()]) },
		completions: [
			...model.mnemonics.map((name) => ({ label: name.toLowerCase(), kind: Keyword, insertText: name.toLowerCase() })),
			...MOS6502_DIRECTIVES.map((name) => ({ label: `.${name}`, kind: Function, insertText: `.${name}` })),
		],
	})
}
