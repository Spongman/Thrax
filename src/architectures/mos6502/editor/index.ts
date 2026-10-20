import type * as Monaco from 'monaco-editor'
import type { GotoDefinitionSources } from '../../../services/gotoDefinition'
import { registerMos6502DataTips, type Mos6502HoverSources } from './dataTips'
import { registerMos6502Definitions } from './definition'
import { registerMos6502Language } from './language'
import { NMOS_MODEL, type CpuModel } from '../isa'

export { MOS6502_LANGUAGE_ID } from './grammar'

export function installEditor(monaco: typeof Monaco, sources: GotoDefinitionSources & Mos6502HoverSources, model: CpuModel = NMOS_MODEL) {
	const id = model.cmos ? 'ca65-w65c02' : 'ca65'
	const language = registerMos6502Language(monaco, model)
	const definitions = registerMos6502Definitions(monaco, sources, id)
	const tips = registerMos6502DataTips(monaco, sources, id, model)
	let disposed = false
	return { dispose() {
		if (disposed) return
		disposed = true
		tips.dispose()
		definitions.dispose()
		language.dispose()
	} }
}
