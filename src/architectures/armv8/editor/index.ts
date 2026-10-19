import type * as Monaco from 'monaco-editor'
import type { GotoDefinitionSources } from '../../../services/gotoDefinition'
import { registerA64DataTips, type A64HoverSources } from './dataTips'
import { registerA64Definitions } from './definition'
import { registerA64Language } from './language'

export { A64_LANGUAGE_ID } from './grammar'

export function installEditor(monaco: typeof Monaco, sources: GotoDefinitionSources & A64HoverSources) {
	const language = registerA64Language(monaco)
	const definitions = registerA64Definitions(monaco, sources)
	const tips = registerA64DataTips(monaco, sources)
	let disposed = false
	return { dispose() {
		if (disposed) return
		disposed = true
		tips.dispose()
		definitions.dispose()
		language.dispose()
	} }
}
