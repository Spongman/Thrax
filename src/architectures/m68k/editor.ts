import { FPU_MNEMONICS, M68K_INSTRUCTIONS } from './catalog'
import { describe80 } from './extended'
import { effectiveCoprocessor, type M68kSettings } from './settings'
import { FP_CONTROL_NAMES, FP_NAMES } from './profile'
import { inspectAssemblyToken, type TokenInspection } from '../../services/assemblyInspection'
import type * as Monaco from 'monaco-editor'
import type { DebugInspection, EditorHost, TokenDescription } from '../contracts'
import { disposableGroup } from '../../core/disposableScope'
import { registerAssemblyLanguage, registerTokenHover } from '../../services/assemblyLanguage'
import { REGISTER_NAMES } from './isa'
import { manifest } from './manifest'
import { m68kInstructionHelp } from './instructionHelp'
import { assemblyDefinitions, registerGotoDefinition } from '../../services/gotoDefinition'

export const m68kDefinitions = assemblyDefinitions({
	comments: [';'], ignoreLine: line => /^\s*\*/.test(line),
	patterns: name => [new RegExp(`^(\\s*)(${name})\\s+(?:equ|=)\\s+`, 'i')],
})

const inspection: TokenInspection = {
	tokens: /[\w.$]+/g, comments: [';'], ignoreLine: text => /^\s*\*/.test(text),
	register: token => token.toUpperCase() === 'SP' ? 'A7' : token.toUpperCase(),
	registerText: (token, id, value) =>
		typeof value === 'bigint' && FP_NAMES.includes(id)
			? `**${token.toUpperCase()}** = ${describe80(value)} (${value.toString(16).padStart(20, '0')})`
			: `**${token.toUpperCase()}** = ${value} (${(Number(value) >>> 0).toString(16)})`,
	labelText: (token, address) => `**${token}** = $${address.toString(16)}`,
	help: m68kInstructionHelp,
}

export function describeToken(text: string, offset: number, state: DebugInspection): TokenDescription | null {
	return inspectAssemblyToken(text, offset, state, inspection)
}

export function installEditor(monaco: typeof Monaco, host: EditorHost) {
	return disposableGroup((scope) => {
		scope.add(registerAssemblyLanguage(monaco, {
			id: 'thrax-m68k', extensions: [...manifest.fileExtensions],
			tokens: {
				ignoreCase: true,
				tokenizer: {
					root: [
						[/;.*/, 'comment'],
						[/^\s*\*.*/, 'comment'],
						[/"([^"\\]|\\.)*"|'([^'\\]|\\.)'/, 'string'],
						[/\b(?:d[0-7]|a[0-7]|fp[0-7]|fpcr|fpsr|fpiar|sp|sr|ccr|pc)\b/, 'variable'],
						[/\$[\da-f]+|\b(?:0x[\da-f]+|\d+)\b/, 'number'],
						[/[\w.$]+:/, 'type.identifier'],
						[/[\w.]+/, 'keyword']
					]
				}
			},
			completions: () => {
				const settings = host.settings?.() as Partial<M68kSettings> | undefined,
					fpu = !!settings && effectiveCoprocessor(settings) !== 'none'
				return [...M68K_INSTRUCTIONS.names(settings?.cpuModel), ...REGISTER_NAMES, 'sp', 'ccr', '.text', '.data', 'dc.b', 'dc.w', 'dc.l', '.asciz',
					...(fpu ? [...FPU_MNEMONICS, ...FP_NAMES, ...FP_CONTROL_NAMES, 'dc.s', 'dc.d', 'dc.x'] : [])]
					.map((label) => ({ label, insertText: label, kind: monaco.languages.CompletionItemKind.Keyword }))
			},
		}))
		scope.add(registerTokenHover(monaco, 'thrax-m68k', (line, offset) => describeToken(line, offset, host.inspection())))
		scope.add(registerGotoDefinition(monaco, host, 'thrax-m68k', m68kDefinitions))
	})
}
