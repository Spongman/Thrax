import type * as Monaco from 'monaco-editor'
import type { GotoDefinitionSources } from '../../../services/gotoDefinition'
import { registerMos6502DataTips, type Mos6502HoverSources } from './dataTips'
import { registerMos6502Definitions } from './definition'
import { registerMos6502Language } from './language'

export { MOS6502_LANGUAGE_ID } from './grammar'

export function installEditor(monaco: typeof Monaco, sources: GotoDefinitionSources & Mos6502HoverSources) {
	const language = registerMos6502Language(monaco)
	const definitions = registerMos6502Definitions(monaco, sources)
	const tips = registerMos6502DataTips(monaco, sources)
	let disposed = false
	return { dispose() {
		if (disposed) return
		disposed = true
		tips.dispose()
		definitions.dispose()
		language.dispose()
	} }
}
