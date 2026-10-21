import { disposableGroup } from '../../../core/disposableScope'
import type * as Monaco from 'monaco-editor'
import { registerUasmDataTips, type UasmHoverSources } from './dataTips'
import { registerUasmDefinitions, type UasmDefinitionSources } from './definition'
import { registerUasmLanguage } from './language'

export { UASM_LANGUAGE_ID } from './grammar'
export type { UasmDefinitionSources } from './definition'

export function installEditor(monaco: typeof Monaco, sources: UasmDefinitionSources & UasmHoverSources) {
	return disposableGroup((scope) => {
		scope.add(registerUasmLanguage(monaco))
		scope.add(registerUasmDefinitions(monaco, sources))
		scope.add(registerUasmDataTips(monaco, sources))
	})
}
