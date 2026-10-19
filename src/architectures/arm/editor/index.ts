import type * as Monaco from 'monaco-editor'
import type { GotoDefinitionSources } from '../../../services/gotoDefinition'
import { registerArmDataTips, type ArmHoverSources } from './dataTips'
import { registerArmDefinitions } from './definition'
import { registerArmLanguage } from './language'

export { ARM_LANGUAGE_ID } from './grammar'

/** Language, go-to-definition and data tips for ARM sources. */
export function installEditor(monaco: typeof Monaco, sources: GotoDefinitionSources & ArmHoverSources) {
	const language = registerArmLanguage(monaco)
	const definitions = registerArmDefinitions(monaco, sources)
	const tips = registerArmDataTips(monaco, sources)
	let disposed = false
	return { dispose() {
		if (disposed) return
		disposed = true
		tips.dispose()
		definitions.dispose()
		language.dispose()
	} }
}
