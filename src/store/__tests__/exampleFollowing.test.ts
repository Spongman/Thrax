import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeArchitecture } from '../../architectures/registry'
import { useTHRAXStore } from '../thraxStore'
import { fromWorkspaceDocument, toWorkspaceDocument } from '../../services/workspace'

vi.hoisted(() => {
	const data = new Map<string, string>()
	Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: { localStorage: {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => { data.set(key, value) },
	} } })
})
const state = () => useTHRAXStore.getState()
const load = (id: string) => state().loadExample(state().targetVariant!.examples[id])
beforeAll(async () => { await initializeArchitecture() })
beforeEach(async () => {
	await state().switchArchitecture('mips')
	state().openFiles([{ title: 'main.asm', code: '' }], { replace: true })
	state().setRunSpeed(null)
})

describe('untouched example ports follow the selected target', () => {
	it('reuses an empty clean editor and gives the example a clean topic filename', () => {
		const id = state().activeDocumentId
		load('factorial')
		expect(state().documents).toHaveLength(1)
		expect(state().documents[0]).toMatchObject({ id, title: 'factorial.asm', dirty: false, code: state().code })
		expect(state().exampleActivation).toMatchObject({ documentId: id, focus: true })
		state().setCode(state().code)
		state().setDocumentCode(id, state().code)
		expect(state().documents[0].dirty).toBe(false)
		state().setCode(`${state().code}\n# edited`)
		expect(state().documents[0].dirty).toBe(true)
	})
	it('opens a new tab for a nonempty clean editor and runs that example instead', async () => {
		state().openFiles([{ title: 'my-program.asm', code: 'li $t0, 42\n' }], { replace: true })
		const original = state().documents[0]
		state().assemble(); state().step()
		load('factorial')
		expect(state().documents).toHaveLength(2)
		expect(state().documents[0]).toEqual(original)
		expect(state().documents[1]).toMatchObject({ title: 'factorial.asm', dirty: false })
		expect(state().activeDocumentId).toBe(state().documents[1].id)
		expect(state().entryDocumentId).toBe(state().activeDocumentId)
		expect(state().hasMachine).toBe(false)
		await state().run()
		expect(state().console).toContain('120')
	})
	it('preserves an empty editor with unsaved edits', () => {
		state().setCode('# edited'); state().setCode('')
		const original = state().documents[0]
		load('sum')
		expect(state().documents).toHaveLength(2)
		expect(state().documents[0]).toEqual(original)
		expect(state().documents[1]).toMatchObject({ title: 'sum.asm', dirty: false })
	})
	it('keeps repeated example filenames unique and ignores unchanged inactive editor callbacks', () => {
		load('sum'); const original = state().documents[0]
		load('sum')
		expect(state().documents.map(document => document.title)).toEqual(['sum.asm', 'sum-2.asm'])
		state().setDocumentCode(original.id, original.code)
		expect(state().documents[0].dirty).toBe(false)
		state().setDocumentCode(original.id, `${original.code}\n# edited`)
		expect(state().documents[0].dirty).toBe(true)
	})
	it('uses the selected architecture extension for example files', async () => {
		await state().switchArchitecture('beta')
		load('sum')
		expect(state().documents[0]).toMatchObject({ title: 'sum.uasm', dirty: false })
	})
	it('loads the same topic across CPU families without replacing the file or tab', async () => {
		load('factorial')
		const document = state().documents[0], previous = state().code
		await state().switchArchitecture('beta')
		expect(state().code).toBe(state().targetVariant!.examples.factorial.code)
		expect(state().code).not.toBe(previous)
		expect(state().activeDocumentId).toBe(document.id)
		expect(state().documents[0]).toMatchObject({ id: document.id, title: document.title, dirty: false, example: { id: 'factorial', source: state().code } })
		await state().run(); expect(state().console).toContain('120')
		await state().switchArchitecture('mips')
		expect(state().code).toBe(previous)
	})
	it('follows native variants and FPU settings through the shared selection path', async () => {
		await state().switchArchitecture('i8086')
		await state().setTargetSetting('cpuModel', '8086'); await state().setTargetSetting('coprocessor', 'none')
		load('factorial'); const original = state().code
		await state().setTargetSetting('cpuModel', '80186')
		expect(state().code).toContain('imul ax, ax, 5')
		expect(state().code).toBe(state().targetVariant!.examples.factorial.code)
		await state().setTargetSetting('coprocessor', '8087')
		expect(state().exampleActivation).toMatchObject({ focus: false, example: { code: state().targetVariant!.examples.factorial.code } })
		await state().setTargetSetting('cpuModel', '8086')
		expect(state().code).toBe(original)
	})
	it('protects edits even after saving has cleared the dirty marker', async () => {
		load('sum')
		const changed = `${state().code}\n# My changes`
		state().setCode(changed)
		expect(state().saveProgram()).toBe(true)
		expect(state().documents[0].dirty).toBe(false)
		await state().switchArchitecture('beta')
		expect(state().code).toBe(changed)
		expect(state().workspaceSnapshot().files[0]).not.toHaveProperty('example')
	})
	it('allows Undo back to the exact loaded text to restore following', async () => {
		load('sum'); const original = state().code
		state().setCode(`${original}\n# edited`)
		state().setCode(original)
		await state().switchArchitecture('beta')
		expect(state().code).toBe(state().targetVariant!.examples.sum.code)
	})
	it('accepts the stable identity copied by the common menu', async () => {
		state().loadExample({ ...state().targetVariant!.examples.sum, id: 'sum' })
		await state().switchArchitecture('beta')
		expect(state().code).toBe(state().targetVariant!.examples.sum.code)
	})
	it('does not infer an example association from matching imported contents', async () => {
		const original = state().targetVariant!.examples.sum.code
		state().openFiles([{ title: 'custom.asm', code: original }], { replace: true })
		await state().switchArchitecture('beta')
		expect(state().code).toBe(original)
	})
	it('updates untouched inactive/hidden example tabs while protecting edited and ordinary files', async () => {
		load('sum'); const first = state().activeDocumentId
		state().createDocument(); load('factorial'); const second = state().activeDocumentId, edited = `${state().code}\n# mine`
		state().setDocumentCode(second, edited)
		state().hideDocument(first)
		state().createDocument(); state().setCode('my program'); const active = state().activeDocumentId
		await state().switchArchitecture('beta')
		expect(state().activeDocumentId).toBe(active); expect(state().code).toBe('my program')
		expect(state().documents.find(d => d.id === first)).toMatchObject({ hidden: true, code: state().targetVariant!.examples.sum.code })
		expect(state().documents.find(d => d.id === second)?.code).toBe(edited)
	})
	it('leaves missing topics untouched and resumes when a matching port becomes available', async () => {
		await state().switchArchitecture('armv8'); await state().setTargetSetting('executionState', 'arm3')
		load('cache'); const original = state().code
		await state().switchArchitecture('mips')
		expect(state().targetVariant!.examples.cache).toBeUndefined()
		expect(state().code).toBe(original)
		await state().switchArchitecture('armv8')
		expect(state().code).toBe(state().targetVariant!.examples.cache.code)
	})
	it('reapplies required windows and bitmap configuration for the destination port', async () => {
		await state().switchArchitecture('mos6502'); await state().setTargetSetting('cpuModel', 'nmos6502')
		load('mandelbrot')
		expect(state().bitmapPalette).not.toBeNull()
		await state().switchArchitecture('sh')
		const example = state().targetVariant!.examples.mandelbrot
		expect(state().code).toBe(example.code)
		expect(state().bitmapFormat).toEqual(example.bitmap ?? null)
		expect(state().bitmapPalette).toEqual(example.bitmapPalette ?? null)
		expect(state().exampleActivation).toMatchObject({ focus: false, example: { tools: ['bitmap'] } })
	})
	it('retains explicit clean provenance through saved workspaces without inferring it for other files', async () => {
		load('sum')
		const workspace = fromWorkspaceDocument(toWorkspaceDocument(state().workspaceSnapshot()))!
		state().openFiles(workspace.files, { replace: true })
		await state().switchArchitecture('beta')
		expect(state().code).toBe(state().targetVariant!.examples.sum.code)
	})
	it('checks the live document after asynchronous backend preparation, preserving intervening edits', async () => {
		await state().switchArchitecture('armv8'); await state().setTargetSetting('executionState', 'aarch64')
		load('sum')
		const services = state().target!.services, prepare = services.prepare!.bind(services)
		let release!: () => void
		vi.spyOn(services, 'isPrepared').mockReturnValue(false)
		vi.spyOn(services, 'prepare').mockImplementation(settings => new Promise<void>((resolve, reject) => { release = () => { void prepare(settings).then(resolve, reject) } }))
		try {
			const pending = state().setTargetSetting('executionState', 'cortex-m0')
			const edited = `${state().code}\n// edited during download`; state().setCode(edited)
			release(); await pending
			expect(state().targetSettings.executionState).toBe('cortex-m0')
			expect(state().code).toBe(edited)
		} finally { vi.restoreAllMocks() }
	})
})
