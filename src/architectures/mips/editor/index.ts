import { disposableGroup } from '../../../core/disposableScope'
import type * as Monaco from 'monaco-editor'
import { registerGotoDefinition } from '../../../services/gotoDefinition'
import type { EditorHost } from '../../contracts'
import { registerMipsDebugDataTips } from './debugDataTips'
import { MIPS_LANGUAGE_ID, registerMipsLanguage } from './language'

export function installEditor(monaco: typeof Monaco, host: EditorHost) {
	return disposableGroup((scope) => {
		scope.add(registerMipsLanguage())
		scope.add(registerGotoDefinition(monaco, host, MIPS_LANGUAGE_ID))
		// The provider reads the model it was asked about, so a hover answers for
		// the file under the pointer rather than for the entry file.
		scope.add(registerMipsDebugDataTips(monaco, () => host.inspection()))
	})
}
