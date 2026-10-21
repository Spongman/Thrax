import { disposableGroup } from '../../../core/disposableScope'
import type * as Monaco from 'monaco-editor'
import type { GotoDefinitionSources } from '../../../services/gotoDefinition'
import { registerA64DataTips, type A64HoverSources } from './dataTips'
import { registerA64Definitions } from './definition'
import { registerA64Language } from './language'

export { A64_LANGUAGE_ID } from './grammar'

export function installEditor(monaco: typeof Monaco, sources: GotoDefinitionSources & A64HoverSources) {
	return disposableGroup((scope) => {
		scope.add(registerA64Language(monaco))
		scope.add(registerA64Definitions(monaco, sources))
		scope.add(registerA64DataTips(monaco, sources))
	})
}
