import type * as Monaco from 'monaco-editor'
import { ARCH_V2A } from '../a32/isa'
import { ARMASM_EXTENSION, GNU_EXTENSIONS } from '../assembler/dialect'
import { ARM_LANGUAGE_ID, armConfiguration, armGrammar } from './grammar'

import { registerAssemblyLanguage } from '../../../../services/assemblyLanguage'

export function registerArmLanguage(monaco: typeof Monaco, arch = ARCH_V2A, language = ARM_LANGUAGE_ID): Monaco.IDisposable {
	const { monarch, completions, registers } = armGrammar(arch)
	const { Keyword, Variable } = monaco.languages.CompletionItemKind
	return registerAssemblyLanguage(monaco, {
		id: language, extensions: [...GNU_EXTENSIONS, ARMASM_EXTENSION], configuration: armConfiguration, tokens: monarch,
		completions: [
			...completions.map((name) => ({ label: name, kind: Keyword, insertText: name })),
			...registers.map((name) => ({ label: name, kind: Variable, insertText: name })),
		],
	})
}
