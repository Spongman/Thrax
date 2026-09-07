import { describe, expect, it } from 'vitest'
import type { AddPanelOptions, DockviewApi, IDockviewPanel, SerializedDockview } from 'dockview-react'

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
	const panel = (id: string, title?: string) => ({
		id,
		title,
		api: { setActive: () => {}, setTitle: () => {} },
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
		ids: () => panels.map((candidate) => candidate.id),
		restored: () => restoredFrom,
		cleared: () => cleared,
	}
}

const { buildLayout } = await import('../../components/DockLayout')

describe('dock layout', () => {
	it('opens the windows a run is watched through, and no tool', () => {
		storage.clear()
		const dock = fakeApi()
		buildLayout(dock.api, new Set())

		const opened = dock.added.filter((options) => options.component !== 'source').map((options) => options.id)
		expect(opened).toEqual(['registers', 'memory', 'callStack', 'files', 'symbols', 'console', 'history'])
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

	it('starts over only when a stored layout names a panel that no longer exists', () => {
		storeLayout([...STORED_PANELS, 'screenMagnifier'])
		const dock = fakeApi()
		buildLayout(dock.api, new Set())

		expect(dock.restored()).toBeNull()
		expect(dock.ids()).toContain('registers')
	})
})
