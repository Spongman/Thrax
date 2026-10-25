import { describe, expect, it, vi } from 'vitest'
import type * as Monaco from 'monaco-editor'
import type { EditorHost } from '../../architectures/contracts'
import { avrDefinitions, installEditor as avrEditor } from '../../architectures/avr/editor'
import { riscvDefinitions, installEditor as riscvEditor } from '../../architectures/riscv/editor'
import { m68kDefinitions, installEditor as m68kEditor } from '../../architectures/m68k/editor'

describe.each([
	['AVR', 'avr', avrDefinitions, avrEditor, ';'],
	['RISC-V', 'thrax-riscv', riscvDefinitions, riscvEditor, '#'],
	['68k', 'thrax-m68k', m68kDefinitions, m68kEditor, ';'],
] as const)('%s source definitions', (_name, language, finder, installEditor, comment) => {
	it('finds same-file and cross-file labels while ignoring comments and longer names', () => {
		const files = [
			{ title: 'main.asm', code: `${comment} helper:\nhelper_extra:\nmain: .local:\n\tcall helper` },
			{ title: 'lib.asm', code: '\thelper:\n' },
		]
		expect(finder.find(files, 'main')).toEqual({ file: 'main.asm', line: 3, column: 1, endColumn: 5 })
		expect(finder.find(files, '.local')).toEqual({ file: 'main.asm', line: 3, column: 7, endColumn: 13 })
		expect(finder.find(files, 'helper')).toEqual({ file: 'lib.asm', line: 1, column: 2, endColumn: 8 })
		expect(finder.find(files, 'missing')).toBeNull()
		expect(finder.nameAt(`${comment} helper`, comment.length + 2)).toBeNull()
		expect(finder.nameAt('\tcall .local', 8)).toBe('.local')
	})
	it('finds equates with case-insensitive directives and case-sensitive symbol names', () => {
		const files = [{ title: 'constants.asm', code: '.EQU SIZE, 16\n.set limit, 8\n.equ SIZE_EXTRA, 32' }]
		expect(finder.find(files, 'SIZE')).toEqual({ file: 'constants.asm', line: 1, column: 6, endColumn: 10 })
		expect(finder.find(files, 'limit')).toEqual({ file: 'constants.asm', line: 2, column: 6, endColumn: 11 })
		expect(finder.find(files, 'size')).toBeNull()
		expect(finder.find([{ title: 'extra.asm', code: '.equ SIZE_EXTRA, 32' }], 'SIZE')).toBeNull()
	})
	it('registers definition navigation for its language and disposes the provider and opener', () => {
		const handles: ReturnType<typeof vi.fn>[] = []
		const disposable = () => { const dispose = vi.fn(); handles.push(dispose); return { dispose } }
		const registerDefinitionProvider = vi.fn((_language: string, _provider: Monaco.languages.DefinitionProvider) => disposable())
		const registerEditorOpener = vi.fn(disposable)
		const monaco = {
			languages: {
				register: vi.fn(), setLanguageConfiguration: disposable, setMonarchTokensProvider: disposable,
				registerCompletionItemProvider: disposable, registerHoverProvider: disposable, registerDefinitionProvider,
				CompletionItemKind: { Keyword: 17, Variable: 4 },
			},
			editor: { registerEditorOpener, registerLinkOpener: disposable },
		} as unknown as typeof Monaco
		const installed = installEditor(monaco, {} as EditorHost)
		expect(registerDefinitionProvider).toHaveBeenCalledWith(language, expect.objectContaining({ provideDefinition: expect.any(Function) }))
		expect(registerEditorOpener).toHaveBeenCalledOnce()
		installed.dispose()
		for (const dispose of handles) expect(dispose).toHaveBeenCalledOnce()
	})
})

it('finds AVR equals-form constants', () => {
	expect(avrDefinitions.find([{ title: 'avr.asm', code: '.equ COUNT = 3' }], 'COUNT')).toEqual({ file: 'avr.asm', line: 1, column: 6, endColumn: 11 })
})

it('finds 68k EQU and equals assignments, excluding star comments', () => {
	const files = [{ title: '68k.asm', code: '* COUNT equ 99\nCOUNT equ 3\nlimit = 8' }]
	expect(m68kDefinitions.find(files, 'COUNT')).toEqual({ file: '68k.asm', line: 2, column: 1, endColumn: 6 })
	expect(m68kDefinitions.find(files, 'limit')).toEqual({ file: '68k.asm', line: 3, column: 1, endColumn: 6 })
	expect(m68kDefinitions.nameAt('* COUNT equ 99', 3)).toBeNull()
})
