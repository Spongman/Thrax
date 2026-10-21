import { stripAssemblyComment } from '../../core/assembly/text'
import type * as Monaco from 'monaco-editor'
import type { DebugInspection, EditorHost, TokenDescription } from '../contracts'
import { disposableGroup } from '../../core/disposableScope'
import { registerAssemblyLanguage, registerTokenHover } from '../../services/assemblyLanguage'
import { manifest } from './manifest'
import { riscvInstructionHelp } from './instructionHelp'
import { ABI, MNEMONICS, register } from './isa'
import { COMPRESSED_MNEMONICS } from './compressed'

export function describeRiscvToken(text: string, column: number, state: DebugInspection): TokenDescription | null {
	const comment = text.indexOf('#')
	if (comment >= 0 && column >= comment) return null
	for (const match of text.matchAll(/[\w.$]+/g)) {
		if (column < match.index! || column >= match.index! + match[0].length) continue
		try {
			const id = `x${register(match[0])}`,
				value = state.registers[id]
			return {
				start: match.index!,
				length: match[0].length,
				register: id,
				contents: [`**${match[0]}** = ${value} (0x${(Number(value) >>> 0).toString(16)})`]
			}
		} catch {
			const address = state.labels.get(match[0])
			if (address !== undefined) return {
				start: match.index!, length: match[0].length, address,
				contents: [`**${match[0]}** = 0x${address.toString(16)}`],
			}
			const contents = riscvInstructionHelp(match[0])
			return contents ? { start: match.index!, length: match[0].length, ...contents } : null
		}
	}
	return null
}

export function installEditor(monaco: typeof Monaco, host: EditorHost) {
	const { Keyword, Variable } = monaco.languages.CompletionItemKind
	return disposableGroup((scope) => {
		scope.add(registerAssemblyLanguage(monaco, {
			id: 'thrax-riscv', extensions: [...manifest.fileExtensions],
			configuration: { comments: { lineComment: '#' }, wordPattern: /[A-Za-z_.$][\w.$]*/ },
			tokens: {
				ignoreCase: true,
				tokenizer: {
					root: [
						[/#.*$/, 'comment'],
						[/"([^"\\]|\\.)*"/, 'string'],
						[/\b(?:x(?:[0-9]|[12][0-9]|3[01])|zero|ra|sp|gp|tp|t[0-6]|s(?:[0-9]|1[01])|a[0-7]|fp)\b/, 'variable'],
						[/\.[a-z][\w.]*/, 'keyword'],
						[/\b(?:0x[\da-f]+|\d+)\b/, 'number'],
						[/[\w.$]+:/, 'type.identifier'],
						[/[a-z][\w.]*/, 'keyword']
					]
				}
			},
			completions: [...ABI, ...MNEMONICS, ...COMPRESSED_MNEMONICS, '.text', '.data', '.word', '.byte', '.asciz', '.include', '.equ', '.align']
				.map((label) => ({ label, insertText: label, kind: ABI.includes(label) ? Variable : Keyword })),
		}))
		scope.add(registerTokenHover(monaco, 'thrax-riscv', (line, offset) => describeRiscvToken(line, offset, host.inspection())))
	})
}
