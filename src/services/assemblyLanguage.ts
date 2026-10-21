import type * as Monaco from 'monaco-editor'
import type { Disposable, TokenDescription } from '../architectures/contracts'
import { tokenTooltipMarkdown } from './tokenTooltip'
import { disposableGroup } from '../core/disposableScope'

export type CompletionTemplate = Omit<Monaco.languages.CompletionItem, 'range'>
interface AssemblyLanguage {
	id: string
	extensions?: string[]
	configuration?: Monaco.languages.LanguageConfiguration
	tokens?: Monaco.languages.IMonarchLanguage
	completions?: readonly CompletionTemplate[]
}

// Language identities persist in Monaco; provider instances belong to an activation.
const identities = new WeakMap<object, Set<string>>()

export function registerAssemblyLanguage(monaco: typeof Monaco, config: AssemblyLanguage): Disposable {
	let registered = identities.get(monaco.languages)
	if (!registered) identities.set(monaco.languages, registered = new Set())
	if (!registered.has(config.id)) {
		monaco.languages.register({ id: config.id, ...(config.extensions ? { extensions: config.extensions } : {}) })
		registered.add(config.id)
	}
	return disposableGroup((scope) => {
		if (config.configuration) scope.add(monaco.languages.setLanguageConfiguration(config.id, config.configuration))
		if (config.tokens) scope.add(monaco.languages.setMonarchTokensProvider(config.id, config.tokens))
		if (config.completions) scope.add(monaco.languages.registerCompletionItemProvider(config.id, {
			provideCompletionItems(model, position) {
				const word = model.getWordUntilPosition(position)
				const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, position.column)
				return { suggestions: config.completions!.map((item) => ({ ...item, range })) }
			},
		}))
	})
}

/** Adapt a CPU's token description to Monaco's range and Markdown representation. */
export function registerTokenHover(
	monaco: typeof Monaco, language: string,
	describe: (line: string, offset: number, model: Monaco.editor.ITextModel) => TokenDescription | null,
): Disposable {
	return monaco.languages.registerHoverProvider(language, {
		provideHover(model, position) {
			const token = describe(model.getLineContent(position.lineNumber), position.column - 1, model)
			if (!token) return null
			return {
				range: new monaco.Range(position.lineNumber, token.start + 1, position.lineNumber, token.start + token.length + 1),
				contents: tokenTooltipMarkdown(token).map((value) => ({ value })),
			}
		},
	})
}
