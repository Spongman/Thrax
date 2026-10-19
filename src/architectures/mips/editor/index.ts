import type * as Monaco from 'monaco-editor'
import { registerGotoDefinition } from '../../../services/gotoDefinition'
import type { EditorHost } from '../../contracts'
import { registerMipsDebugDataTips } from './debugDataTips'
import { MIPS_LANGUAGE_ID, registerMipsLanguage } from './language'

export function installEditor(monaco: typeof Monaco, host: EditorHost) {
	const language = registerMipsLanguage()
	const definitions = registerGotoDefinition(monaco, host, MIPS_LANGUAGE_ID)
	// The provider reads the model it was asked about, so a hover answers for
	// the file under the pointer rather than for the entry file.
	const dataTips = registerMipsDebugDataTips(monaco, () => host.inspection())
	let disposed = false
	return { dispose() {
		if (disposed) return
		disposed = true
		dataTips.dispose()
		definitions.dispose()
		language.dispose()
	} }
}
