import type * as Monaco from 'monaco-editor'
import type { GotoDefinitionSources } from '../../../services/gotoDefinition'
import { registerZ80DataTips, type Z80HoverSources } from './dataTips'
import { registerZ80Definitions } from './definition'
import { registerZ80Language } from './language'

export { Z80_LANGUAGE_ID } from './grammar'

export function installEditor(monaco: typeof Monaco, sources: GotoDefinitionSources & Z80HoverSources) {
	const language = registerZ80Language(monaco)
	const definitions = registerZ80Definitions(monaco, sources)
	const tips = registerZ80DataTips(monaco, sources)
	let disposed = false
	return { dispose() {
		if (disposed) return
		disposed = true
		tips.dispose()
		definitions.dispose()
		language.dispose()
	} }
}
