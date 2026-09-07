import { describe, expect, it } from 'vitest'
import { INITIAL_PANELS, PANELS, menuLabel, panelById, panelsIn } from '../panels'

describe('the panel catalogue', () => {
	it('names every panel once', () => {
		const ids = PANELS.map((panel) => panel.id)
		expect(new Set(ids).size).toBe(ids.length)
	})

	it('opens every window, and no tool', () => {
		// A tool that starts by itself costs a tab nobody asked for and, now that
		// its code is fetched on demand, a download nobody asked for either.
		expect(INITIAL_PANELS.map((panel) => panel.id)).toEqual(['registers', 'callStack', 'files', 'symbols', 'memory', 'console', 'history'])
		expect(INITIAL_PANELS.every((panel) => panel.group === 'window')).toBe(true)
	})

	it('gives each dock group a leader that is open from the start', () => {
		// A panel opened later joins its leader's group, so the leader has to be
		// one of the panels that is already there.
		for (const dock of ['side', 'bottom'] as const) {
			const leader = dock === 'side' ? 'registers' : 'memory'
			expect(panelById(leader)?.dock).toBe(dock)
			expect(panelById(leader)?.initial).toBe(true)
		}
	})

	it('splits the menus between the workspace views and the tools', () => {
		expect(panelsIn('window').map((panel) => panel.id)).toEqual(['registers', 'callStack', 'files', 'symbols', 'memory', 'console', 'history'])
		expect(panelsIn('tool')).toHaveLength(11)
		expect(panelsIn('window').length + panelsIn('tool').length).toBe(PANELS.length)
	})

	it('has neither a magnifier nor a page about the tools to offer', () => {
		expect(PANELS.some((panel) => panel.id === 'screenMagnifier')).toBe(false)
		expect(PANELS.some((panel) => panel.id === 'introToTools')).toBe(false)
	})

	it('says what every tool watches, where the tool is chosen', () => {
		// The menu is the only place a tool is described now, so a tool without a
		// line here is one nobody can tell apart from its neighbours.
		for (const tool of panelsIn('tool')) {
			expect(tool.description, tool.id).toBeTruthy()
		}
		// A window is named by what it shows, so it needs no line of its own.
		expect(panelsIn('window').every((panel) => panel.description === undefined)).toBe(true)
	})

	it('reads a full name in the menu and a short one on the tab', () => {
		// The tab shares its row with every other tab; the menu has the width.
		expect(panelById('branchHistory')?.title).toBe('Branches')
		expect(menuLabel(panelById('branchHistory')!)).toBe('Branch History Table')
		// Without a longer name the tab's own is what the menu shows.
		expect(menuLabel(panelById('registers')!)).toBe('Registers')
	})
})
