import { describe, expect, it } from 'vitest'
import type { AddPanelOptions, DockviewApi, IDockviewPanel, SerializedDockview } from 'dockview-react'
import type { SourceDocument } from '../thraxStore'

const storage = new Map<string, string>()

// The store and the layout both read storage as they are created, so it has to
// answer before either module is imported.
Object.defineProperty(globalThis, 'window', {
	value: {
		localStorage: {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => { storage.set(key, value) },
		},
	},
	writable: true,
})

const LAYOUT_KEY = 'thrax-web.dock-layout'
/**
 * Written out rather than imported: a release that bumps the version throws
 * away every layout stored by the release before it, so this pins the version
 * a shipped layout carries and fails if it moves.
 */
const SHIPPED_LAYOUT_VERSION = 3

/** A stored layout that has been pared back to the windows and one tool. */
const STORED_PANELS = ['registers', 'callStack', 'files', 'symbols', 'memory', 'console', 'history', 'cache']

function storeLayout(components: string[]) {
	const panels = Object.fromEntries(components.map((component) => [component, { id: component, contentComponent: component }]))
	const layout = { grid: { root: {}, width: 800, height: 600, orientation: 'HORIZONTAL' }, panels } as unknown as SerializedDockview
	storage.set(LAYOUT_KEY, JSON.stringify({ version: SHIPPED_LAYOUT_VERSION, layout }))
}

/** Only the handful of methods buildLayout drives, over a plain list of panels. */
function fakeApi() {
	const panels: IDockviewPanel[] = []
	const added: AddPanelOptions[] = []
	let restoredFrom: SerializedDockview | null = null
	let cleared = 0
	const activated: string[] = []
	const panel = (id: string, title?: string) => ({
		id,
		title,
		api: { setActive: () => { activated.push(id) }, setTitle: () => {} },
	} as unknown as IDockviewPanel)
	const api = {
		get panels() { return panels },
		getPanel: (id: string) => panels.find((candidate) => candidate.id === id),
		addPanel: (options: AddPanelOptions) => {
			added.push(options)
			const created = panel(options.id, options.title)
			panels.push(created)
			return created
		},
		removePanel: (target: IDockviewPanel) => { panels.splice(panels.indexOf(target), 1) },
		fromJSON: (layout: SerializedDockview) => {
			restoredFrom = layout
			for (const id of Object.keys(layout.panels)) panels.push(panel(id))
		},
		clear: () => { cleared += 1; panels.length = 0 },
	}
	return {
		api: api as unknown as DockviewApi,
		added,
		activated,
		ids: () => panels.map((candidate) => candidate.id),
		restored: () => restoredFrom,
		cleared: () => cleared,
	}
}

const { buildLayout, syncFilePanels } = await import('../../components/DockLayout')

describe('dock layout', () => {
	it('does not recreate a closing editor when Dockview activates its neighbour before close completes', () => {
		const dock = fakeApi(), removing = new Set<string>()
		const documents: SourceDocument[] = ['first.asm', 'second.asm'].map((title, index) => ({ id: String(index), title, code: 'nop', dirty: false }))
		syncFilePanels(dock.api, documents, removing, '0')
		dock.api.removePanel(dock.api.getPanel('file:0')!)
		const pending = new Set(['file:0'])
		// Dockview selects the second tab before its deferred remove notification
		// can hide the first document. The store still lists both at this point.
		syncFilePanels(dock.api, documents, removing, '1', true, pending)
		expect(dock.ids()).toEqual(['file:1'])
		expect(dock.activated[dock.activated.length - 1]).toBe('file:1')
		pending.clear()
		syncFilePanels(dock.api, [{ ...documents[0], hidden: true }, documents[1]], removing, '1')
		expect(dock.ids()).toEqual(['file:1'])
	})

	it('keeps a panel that Dockview removes and re-adds while moving it', () => {
		const dock = fakeApi(), removing = new Set<string>()
		const document: SourceDocument = { id: 'one', title: 'one.asm', code: 'nop', dirty: false }
		syncFilePanels(dock.api, [document], removing, 'one')
		dock.api.removePanel(dock.api.getPanel('file:one')!)
		dock.api.addPanel({ id: 'file:one', component: 'source', title: 'one.asm' })
		syncFilePanels(dock.api, [document], removing, 'one', false, new Set(['file:one']))
		expect(dock.ids()).toEqual(['file:one'])
		expect(removing.size).toBe(0)
	})

	it('reveals a reopened file after every editor panel has closed', () => {
		const dock = fakeApi()
		dock.api.addPanel({ id: 'memory', component: 'memory' })
		const document = { id: 'one', title: 'one.asm', code: '', dirty: false } as SourceDocument
		syncFilePanels(dock.api, [document], new Set(), 'one')
		expect(dock.added[dock.added.length - 1]?.position).toEqual({ referencePanel: 'memory', direction: 'above' })
		expect(dock.activated).toEqual(['file:one'])
		syncFilePanels(dock.api, [{ ...document, hidden: true }], new Set(), 'one')
		expect(dock.api.getPanel('file:one')).toBeUndefined()
		syncFilePanels(dock.api, [document], new Set(), 'one')
		expect(dock.activated).toEqual(['file:one', 'file:one'])
	})

	it('reveals an existing editor on selection, while source updates leave tools in front', () => {
		const dock = fakeApi()
		const document = { id: 'one', title: 'one.asm', code: '', dirty: false } as SourceDocument
		syncFilePanels(dock.api, [document], new Set(), 'one')
		dock.activated.length = 0
		syncFilePanels(dock.api, [{ ...document, code: 'new code' }], new Set(), 'one')
		expect(dock.activated).toEqual([])
		syncFilePanels(dock.api, [document], new Set(), 'one', true)
		expect(dock.activated).toEqual(['file:one'])
	})

	it('opens the windows a run is watched through, and no tool', () => {
		storage.clear()
		const dock = fakeApi()
		buildLayout(dock.api, new Set())

		const opened = dock.added.filter((options) => options.component !== 'source').map((options) => options.id)
		expect(opened).toEqual(['files', 'registers', 'memory', 'callStack', 'symbols', 'console', 'history'])
		const files = dock.added.find((options) => options.id === 'files')!
		// No reference panel: split the whole workspace, including its bottom row.
		expect(files.position).toEqual({ direction: 'left' })
		expect(files.initialWidth).toBe(220)
		// A tool is opened from the menu, so nothing fetches its code on load.
		for (const id of ['cache', 'xray', 'marsBot', 'digitalLab']) expect(dock.ids()).not.toContain(id)
	})

	it('keeps a stored arrangement rather than putting back what it left out', () => {
		storeLayout(STORED_PANELS)
		const dock = fakeApi()
		buildLayout(dock.api, new Set())

		// The stored arrangement was restored, not thrown away for the default one.
		expect(dock.restored()).not.toBeNull()
		expect(dock.cleared()).toBe(0)
		for (const id of STORED_PANELS) expect(dock.ids()).toContain(id)

		// Every window it holds is already there, so nothing is added back: closing
		// a panel is how it is turned off, and it must stay closed.
		expect(dock.added.filter((options) => options.component !== 'source')).toEqual([])
	})

	it('adds back a window a stored arrangement predates', () => {
		storeLayout(['registers', 'files', 'symbols', 'memory', 'console', 'history'])
		const dock = fakeApi()
		buildLayout(dock.api, new Set())

		const added = dock.added.filter((options) => options.component !== 'source')
		expect(added.map((options) => options.id)).toEqual(['callStack'])
		const reference = added[0].position && 'referencePanel' in added[0].position ? added[0].position.referencePanel : undefined
		expect(reference).toBe('registers')
	})

	it('keeps a panel any architecture contributes, whichever target is active', () => {
		storeLayout([...STORED_PANELS, 'xray', 'marsBot'])
		const dock = fakeApi()
		buildLayout(dock.api, new Set())

		expect(dock.restored()).not.toBeNull()
		expect(dock.ids()).toContain('xray')
		expect(dock.ids()).toContain('marsBot')
	})

	it('starts over only when a stored layout names a panel that no longer exists', () => {
		storeLayout([...STORED_PANELS, 'screenMagnifier'])
		const dock = fakeApi()
		buildLayout(dock.api, new Set())

		expect(dock.restored()).toBeNull()
		expect(dock.ids()).toContain('registers')
	})
})
