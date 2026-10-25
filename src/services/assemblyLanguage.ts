import type * as Monaco from 'monaco-editor'
import type { Disposable, TokenDescription } from '../architectures/contracts'
import { tokenTooltipMarkdown } from './tokenTooltip'
import { DisposableScope, disposableGroup } from '../core/disposableScope'

export type CompletionTemplate = Omit<Monaco.languages.CompletionItem, 'range'>
interface AssemblyLanguage {
	id: string
	extensions?: string[]
	configuration?: Monaco.languages.LanguageConfiguration
	tokens?: Monaco.languages.IMonarchLanguage
	completions?: readonly CompletionTemplate[] | (() => readonly CompletionTemplate[])
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
				const items = typeof config.completions === 'function' ? config.completions() : config.completions!
				return { suggestions: items.map((item) => ({ ...item, range })) }
			},
		}))
	})
}

/** Language identities are cheap; load a variant's providers only when a model needs them. */
export async function lazyLanguageProviders(monaco: typeof Monaco, languages: readonly { id: string, load(): Promise<Disposable> }[]): Promise<Disposable> {
	const scope = new DisposableScope()
	try {
		const pending: Promise<void>[] = []
		for (const language of languages) {
			scope.add(registerAssemblyLanguage(monaco, { id: language.id }))
			let loaded: Promise<void> | undefined
			const load = () => loaded ??= language.load().then(provider => { scope.add(provider) })
			if (typeof monaco.languages.onLanguage !== 'function') {
				pending.push(load())
				continue
			}
			scope.add(monaco.languages.onLanguage(language.id, () => {
				if (!scope.disposed) void load().catch(error => { if (!scope.disposed) console.error(`Unable to load ${language.id} editor providers`, error) })
			}))
			if (monaco.editor.getModels().some(model => model.getLanguageId() === language.id)) pending.push(load())
		}
		await Promise.all(pending)
		return scope
	} catch (error) {
		scope.dispose()
		throw error
	}
}

/** Adapt a CPU's token description to Monaco's range and Markdown representation. */
export function registerTokenHover(
	monaco: typeof Monaco, language: string,
	describe: (line: string, offset: number, model: Monaco.editor.ITextModel) => TokenDescription | null,
): Disposable {
	return disposableGroup((scope) => {
		scope.add(monaco.languages.registerHoverProvider(language, {
			provideHover(model, position) {
				const token = describe(model.getLineContent(position.lineNumber), position.column - 1, model)
				if (!token) return null
				return {
					range: new monaco.Range(position.lineNumber, token.start + 1, position.lineNumber, token.start + token.length + 1),
					contents: tokenTooltipMarkdown(token).map((value) => ({ value })),
				}
			},
		}))
	})
}
