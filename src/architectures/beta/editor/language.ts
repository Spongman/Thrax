import type * as Monaco from 'monaco-editor'
import { UASM_LANGUAGE_ID, UASM_LIBRARY_MACROS, UASM_REGISTERS, uasmConfiguration, uasmMonarch } from './grammar'

import { registerAssemblyLanguage } from '../../../services/assemblyLanguage'

export function registerUasmLanguage(monaco: typeof Monaco): Monaco.IDisposable {
	const { Function, Variable } = monaco.languages.CompletionItemKind
	return registerAssemblyLanguage(monaco, {
		id: UASM_LANGUAGE_ID, extensions: ['.uasm'], configuration: uasmConfiguration, tokens: uasmMonarch,
		completions: [
			...UASM_LIBRARY_MACROS.map((name) => ({ label: name, kind: Function, insertText: name })),
			...UASM_REGISTERS.map((name) => ({ label: name, kind: Variable, insertText: name })),
		],
	})
}
