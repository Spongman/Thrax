import { disposableGroup } from '../../../core/disposableScope'
import type * as Monaco from 'monaco-editor'
import type { GotoDefinitionSources } from '../../../services/gotoDefinition'
import { registerZ80DataTips, type Z80HoverSources } from './dataTips'
import { registerZ80Definitions } from './definition'
import { registerZ80Language } from './language'

export { Z80_LANGUAGE_ID } from './grammar'

export function installEditor(monaco: typeof Monaco, sources: GotoDefinitionSources & Z80HoverSources) {
	return disposableGroup((scope) => {
		scope.add(registerZ80Language(monaco))
		scope.add(registerZ80Definitions(monaco, sources))
		scope.add(registerZ80DataTips(monaco, sources))
	})
}
