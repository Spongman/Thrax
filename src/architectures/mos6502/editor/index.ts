import { disposableGroup } from '../../../core/disposableScope'
import type * as Monaco from 'monaco-editor'
import type { GotoDefinitionSources } from '../../../services/gotoDefinition'
import { registerMos6502DataTips, type Mos6502HoverSources } from './dataTips'
import { registerMos6502Definitions } from './definition'
import { registerMos6502Language } from './language'
import { NMOS_MODEL, type CpuModel } from '../isa'

export { MOS6502_LANGUAGE_ID } from './grammar'

export function installEditor(monaco: typeof Monaco, sources: GotoDefinitionSources & Mos6502HoverSources, model: CpuModel = NMOS_MODEL) {
	const id = model.cmos ? 'ca65-w65c02' : 'ca65'
	return disposableGroup((scope) => {
		scope.add(registerMos6502Language(monaco, model))
		scope.add(registerMos6502Definitions(monaco, sources, id))
		scope.add(registerMos6502DataTips(monaco, sources, id, model))
	})
}
