import type * as Monaco from 'monaco-editor'
import { registerUasmDataTips, type UasmHoverSources } from './dataTips'
import { registerUasmDefinitions, type UasmDefinitionSources } from './definition'
import { registerUasmLanguage } from './language'

export { UASM_LANGUAGE_ID } from './grammar'
export type { UasmDefinitionSources } from './definition'

export function installEditor(monaco: typeof Monaco, sources: UasmDefinitionSources & UasmHoverSources) {
	const language = registerUasmLanguage(monaco)
	const definitions = registerUasmDefinitions(monaco, sources)
	const tips = registerUasmDataTips(monaco, sources)
	let disposed = false
	return { dispose() {
		if (disposed) return
		disposed = true
		tips.dispose()
		definitions.dispose()
		language.dispose()
	} }
}
