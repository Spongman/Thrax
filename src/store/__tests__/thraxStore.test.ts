import { describe, expect, it } from 'vitest'
import { useTHRAXStore } from '../thraxStore'

describe('store smoke', () => {
	it('seeds the tool views and settings from the registry', () => {
		const state = useTHRAXStore.getState()
		expect(state.statistics.total).toBe(0)
		expect(state.profile.total).toBe(0)
		expect(state.cache.settings.blockCount).toBe(8)
		expect(state.branchHistory.entries).toHaveLength(16)
		expect(state.pipeline.settings.windowSize).toBe(24)
		expect(state.cacheSettings.blockCount).toBe(8)
		expect(state.branchHistorySettings.entryCount).toBe(16)
		expect(state.pipelineSettings.windowSize).toBe(24)
	})

	it('assembles and steps, moving the tool readings', () => {
		// A tool runs only while something consumes it, so its panel opens first.
		useTHRAXStore.getState().setOpenPanels(['statistics', 'pipeline'])
		useTHRAXStore.getState().setHeatMap(true)
		useTHRAXStore.getState().assemble()
		useTHRAXStore.getState().step()
		const state = useTHRAXStore.getState()
		expect(state.statistics.total).toBe(1)
		expect(state.profile.total).toBe(1)
		expect(state.pipeline.instructions).toBe(1)
		// A tool that saw nothing keeps its reading, so its panel does not redraw.
		expect(useTHRAXStore.getState().cache).toBe(state.cache)
	})

	it('reports assembly errors as diagnostics rather than throwing', async () => {
		useTHRAXStore.getState().setCode('main:\n\tj missing\n')
		useTHRAXStore.getState().refreshAssembly()
		const afterRefresh = useTHRAXStore.getState()
		expect(afterRefresh.diagnostics).toHaveLength(1)
		expect(afterRefresh.diagnostics[0]).toMatchObject({ severity: 'error', line: 2, file: 'main.asm' })
		// Editing reports live without disturbing the console.
		expect(afterRefresh.console).not.toContain('Error:')

		// Running says so in the console, and no longer throws at the caller.
		await expect(useTHRAXStore.getState().run()).resolves.toBeUndefined()
		expect(useTHRAXStore.getState().console).toContain('Undefined label: missing')

		useTHRAXStore.getState().setCode('main:\n\tnop\n')
		useTHRAXStore.getState().assemble()
		expect(useTHRAXStore.getState().diagnostics).toEqual([])
	})
})

describe('putting the machine at a history entry', () => {
	// Long enough that a publish per instruction would be visible.
	const COUNTING = `	li $t0, 40
loop:	addi $t0, $t0, -1
	bgtz $t0, loop
	li $v0, 10
	syscall
`

	/** Runs the program to the end and hands back its whole history. */
	const runToEnd = async () => {
		useTHRAXStore.getState().setCode(COUNTING)
		useTHRAXStore.getState().assemble()
		await useTHRAXStore.getState().run()
		const entries = useTHRAXStore.getState().executionHistory
		expect(entries.length).toBeGreaterThan(80)
		return entries
	}

	/** How many times the store published while `move` ran. */
	const publishes = (move: () => void): number => {
		let count = 0
		const unsubscribe = useTHRAXStore.subscribe(() => { count++ })
		move()
		unsubscribe()
		return count
	}

	it('publishes once however far it moves', async () => {
		// Stepping there through `step` published the whole machine per
		// instruction, and each of those snapshots costs about as much as the
		// entire run: the mandelbrot example runs in 88ms and leaves 100,228
		// entries, so a click near its end sat for minutes.
		const entries = await runToEnd()
		const first = entries.at(0)!
		const last = entries.at(entries.length - 1)!

		expect(publishes(() => useTHRAXStore.getState().moveHistoryTo(first.id))).toBe(1)
		expect(publishes(() => useTHRAXStore.getState().moveHistoryTo(last.id))).toBe(1)
	})

	it('lands on the entry asked for, from either side of it', async () => {
		const entries = await runToEnd()
		const middle = Math.floor(entries.length / 2)

		// Backwards from the end, then forwards from the start: the cursor sits on
		// the entry, whose instruction is the next to run.
		useTHRAXStore.getState().moveHistoryTo(entries.at(middle)!.id)
		expect(useTHRAXStore.getState().historyCursor).toBe(middle)

		useTHRAXStore.getState().moveHistoryTo(entries.at(0)!.id)
		useTHRAXStore.getState().moveHistoryTo(entries.at(middle)!.id)
		expect(useTHRAXStore.getState().historyCursor).toBe(middle)
	})

	it('does nothing for an entry that is not in the log', async () => {
		const entries = await runToEnd()
		const before = useTHRAXStore.getState().historyCursor
		useTHRAXStore.getState().moveHistoryTo(entries.at(entries.length - 1)!.id + 1000)
		expect(useTHRAXStore.getState().historyCursor).toBe(before)
	})
})

describe('publishing memory', () => {
	const STORING = `	li $t0, 7
	sw $t0, 0($gp)
	li $v0, 10
	syscall
`

	it('hands over the machine own map rather than a copy of it', () => {
		useTHRAXStore.getState().setCode(STORING)
		useTHRAXStore.getState().assemble()
		useTHRAXStore.getState().step()
		const first = useTHRAXStore.getState().memory
		useTHRAXStore.getState().step()
		const second = useTHRAXStore.getState().memory

		// Rebuilding every written word per publish cost about as much as running
		// the whole program, so the words are handed straight over.
		expect(second.words).toBe(first.words)
		// The wrapper is what changes, since the map is written in place and a
		// selector comparing it would never see a step happen.
		expect(second).not.toBe(first)
	})

	it('reads a word the program wrote, by word address', async () => {
		useTHRAXStore.getState().setCode(STORING)
		useTHRAXStore.getState().assemble()
		await useTHRAXStore.getState().run()
		const { memory, registers } = useTHRAXStore.getState()
		expect(memory.words.get((registers.$gp >>> 0) >>> 2)).toBe(7)
	})
})

describe('sending a panel somewhere', () => {
	it('counts every ask, so going to the same place twice still lands', () => {
		// The destination is what a panel reveals; the count is what tells it a
		// fresh ask happened.  Without the count, clicking the same register or
		// address a second time would set identical state and nothing would move.
		const store = () => useTHRAXStore.getState()

		store().focusRegister('$t0')
		const firstRegister = store().focusedRegister
		store().focusRegister('$t0')
		expect(store().focusedRegister?.name).toBe('$t0')
		expect(store().focusedRegister?.request).toBe((firstRegister?.request ?? 0) + 1)

		store().focusMemoryAddress(0x10010000)
		const firstAddress = store().focusedMemory
		store().focusMemoryAddress(0x10010000)
		expect(store().focusedMemory?.address).toBe(0x10010000)
		expect(store().focusedMemory?.request).toBe((firstAddress?.request ?? 0) + 1)

		store().focusSourceLine('main.asm', 7)
		const firstLine = store().focusedSource
		store().focusSourceLine('main.asm', 7)
		expect(store().focusedSource).toMatchObject({ file: 'main.asm', line: 7 })
		expect(store().focusedSource?.request).toBe((firstLine?.request ?? 0) + 1)
	})
})

describe('pointing at something', () => {
	/** How many times the store published while `move` ran. */
	const publishes = (move: () => void): number => {
		let count = 0
		const unsubscribe = useTHRAXStore.subscribe(() => { count++ })
		move()
		unsubscribe()
		return count
	}

	it('says nothing when the pointer has not moved to anything new', () => {
		// The editor reports the address under the pointer on every mouse move,
		// and much of the workspace reads the store whole, so repeating what it
		// already says would re-render every panel sixty times a second.
		const store = () => useTHRAXStore.getState()
		store().hover({ address: null })

		expect(publishes(() => store().hover({ address: 0x00400000 }))).toBe(1)
		expect(publishes(() => store().hover({ address: 0x00400000 }))).toBe(0)
		expect(publishes(() => store().hover({ address: null }))).toBe(1)
		expect(publishes(() => store().hover({ address: null }))).toBe(0)

		store().hover({ register: null })
		expect(publishes(() => store().hover({ register: '$t0' }))).toBe(1)
		expect(publishes(() => store().hover({ register: '$t0' }))).toBe(0)

		// A panel speaks only for what it knows: naming one kind leaves the rest
		// as they were, and a hover of several kinds at once is one publish.
		store().hover({ address: null, register: null, symbol: null })
		expect(publishes(() => store().hover({ symbol: 'buffer', address: 0x10010000 }))).toBe(1)
		expect(store().hovered).toEqual({ address: 0x10010000, register: null, symbol: 'buffer' })
		expect(publishes(() => store().hover({ register: '$t0' }))).toBe(1)
		expect(store().hovered.symbol).toBe('buffer')
	})
})
