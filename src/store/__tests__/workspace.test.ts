import { beforeAll as beforeArchitectureTests } from 'vitest'
import { initializeArchitecture } from '../../architectures/registry'
beforeArchitectureTests(async () => { await initializeArchitecture() })
import { describe, expect, it, vi } from 'vitest'
import { assembleMips } from '../../architectures/mips/assembler'

// The download itself needs a document; what it was handed is what matters here.
vi.mock('../../services/hexTextExport', () => ({ downloadHexText: vi.fn() }))

const storage = new Map<string, string>()

// The store reads its settings while it is being created, so storage has to
// answer before the module is imported.
Object.defineProperty(globalThis, 'window', {
	value: {
		localStorage: {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => { storage.set(key, value) },
		},
	},
	writable: true,
})

const { downloadHexText } = await import('../../services/hexTextExport')
const { shownDocuments, useTHRAXStore } = await import('../thraxStore')
const { fromWorkspaceDocument, toWorkspaceDocument } = await import('../../services/workspace')

const state = () => useTHRAXStore.getState()
const titleOf = (id: string) => state().documents.find((document) => document.id === id)?.title
const titles = () => state().documents.map((document) => document.title)
const isOpen = (id: string) => state().documents.some((document) => document.id === id)

/** Two open files, so a collision or a close has something to happen between. */
const openTwoFiles = (first: string, second: string, dirty = false) => {
	useTHRAXStore.setState({
		documents: [
			{ id: 'one', title: first, code: '', dirty },
			{ id: 'two', title: second, code: '', dirty },
		],
		activeDocumentId: 'one',
		code: '',
	})
}

describe('hex text export', () => {
	it('exports the words the program would actually run', () => {
		// `mulo` puts a NOP in the branch's delay slot only when the setting is on,
		// so its expansion is where the two option sets diverge.
		const code = 'main:\n\tli $t0, 3\n\tli $t1, 4\n\tmulo $t2, $t0, $t1\n'
		state().setCode(code)
		state().setTargetSetting('delayedBranching', true)

		expect(state().exportHexText()).toBe(true)

		const files = [{ name: 'main.asm', code }]
		const delayed = assembleMips(files, ['main.asm'], { delayedBranching: true }).machineCode
		const undelayed = assembleMips(files, ['main.asm'], { delayedBranching: false }).machineCode
		expect(delayed).not.toEqual(undelayed)
		expect(vi.mocked(downloadHexText).mock.calls[0][0]).toEqual(delayed)

		state().setTargetSetting('delayedBranching', false)
	})
})

describe('saving', () => {
	it('clears the dirty marks of the files it wrote out', () => {
		state().setCode('# edited\n')
		expect(state().documents.every((document) => document.dirty)).toBe(true)

		expect(state().saveProgram()).toBe(true)
		expect(state().documents.some((document) => document.dirty)).toBe(false)
	})
})

describe('cache settings', () => {
	it('publishes the settings the cache is really using', () => {
		// Associativity beyond the block count is a fully associative cache.
		state().setCacheSettings({ blockCount: 4, blockSizeBytes: 16, associativity: 8, replacement: 'lru' })

		expect(state().cacheSettings.associativity).toBe(4)
		expect(state().cacheSettings).toEqual(state().cache.settings)
	})
})

describe('file titles', () => {
	it('publishes a reveal request when selecting the current file again', () => {
		openTwoFiles('one.asm', 'two.asm')
		const previous = state().documentSelection
		state().selectDocument('one')
		expect(state().documentSelection).toBe(previous + 1)
		state().hideDocument('one')
		state().hideDocument('two')
		state().selectDocument('two')
		expect(shownDocuments(state().documents).map((file) => file.id)).toEqual(['two'])
		expect(state().documentSelection).toBe(previous + 2)
	})

	it('gives a new file a title no open file has', () => {
		openTwoFiles('untitled-3.asm', 'other.asm')
		state().createDocument()

		expect(new Set(titles()).size).toBe(3)
		expect(titleOf(state().activeDocumentId)).toBe('untitled.asm')
	})

	it('renames around a title another file already has', () => {
		openTwoFiles('shared.asm', 'other.asm')
		state().renameDocument('two', 'shared.asm')

		expect(titleOf('one')).toBe('shared.asm')
		expect(titleOf('two')).toBe('shared-2.asm')
	})

	it('leaves a title alone when no other file has it', () => {
		openTwoFiles('shared.asm', 'other.asm')
		state().renameDocument('two', 'renamed.asm')

		expect(titleOf('two')).toBe('renamed.asm')
	})
})

describe('document ids', () => {
	it('gives two files created in the same millisecond different ids', () => {
		// The clock is pinned so the collision is certain rather than a race.
		const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
		openTwoFiles('one.asm', 'two.asm')
		state().createDocument()
		const first = state().activeDocumentId
		state().createDocument()
		const second = state().activeDocumentId
		now.mockRestore()

		expect(first).not.toBe(second)

		// A shared id renamed both files, and dockview then collapsed them.
		state().renameDocument(second, 'renamed.asm')
		expect(titleOf(first)).toBe('untitled.asm')
		expect(titleOf(second)).toBe('renamed.asm')
	})
})

describe('closing a tab', () => {
	it('puts the file away rather than out of the project', () => {
		openTwoFiles('one.asm', 'two.asm', true)
		state().requestCloseDocument('two')

		expect(state().pendingClose).toBe(null)
		expect(isOpen('two')).toBe(true)
		expect(state().documents.find((document) => document.id === 'two')?.hidden).toBe(true)
		expect(shownDocuments(state().documents).map((document) => document.id)).toEqual(['one'])
	})

	it('brings the tab to the left forward when the active one goes', () => {
		openTwoFiles('one.asm', 'two.asm')
		state().selectDocument('two')
		state().requestCloseDocument('two')

		expect(state().activeDocumentId).toBe('one')
	})

	it('brings a put-away file back when it is selected', () => {
		openTwoFiles('one.asm', 'two.asm')
		state().hideDocument('two')
		state().selectDocument('two')

		expect(state().activeDocumentId).toBe('two')
		expect(state().documents.find((document) => document.id === 'two')?.hidden).toBeUndefined()
	})
})

describe('removing a file', () => {
	it('removes a file with nothing unsaved in it', () => {
		openTwoFiles('one.asm', 'two.asm')
		state().requestDeleteDocument('two')

		expect(state().pendingClose).toBe(null)
		expect(isOpen('two')).toBe(false)
	})

	it('asks before discarding an edited file, and keeps it when the answer is no', () => {
		openTwoFiles('one.asm', 'two.asm', true)
		state().requestDeleteDocument('two')

		expect(state().pendingClose).toBe('two')
		expect(isOpen('two')).toBe(true)

		state().cancelCloseDocument()
		expect(state().pendingClose).toBe(null)
		expect(isOpen('two')).toBe(true)
	})

	it('removes the edited file once the answer is yes', () => {
		openTwoFiles('one.asm', 'two.asm', true)
		state().requestDeleteDocument('two')
		state().confirmCloseDocument()

		expect(state().pendingClose).toBe(null)
		expect(isOpen('two')).toBe(false)
	})
})

describe('opening files', () => {
	it('requests visibility when opening the current file again, including after all tabs close', () => {
		openTwoFiles('one.asm', 'two.asm')
		const previous = state().documentSelection
		state().openFiles([{ title: 'one.asm', code: '# reload\n' }])
		expect(state().documentSelection).toBe(previous + 1)
		state().hideDocument('one')
		state().hideDocument('two')
		state().openFiles([{ title: 'two.asm', code: '# reopen\n' }])
		expect(state().documentSelection).toBe(previous + 2)
		expect(shownDocuments(state().documents).map((file) => file.id)).toEqual(['two'])
	})

	it('adds files to the project and brings the first forward', () => {
		openTwoFiles('one.asm', 'two.asm')
		state().openFiles([{ title: 'lib.asm', code: '# lib\n' }, { title: 'more.asm', code: '' }])

		expect(titles()).toEqual(['one.asm', 'two.asm', 'lib.asm', 'more.asm'])
		expect(titleOf(state().activeDocumentId)).toBe('lib.asm')
		expect(state().code).toBe('# lib\n')
	})

	it('reloads a file opened again instead of copying it', () => {
		openTwoFiles('one.asm', 'two.asm', true)
		state().openFiles([{ title: 'two.asm', code: '# fresh\n' }])

		expect(titles()).toEqual(['one.asm', 'two.asm'])
		const two = state().documents.find((document) => document.id === 'two')!
		expect(two.code).toBe('# fresh\n')
		expect(two.dirty).toBe(false)
	})

	it('replaces the project when asked to', () => {
		openTwoFiles('one.asm', 'two.asm')
		state().openFiles([{ title: 'a.asm', code: '' }, { title: 'b.asm', code: '' }], { replace: true, active: 'b.asm', assembleAll: true })

		expect(titles()).toEqual(['a.asm', 'b.asm'])
		expect(titleOf(state().activeDocumentId)).toBe('b.asm')
		expect(state().settings.assembleAll).toBe(true)
		state().setSetting('assembleAll', false)
	})

	it('snapshots the live text of the file being typed into', () => {
		openTwoFiles('one.asm', 'two.asm')
		state().setCode('# typing\n')

		expect(state().workspaceSnapshot()).toEqual({
			files: [{ title: 'one.asm', code: '# typing\n' }, { title: 'two.asm', code: '' }],
			active: 'one.asm',
			assembleAll: false,
			architecture: 'mips',
		})
	})
})

describe('autosave', () => {
	it('follows an edit into storage a little behind it', async () => {
		storage.delete('thrax-web.autosave')
		openTwoFiles('one.asm', 'two.asm')
		state().setCode('# kept\n')
		expect(storage.has('thrax-web.autosave')).toBe(false)

		await new Promise((resolve) => setTimeout(resolve, 600))
		const saved = JSON.parse(storage.get('thrax-web.autosave')!)
		expect(saved.format).toBe('thrax-workspace')
		expect(saved.files).toEqual([{ title: 'one.asm', code: '# kept\n' }, { title: 'two.asm', code: '' }])
		expect(saved.active).toBe('one.asm')
	})
})

describe('loading', () => {
	it('separates saved files that share a title', () => {
		storage.set('thrax-web.saved-program', JSON.stringify({
			version: 2,
			code: '# one\n',
			savedAt: '2026-01-01T00:00:00.000Z',
			documents: [
				{ id: 'one', title: 'shared.asm', code: '# one\n', dirty: false },
				{ id: 'two', title: 'shared.asm', code: '# two\n', dirty: false },
			],
			activeDocumentId: 'one',
		}))

		expect(state().loadProgram()).toBe(true)
		expect(titles()).toEqual(['shared.asm', 'shared-2.asm'])
	})
})

describe('workspace architecture', () => {
	const stored = (architecture?: string) => JSON.stringify({
		format: 'thrax-workspace',
		version: 1,
		assembleAll: false,
		...(architecture === undefined ? {} : { architecture }),
		files: [{ title: 'kept.asm', code: '# kept\n' }],
	})

	it('migrates a workspace saved without an architecture to mips', () => {
		storage.set('thrax-web.saved-program', stored())

		expect(state().loadProgram()).toBe(true)
		expect(titles()).toEqual(['kept.asm'])
		expect(state().workspaceSnapshot().architecture).toBe('mips')
	})

	it('writes the architecture and reads the same one back', () => {
		expect(state().saveProgram()).toBe(true)
		expect(JSON.parse(storage.get('thrax-web.saved-program')!).architecture).toBe('mips')

		expect(fromWorkspaceDocument(toWorkspaceDocument({ files: [{ title: 'a.asm', code: '' }], assembleAll: false, architecture: 'beta' })))
			.toMatchObject({ architecture: 'beta' })
	})

	it('reports an unknown architecture and leaves the stored workspace alone', () => {
		const raw = stored('nonesuch')
		storage.set('thrax-web.saved-program', raw)
		openTwoFiles('one.asm', 'two.asm')

		expect(state().loadProgram()).toBe(false)
		expect(titles()).toEqual(['one.asm', 'two.asm'])
		expect(state().diagnostics[0]).toMatchObject({ severity: 'error' })
		expect(state().diagnostics[0].message).toContain("'nonesuch'")
		expect(state().console).toContain('nonesuch')

		expect(state().saveProgram()).toBe(false)
		expect(storage.get('thrax-web.saved-program')).toBe(raw)
	})

	it('does not open or overwrite an autosave naming an unknown architecture', async () => {
		const raw = stored('nonesuch')
		storage.set('thrax-web.autosave', raw)
		vi.resetModules()
		await (await import('../../architectures/registry')).initializeArchitecture()
		const fresh = (await import('../thraxStore')).useTHRAXStore

		expect(fresh.getState().documents.map((document) => document.title)).not.toContain('kept.asm')
		expect(fresh.getState().diagnostics[0].message).toContain("'nonesuch'")

		fresh.getState().setCode('# edited\n')
		await new Promise((resolve) => setTimeout(resolve, 600))
		expect(storage.get('thrax-web.autosave')).toBe(raw)
	})
})
