import { describe, expect, it, vi } from 'vitest'
import type * as Monaco from 'monaco-editor'
import { activateArchitecture } from '../registry'
import { variantOf, type DebugInspection, type EditorHost } from '../contracts'
import { architectureVariants } from './helpers'
import { createToolRegistry } from '../../tools/registry'
import { codeRowOf } from '../../core/sourceIndex'

const families = ['m6800', 'i8051', 'powerpc', 'alpha', 'i8086', 'tms9900', 'sparc', 'sh', 'vax', 'pdp11', 's360']

function editorFixture() {
	const disposals: ReturnType<typeof vi.fn>[] = []
	const disposable = () => { const dispose = vi.fn(); disposals.push(dispose); return { dispose } }
	const api = {
		languages: {
			register: vi.fn(), setLanguageConfiguration: vi.fn(disposable), setMonarchTokensProvider: vi.fn(disposable),
			registerCompletionItemProvider: vi.fn((_id: string, _provider: Monaco.languages.CompletionItemProvider) => disposable()),
			registerHoverProvider: vi.fn((_id: string, _provider: Monaco.languages.HoverProvider) => disposable()),
			registerDefinitionProvider: vi.fn((_id: string, _provider: Monaco.languages.DefinitionProvider) => disposable()),
			CompletionItemKind: { Keyword: 17 },
		},
		editor: { registerEditorOpener: vi.fn(disposable), registerLinkOpener: vi.fn(disposable) },
		Range: class { constructor(readonly startLineNumber: number, readonly startColumn: number, readonly endLineNumber: number, readonly endColumn: number) {} },
	}
	return { api, monaco: api as unknown as typeof Monaco, disposals }
}

describe.each(families)('%s shared workbench integration', id => {
	it('documents every completion mnemonic and owns its editor providers', async () => {
		const { definition } = await activateArchitecture(id), services = definition.createServices(), f = editorFixture()
		const state = { registers: {}, labels: new Map() } as unknown as DebugInspection
		// HLASM names start in column 1; the GNU-style dialects take a colon.
		const fixed = id === 's360', code = `${fixed ? 'target   DS    F' : '  target:'}\n  .equ amount, 7\n  use target`
		try {
			const provider = await services.installEditor(f.monaco, { files: () => [{ title: 'test.asm', code }], active: () => 'test.asm', open: vi.fn(), inspection: () => state } satisfies EditorHost)
			for (const settings of architectureVariants(definition)) {
				const variant = variantOf(definition, settings)
				const program = services.assemble({ files: [{ name: 'main.asm', code: variant.examples.sum.code }], entries: ['main.asm'] }, settings)
				expect(program.diagnostics).toEqual([])
				const completion = f.api.languages.registerCompletionItemProvider.mock.calls.find(([language]) => language === variant.language)![1]
				const items = await completion.provideCompletionItems({ getWordUntilPosition: () => ({ startColumn: 1 }) } as unknown as Monaco.editor.ITextModel, { lineNumber: 1, column: 1 } as Monaco.Position, {} as Monaco.languages.CompletionContext, {} as Monaco.CancellationToken) as Monaco.languages.CompletionList
				const registers = new Set(variant.registers.flatMap(register => [register.id, ...(register.aliases ?? [])]))
				const instructions = items.suggestions.filter(item => typeof item.label === 'string' && !item.label.startsWith('.') && !registers.has(item.label))
				expect(instructions.length).toBeGreaterThan(30)
				for (const item of instructions) {
					const name = item.label as string, help = services.describeToken!(name, 0, state)!
					expect(help, name).not.toBeNull()
					expect(help.reference, name).toMatch(/^https:\/\//)
					const quoted = name.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
					// A mnemonic may link to its own place in the manual.
					expect(help.contents[0], name).toMatch(new RegExp(`^\\*\\*(?:${quoted}|\\[${quoted}\\]\\(https://\\S+ "Open ${quoted} in the manual"\\))\\*\\* — .+ assembly\\.$`))
					expect(help.contents[1].length, name).toBeGreaterThan(15)
					expect(help.contents[2], name).toMatch(/^Syntax: /)
					expect(help.contents.join(' '), name).not.toContain('Instruction reference')
					expect(item.documentation, name).toEqual({ value: help.contents.join('\n\n') })
				}
				for (const register of variant.registers) for (const name of [register.id, register.name, ...(register.aliases ?? [])]) {
					expect(services.describeToken!(name, 0, { ...state, registers: { [register.id]: 17 } }), name).toMatchObject({ register: register.id })
				}
				const find = f.api.languages.registerDefinitionProvider.mock.calls.find(([language]) => language === variant.language)![1]
				const model = { getLineContent: () => '  use target', getValue: () => code, uri: { path: '/test.asm' } } as unknown as Monaco.editor.ITextModel
				expect(await find.provideDefinition(model, { lineNumber: 3, column: 8 } as Monaco.Position, {} as Monaco.CancellationToken)).toMatchObject({ range: { startLineNumber: 1, startColumn: fixed ? 1 : 3, endColumn: fixed ? 7 : 9 } })
			}
			provider.dispose()
			services.dispose()
			for (const dispose of f.disposals) expect(dispose).toHaveBeenCalledOnce()
		} finally { services.dispose() }
	})

	it('pins loaded symbols, disassembles source rows and replays common tool data', async () => {
		const { definition } = await activateArchitecture(id), services = definition.createServices(), settings = definition.settings.defaults
		const tools = createToolRegistry()
		try {
			// MACRO-11 reads 123 as octal; a trailing point makes it decimal.
			const code = `.equ inspectionSymbol, 123${id === 'pdp11' ? '.' : ''}\n${definition.examples.ackermann.code}`
			const sources = { files: [{ name: 'test.asm', code }], entries: ['test.asm'] }
			const program = services.assemble(sources, settings)
			expect(program.diagnostics.filter(d => d.severity === 'error')).toEqual([])
			expect(program.symbolSites?.get('')?.get('inspectionSymbol')).toMatchObject({ file: 'test.asm', line: 1, column: 6 })
			const machine = services.createMachine(program, settings, { speed: null, historyLimit: 100000 })
			services.assemble({ ...sources, files: [{ name: 'test.asm', code: code.replace('123', '456') }] }, settings)
			expect(services.describeToken!('inspectionSymbol', 0, { registers: {}, memory: machine.inspectMemory(), labels: new Map([['inspectionSymbol', 456]]) })).toMatchObject({ address: 123 })
			const rows = [...program.sourceIndex.lines('test.asm')].flatMap(([, rows]) => rows).filter(row => row.instruction !== null).slice(0, 12)
			expect(rows.length).toBeGreaterThan(0)
			for (const row of rows) expect(services.disassembly.row(codeRowOf(row, machine.inspectMemory())), `${row.address}`).not.toBe('')
			tools.attach(machine, machine.toolConfig())
			tools.setWanted(new Set(['statistics', 'profile', 'cache', 'branchHistory', 'memoryReference']))
			for (let i = 0; i < 100000 && !machine.halted; i++) machine.step()
			expect(machine.halted).toBe(true)
			const settled = structuredClone(tools.views())
			expect(settled.statistics.total).toBe(machine.instructionCount)
			expect(settled.profile.total).toBe(machine.instructionCount)
			expect(settled.cache.accesses).toBeGreaterThan(0)
			expect(settled.branchHistory.predictions).toBeGreaterThan(0)
			const count = Math.min(10, machine.historyCursor)
			for (let i = 0; i < count; i++) expect(machine.stepBack()).toBe(true)
			expect(tools.views().statistics.total).toBe(machine.instructionCount)
			for (let i = 0; i < count; i++) machine.step()
			expect(tools.views()).toEqual(settled)
		} finally { tools.detach(); services.dispose() }
	})
})
