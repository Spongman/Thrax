import { describe, expect, it, vi } from 'vitest'
import type * as Monaco from 'monaco-editor'
import { registerAssemblyLanguage, registerTokenHover } from '../assemblyLanguage'

function fixture() {
	const configuration = { dispose: vi.fn() }, tokens = { dispose: vi.fn() }, completion = { dispose: vi.fn() }, hover = { dispose: vi.fn() }
	const api = {
		languages: {
			register: vi.fn(), setLanguageConfiguration: vi.fn(() => configuration), setMonarchTokensProvider: vi.fn(() => tokens),
			registerCompletionItemProvider: vi.fn((_id: string, _provider: Monaco.languages.CompletionItemProvider) => completion),
			registerHoverProvider: vi.fn((_id: string, _provider: Monaco.languages.HoverProvider) => hover),
		},
		Range: class { constructor(readonly startLineNumber: number, readonly startColumn: number, readonly endLineNumber: number, readonly endColumn: number) {} },
	}
	return { api, monaco: api as unknown as typeof Monaco, configuration, tokens, completion }
}

describe('shared assembly language providers', () => {
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
