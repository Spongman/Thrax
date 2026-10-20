import type * as Monaco from 'monaco-editor'
import { armConfiguration } from '../../arm/editor/grammar'
import type { Disposable, EditorHost } from '../../contracts'
import { ALU, CONDITIONS, LANGUAGE, SPECIAL } from './isa'

/** Share ARM punctuation/configuration; keep M0 completions separate from A32. */
export function installM0Editor(monaco: typeof Monaco, host: EditorHost): Disposable {
	const mnemonics = [
		...ALU,
		...CONDITIONS.map((c) => 'b' + c),
		'movs',
		'mov',
		'adds',
		'subs',
		'add',
		'sub',
		'b',
		'bl',
		'bx',
		'blx',
		'ldr',
		'str',
		'ldrb',
		'strb',
		'ldrh',
		'strh',
		'ldrsb',
		'ldrsh',
		'ldmia',
		'stmia',
		'push',
		'pop',
		'adr',
		'sxtb',
		'sxth',
		'uxtb',
		'uxth',
		'rev',
		'rev16',
		'revsh',
		'mrs',
		'msr',
		'cpsid',
		'cpsie',
		'dmb',
		'dsb',
		'isb',
		'nop',
		'yield',
		'wfe',
		'wfi',
		'sev',
		'svc',
		'bkpt',
		'udf',
	]
	monaco.languages.register({ id: LANGUAGE })
	const parts: Disposable[] = [
		monaco.languages.setLanguageConfiguration(LANGUAGE, armConfiguration),
		monaco.languages.setMonarchTokensProvider(LANGUAGE, {
			ignoreCase: true,
			mnemonics,
			tokenizer: {
				root: [
					[/@.*$|\/\/.*$/, 'comment'],
					[/"([^"\\]|\\.)*"/, 'string'],
					[/\b(?:r(?:[0-9]|1[0-5])|sp|lr|pc|apsr|xpsr|msp|psp|control|primask)\b/, 'variable'],
					[/\.[a-z][\w.]*/, 'keyword'],
					[/\b(?:0x[\da-f]+|\d+)\b/, 'number'],
					[/[\w.$]+:/, 'type.identifier'],
					[/[a-z][\w.]*/, { cases: { '@mnemonics': 'keyword', '@default': 'identifier' } }],
				],
			},
		}),
		monaco.languages.registerCompletionItemProvider(LANGUAGE, {
			provideCompletionItems(model, position) {
				const word = model.getWordUntilPosition(position),
					range = new monaco.Range(
						position.lineNumber,
						word.startColumn,
						position.lineNumber,
						position.column,
					)
				return {
					suggestions: [...mnemonics, ...Object.keys(SPECIAL)].map((label) => ({
						label,
						kind: monaco.languages.CompletionItemKind.Keyword,
						insertText: label,
						range,
					})),
				}
			},
		}),
		monaco.languages.registerHoverProvider(LANGUAGE, {
			provideHover(model, position) {
				const word = model.getWordAtPosition(position)
				if (!word) return null
				const name = word.word.toUpperCase(),
					id = name === 'SP' ? 'R13' : name === 'LR' ? 'R14' : name === 'R15' ? 'PC' : name,
					state = host.inspection(),
					value = state.registers[id] ?? state.labels.get(word.word)
				return value === undefined
					? null
					: { contents: [{ value: `**${word.word}** = ${value} (0x${value.toString(16)})` }] }
			},
		}),
	]
	return {
		dispose: () =>
			parts
				.splice(0)
				.reverse()
				.forEach((p) => p.dispose()),
	}
}
