import { describe, expect, it, vi } from 'vitest'
import type * as Monaco from 'monaco-editor'
import { lazyLanguageProviders, registerAssemblyLanguage, registerTokenHover } from '../assemblyLanguage'

function fixture() {
	const configuration = { dispose: vi.fn() }, tokens = { dispose: vi.fn() }, completion = { dispose: vi.fn() }, hover = { dispose: vi.fn() }
	const api = {
		languages: {
			register: vi.fn(), setLanguageConfiguration: vi.fn(() => configuration), setMonarchTokensProvider: vi.fn(() => tokens),
			registerCompletionItemProvider: vi.fn((_id: string, _provider: Monaco.languages.CompletionItemProvider) => completion),
			registerHoverProvider: vi.fn((_id: string, _provider: Monaco.languages.HoverProvider) => hover),
		},
		editor: { registerLinkOpener: vi.fn((_opener: Monaco.editor.ILinkOpener) => ({ dispose: vi.fn() })) },
		Range: class { constructor(readonly startLineNumber: number, readonly startColumn: number, readonly endLineNumber: number, readonly endColumn: number) {} },
	}
	return { api, monaco: api as unknown as typeof Monaco, configuration, tokens, completion }
}

describe('shared assembly language providers', () => {
	it('leaves manual links to the shared native anchor handling', () => {
		const f = fixture()
		registerTokenHover(f.monaco, 'assembly', () => null)
		expect(f.api.editor.registerLinkOpener).not.toHaveBeenCalled()
	})

	it('reads current variant completions without reinstalling the provider', () => {
		const f = fixture()
		let names = ['add']
		const providers = registerAssemblyLanguage(f.monaco, { id: 'assembly', completions: () => names.map(label => ({ label, insertText: label, kind: 17 })) })
		const provider = f.api.languages.registerCompletionItemProvider.mock.calls[0][1]
		const model = { getWordUntilPosition: () => ({ startColumn: 1 }) } as unknown as Monaco.editor.ITextModel
		const position = { lineNumber: 1, column: 2 } as Monaco.Position
		const suggestions = () => (provider.provideCompletionItems(model, position, {} as Monaco.languages.CompletionContext, {} as Monaco.CancellationToken) as Monaco.languages.CompletionList).suggestions.map(item => item.label)
		expect(suggestions()).toEqual(['add'])
		names = ['add', 'c.add']
		expect(suggestions()).toEqual(['add', 'c.add'])
		expect(f.api.languages.registerCompletionItemProvider).toHaveBeenCalledOnce()
		providers.dispose()
	})

	it('loads each variant editor on demand and disposes a provider arriving after teardown', async () => {
		const listeners = new Map<string, () => void>()
		const onLanguage = vi.fn((id: string, callback: () => void) => {
			listeners.set(id, callback)
			return { dispose: () => { listeners.delete(id) } }
		})
		const api = { languages: { register: vi.fn(), onLanguage }, editor: { getModels: () => [{ getLanguageId: () => 'a64' }] } }
		const first = { dispose: vi.fn() }, late = { dispose: vi.fn() }
		let finish!: (value: typeof late) => void
		const a64 = vi.fn(async () => first), thumb = vi.fn(() => new Promise<typeof late>(resolve => { finish = resolve }))
		const providers = await lazyLanguageProviders(api as unknown as typeof Monaco, [{ id: 'a64', load: a64 }, { id: 'thumb', load: thumb }])
		expect(a64).toHaveBeenCalledOnce()
		expect(thumb).not.toHaveBeenCalled()
		listeners.get('thumb')!()
		listeners.get('thumb')!()
		expect(thumb).toHaveBeenCalledOnce()
		providers.dispose()
		expect(first.dispose).toHaveBeenCalledOnce()
		expect(listeners.size).toBe(0)
		finish(late)
		await Promise.resolve()
		expect(late.dispose).toHaveBeenCalledOnce()
	})

	it('registers a language identity once per Monaco instance and disposes each provider once', () => {
		const f = fixture(), config = { id: 'asm', configuration: {}, tokens: { tokenizer: { root: [] } }, completions: [] }
		const first = registerAssemblyLanguage(f.monaco, config)
		first.dispose()
		first.dispose()
		expect(f.configuration.dispose).toHaveBeenCalledOnce()
		const second = registerAssemblyLanguage(f.monaco, config)
		expect(f.api.languages.register).toHaveBeenCalledOnce()
		second.dispose()
		const other = fixture()
		registerAssemblyLanguage(other.monaco, config).dispose()
		expect(other.api.languages.register).toHaveBeenCalledOnce()
	})

	it('replaces the typed prefix and preserves instruction documentation', async () => {
		const f = fixture()
		registerAssemblyLanguage(f.monaco, { id: 'asm', completions: [{ label: 'addi', insertText: 'addi', kind: 17, documentation: 'add immediate' }] })
		const provider = f.api.languages.registerCompletionItemProvider.mock.calls[0][1]
		const model = { getWordUntilPosition: () => ({ startColumn: 4, endColumn: 6, word: 'ad' }) } as unknown as Monaco.editor.ITextModel
		const result = await provider.provideCompletionItems(model, { lineNumber: 2, column: 6 } as Monaco.Position, {} as Monaco.languages.CompletionContext, {} as Monaco.CancellationToken)
		expect(result?.suggestions[0]).toMatchObject({ label: 'addi', documentation: 'add immediate', range: { startColumn: 4, endColumn: 6 } })
	})

	it('maps a native token span from zero-based offsets to Monaco columns', async () => {
		const f = fixture()
		registerTokenHover(f.monaco, 'asm', (line, offset) => {
			expect(line).toBe('mov r0')
			expect(offset).toBe(5)
			return { start: 4, length: 2, contents: ['register value'] }
		})
		const provider = f.api.languages.registerHoverProvider.mock.calls[0][1]
		const result = await provider.provideHover({ getLineContent: () => 'mov r0' } as unknown as Monaco.editor.ITextModel, { lineNumber: 3, column: 6 } as Monaco.Position, {} as Monaco.CancellationToken)
		expect(result).toMatchObject({ range: { startLineNumber: 3, startColumn: 5, endColumn: 7 }, contents: [{ value: 'register value' }] })
	})

	it('rolls back language configuration when a later provider fails to register', () => {
		const f = fixture()
		f.api.languages.setMonarchTokensProvider.mockImplementationOnce(() => { throw new Error('bad grammar') })
		expect(() => registerAssemblyLanguage(f.monaco, { id: 'asm', configuration: {}, tokens: { tokenizer: { root: [] } } })).toThrow('bad grammar')
		expect(f.configuration.dispose).toHaveBeenCalledOnce()
		expect(f.api.languages.registerCompletionItemProvider).not.toHaveBeenCalled()
	})
})
