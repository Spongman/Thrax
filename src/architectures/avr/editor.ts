import { inspectAssemblyToken, type TokenInspection } from '../../services/assemblyInspection'
import type * as Monaco from 'monaco-editor'
import type { DebugInspection, EditorHost, TokenDescription } from '../contracts'
import { disposableGroup } from '../../core/disposableScope'
import { registerAssemblyLanguage, registerTokenHover } from '../../services/assemblyLanguage'
import { MNEMONICS } from './isa'
import { avrInstructionHelp } from './instructionHelp'
import { assemblyDefinitions, registerGotoDefinition } from '../../services/gotoDefinition'

export const avrDefinitions = assemblyDefinitions({ comments: [';'] })

const inspection: TokenInspection = {
	tokens: /[A-Za-z_.$][\w.$]*/g, comments: [';'],
	register: token => /^r\d+$/i.test(token) ? token.toLowerCase() : token.toUpperCase(),
	registerText: (token, _id, value) => `**${token}** = ${value} (0x${value.toString(16)})`,
	labelText: (token, address) => `**${token}** = ${address} (0x${address.toString(16)})`,
	help: avrInstructionHelp,
}

export function describeAvrToken(text: string, offset: number, state: DebugInspection): TokenDescription | null {
	return inspectAssemblyToken(text, offset, state, inspection)
}

export function installEditor(monaco: typeof Monaco, host: EditorHost) {
	return disposableGroup((scope) => {
		scope.add(registerAssemblyLanguage(monaco, {
			id: 'avr', extensions: ['.asm', '.s'],
			configuration: { comments: { lineComment: ';' }, brackets: [['(', ')']], wordPattern: /[A-Za-z_.$][\w.$]*/ },
			tokens: {
			ignoreCase: true,
			mnemonics: MNEMONICS,
			tokenizer: {
				root: [
					[/;.*$/, 'comment'],
					[/\.[A-Za-z]+/, 'keyword.directive'],
					[/\br(?:[12]?\d|3[01])\b/i, 'variable'],
					[/\b(?:PC|SP|SREG|X|Y|Z)\b/i, 'variable'],
					[/\b(?:0x[\da-f]+|0b[01]+|\d+)\b/i, 'number'],
					[/[A-Za-z_.$][\w.$]*/, { cases: { '@mnemonics': 'keyword', '@default': 'identifier' } }]
				]
			}
		},
			completions: MNEMONICS.map((name) => ({ label: name, insertText: name, kind: monaco.languages.CompletionItemKind.Keyword })),
		}))
		scope.add(registerTokenHover(monaco, 'avr', (line, offset) => describeAvrToken(line, offset, host.inspection())))
		scope.add(registerGotoDefinition(monaco, host, 'avr', avrDefinitions))
	})
}
