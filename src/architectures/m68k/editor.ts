import { stripAssemblyComment } from '../../core/assembly/text'
import type * as Monaco from 'monaco-editor'
import type { DebugInspection, EditorHost, TokenDescription } from '../contracts'
import { disposableGroup } from '../../core/disposableScope'
import { registerAssemblyLanguage, registerTokenHover } from '../../services/assemblyLanguage'
import { MNEMONICS, REGISTER_NAMES } from './isa'
import { manifest } from './manifest'
import { m68kInstructionHelp } from './instructionHelp'

export function describeToken(text: string, column: number, state: DebugInspection): TokenDescription | null {
	const comment = text.indexOf(';')
	if (comment >= 0 && column >= comment) return null
	if (/^\s*\*/.test(text)) return null
	for (const match of text.matchAll(/[\w.$]+/g)) {
		if (column < match.index! || column >= match.index! + match[0].length) continue
		const name = match[0].toUpperCase(),
			register = name === 'SP' ? 'A7' : name
		if (register in state.registers) {
			const value = state.registers[register]
			return {
				start: match.index!,
				length: match[0].length,
				register,
				contents: [`**${name}** = ${value} ($${(Number(value) >>> 0).toString(16)})`]
			}
		}
		const address = state.labels.get(match[0])
		if (address !== undefined)
			return {
				start: match.index!,
				length: match[0].length,
				address,
				contents: [`**${match[0]}** = $${address.toString(16)}`]
			}
		const contents = m68kInstructionHelp(match[0])
		return contents ? { start: match.index!, length: match[0].length, ...contents } : null
	}
	return null
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
						[/\b(?:d[0-7]|a[0-7]|sp|sr|ccr|pc)\b/, 'variable'],
						[/\$[\da-f]+|\b(?:0x[\da-f]+|\d+)\b/, 'number'],
						[/[\w.$]+:/, 'type.identifier'],
						[/[\w.]+/, 'keyword']
					]
				}
			},
			completions: [...MNEMONICS, ...REGISTER_NAMES, 'sp', 'ccr', '.text', '.data', 'dc.b', 'dc.w', 'dc.l', '.asciz']
				.map((label) => ({ label, insertText: label, kind: monaco.languages.CompletionItemKind.Keyword })),
		}))
		scope.add(registerTokenHover(monaco, 'thrax-m68k', (line, offset) => describeToken(line, offset, host.inspection())))
	})
}
