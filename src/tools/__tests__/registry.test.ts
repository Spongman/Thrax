import { beforeEach, describe, expect, it } from 'vitest'
import type { ExecutionObserver, MachineConfig } from '../../core/observer'
import { build, withExit } from '../../core/__tests__/helpers'
import { DEFAULT_MEMORY_REFERENCE_SETTINGS } from '../memoryReference'
import { PipelineModel } from '../pipeline'
import { ToolRegistry, createToolRegistry, type Tool } from '../registry'

const store = new Map<string, string>()

// The stored-setting helpers reach for `window` when they are called, not when
// they are imported, so a stub is all the node environment needs.
Object.defineProperty(globalThis, 'window', {
	value: {
		localStorage: {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => { store.set(key, value) },
		},
	},
	writable: true,
})

interface FakeSettings {
	label: string
}

const FAKE_DEFAULTS: FakeSettings = { label: 'default' }

/** A tool with no simulator behind it, so the registry can be driven directly. */
class FakeTool implements Tool<FakeSettings, { label: string, reads: number }> {
	settings: FakeSettings = FAKE_DEFAULTS
	machines: MachineConfig[] = []
	reads = 0
	resets = 0

	configure(settings: FakeSettings) {
		this.settings = settings
	}

	onConfigure(machine: MachineConfig) {
		this.machines.push(machine)
	}

	onMemoryRead() {
		this.reads += 1
	}

	onReset() {
		this.resets += 1
		this.reads = 0
	}

	snapshot() {
		return { label: this.settings.label, reads: this.reads }
	}
}

const isFakeSettings = (value: unknown) => typeof (value as FakeSettings | null)?.label === 'string'

function fakeRegistry() {
	const tool = new FakeTool()
	const other = new FakeTool()
	const registry = new ToolRegistry([
		{ key: 'fake', tool, setting: { storageKey: 'tools.fake', defaults: FAKE_DEFAULTS, isValid: isFakeSettings } },
		{ key: 'other', tool: other },
	] as const)
	return { tool, other, registry }
}

/** Only the observer list matters to the registry, so a stand-in will do. */
const fakeSimulator = () => ({ observers: [] as ExecutionObserver[] })

/** Every tool of the real registry, for the tests that assert on all of them. */
const EVERY_TOOL = new Set([
	'statistics', 'profile', 'cache', 'branchHistory', 'pipeline',
	'memoryReference', 'marsBot', 'digitalLab', 'scavengerHunt',
])

describe('tool registry', () => {
	beforeEach(() => store.clear())

	it('starts every wanted tool on the machine it is attached to', () => {
		const { tool, other, registry } = fakeRegistry()
		const simulator = fakeSimulator()
		registry.setWanted(new Set(['fake', 'other']))
		registry.attach(simulator, { delayedBranching: true })

		expect(tool.resets).toBe(1)
		expect(other.resets).toBe(1)
		expect(tool.machines).toEqual([{ delayedBranching: true }])
		expect(other.machines).toEqual([{ delayedBranching: true }])
		expect(simulator.observers).toHaveLength(2)
	})

	it('reaches the tools through the observer interface alone', () => {
		const { tool, registry } = fakeRegistry()
		const simulator = fakeSimulator()
		registry.setWanted(new Set(['fake', 'other']))
		registry.attach(simulator, { delayedBranching: false })

		const observer = simulator.observers[0]
		expect(observer).not.toBe(tool)
		// A callback the tool does not implement is left off, so the simulator skips it.
		expect(observer.onInstruction).toBeUndefined()
		observer.onMemoryRead?.(0x10010000, 4)
		expect(tool.reads).toBe(1)
	})

	it('re-snapshots only the tools that saw something', () => {
		const { registry } = fakeRegistry()
		const simulator = fakeSimulator()
		registry.setWanted(new Set(['fake', 'other']))
		registry.attach(simulator, { delayedBranching: false })

		const first = registry.views()
		expect(registry.views().fake).toBe(first.fake)

		simulator.observers[0].onMemoryRead?.(0x10010000, 4)
		const second = registry.views()
		expect(second.fake).not.toBe(first.fake)
		expect(second.fake.reads).toBe(1)
		// The tool that saw nothing keeps the reading the view already has.
		expect(second.other).toBe(first.other)
		expect(registry.views().fake).toBe(second.fake)
	})

	it('configures the tool and remembers the choice', () => {
		const { tool, registry } = fakeRegistry()
		registry.setSettings('fake', { label: 'chosen' })

		expect(tool.settings).toEqual({ label: 'chosen' })
		expect(store.get('thrax-web.settings.tools.fake')).toBe('{"label":"chosen"}')
		expect(registry.views().fake.label).toBe('chosen')
	})

	it('applies what was stored, and falls back for a value the validator refuses', () => {
		store.set('thrax-web.settings.tools.fake', '{"label":"stored"}')
		const stored = fakeRegistry()
		expect(stored.registry.loadSettings()).toEqual({ fake: { label: 'stored' } })
		expect(stored.tool.settings).toEqual({ label: 'stored' })

		store.set('thrax-web.settings.tools.fake', '{"label":7}')
		const refused = fakeRegistry()
		expect(refused.registry.loadSettings()).toEqual({ fake: FAKE_DEFAULTS })
		expect(refused.tool.settings).toEqual(FAKE_DEFAULTS)
	})

	it('gives the pipeline model its delay slots, and a reset leaves them alone', () => {
		const pipeline = new PipelineModel()
		const registry = new ToolRegistry([{ key: 'pipeline', tool: pipeline }] as const)

		registry.setWanted(new Set(['pipeline']))
		registry.attach(fakeSimulator(), { delayedBranching: true })
		expect(pipeline.delaySlots).toBe(true)

		registry.resetAll()
		expect(pipeline.delaySlots).toBe(true)
	})

	it('collects and clears the readings of every registered tool', async () => {
		const registry = createToolRegistry()
		const simulator = build(withExit('li $t0, 2\nloop:\naddi $t0, $t0, -1\nsw $t0, 0($sp)\nlw $t1, 0($sp)\nbne $t0, $zero, loop'))
		registry.setWanted(EVERY_TOOL)
		registry.attach(simulator, { delayedBranching: false })
		await simulator.run()

		const ran = registry.views()
		expect(ran.statistics.total).toBe(simulator.instructionCount)
		expect(ran.profile.total).toBe(simulator.instructionCount)
		expect(ran.cache.accesses).toBe(4)
		expect(ran.branchHistory.predictions).toBe(2)
		expect(ran.pipeline.instructions).toBe(simulator.instructionCount)

		registry.resetAll()
		const cleared = registry.views()
		expect(cleared.statistics.total).toBe(0)
		expect(cleared.profile.total).toBe(0)
		expect(cleared.cache.accesses).toBe(0)
		expect(cleared.branchHistory.predictions).toBe(0)
		expect(cleared.pipeline.instructions).toBe(0)
	})

	it('watches a run through the ported tools too, and clears them with the rest', async () => {
		const registry = createToolRegistry()
		const simulator = build(withExit(`
			.data
		cell:	.word 0
			.text
			la $t0, cell
			li $t1, 7
			sw $t1, 0($t0)
			lw $t2, 0($t0)
		`))
		registry.setWanted(EVERY_TOOL)
		registry.attach(simulator, { delayedBranching: false })
		await simulator.run()

		const ran = registry.views()
		// The store and read both land in the first cell of the default grid.
		expect(ran.memoryReference.counts[0]).toBe(2)
		expect(ran.memoryReference.max).toBe(2)
		// The MMIO tools saw a run that never touched their registers.
		expect(ran.marsBot.segments).toEqual([])
		expect(ran.scavengerHunt.gameOn).toBe(false)

		registry.resetAll()
		const cleared = registry.views()
		expect(cleared.memoryReference.counts[0]).toBe(0)
		expect(cleared.memoryReference.max).toBe(0)
	})

	it('gives the memory reference grid the settings that were stored', () => {
		store.set('thrax-web.settings.tools.memoryReference', JSON.stringify({
			...DEFAULT_MEMORY_REFERENCE_SETTINGS,
			rows: 4,
			columns: 8,
		}))
		const registry = createToolRegistry()
		expect(registry.loadSettings().memoryReference.rows).toBe(4)
		expect(registry.views().memoryReference.counts).toHaveLength(32)

		registry.setSettings('memoryReference', { ...DEFAULT_MEMORY_REFERENCE_SETTINGS, rows: 2, columns: 2 })
		expect(registry.views().memoryReference.counts).toHaveLength(4)
		expect(JSON.parse(store.get('thrax-web.settings.tools.memoryReference')!).rows).toBe(2)
	})

	it('falls back to the defaults for a memory reference grid it cannot read', () => {
		store.set('thrax-web.settings.tools.memoryReference', '{"rows":0,"columns":8}')
		const registry = createToolRegistry()
		expect(registry.loadSettings().memoryReference).toEqual(DEFAULT_MEMORY_REFERENCE_SETTINGS)
	})

	it('leaves a tool nobody asked for off the run', async () => {
		// Watching is not free: the observer call lands on every instruction, and
		// the pipeline model copies its own state on each one.  The whole set
		// attached made a run twenty-five times slower with no panel open.
		const registry = createToolRegistry()
		const simulator = build(withExit(`li $t0, 2
loop:
addi $t0, $t0, -1
bne $t0, $zero, loop`))
		registry.setWanted(new Set(['statistics']))
		registry.attach(simulator, { delayedBranching: false })
		await simulator.run()

		const ran = registry.views()
		expect(ran.statistics.total).toBe(simulator.instructionCount)
		expect(ran.pipeline.instructions).toBe(0)
		expect(ran.profile.total).toBe(0)
	})

	it('starts a tool asked for mid-run from nothing, and stops one dropped', async () => {
		const registry = createToolRegistry()
		const simulator = build(withExit(`li $t0, 2
loop:
addi $t0, $t0, -1
bne $t0, $zero, loop`))
		registry.attach(simulator, { delayedBranching: false })
		await simulator.run()
		expect(registry.views().statistics.total).toBe(0)

		// Opening its panel starts it: it did not see what came before, so it says
		// nothing about it rather than guessing.
		registry.setWanted(new Set(['statistics']))
		expect(registry.views().statistics.total).toBe(0)

		registry.setWanted(new Set())
		const observers = simulator.observers.length
		registry.setWanted(new Set())
		expect(simulator.observers).toHaveLength(observers)
	})
})

describe('a tool that registers itself', () => {
	beforeEach(() => store.clear())

	it('joins a run already in progress and watches it', () => {
		const { registry } = fakeRegistry()
		const simulator = fakeSimulator()
		registry.setWanted(new Set(['fake', 'late']))
		registry.attach(simulator, { delayedBranching: false })
		expect(registry.has('late')).toBe(false)

		const late = new FakeTool()
		registry.register({ key: 'late', tool: late })

		expect(registry.has('late')).toBe(true)
		// It starts from nothing, as any tool joining a run in progress does.
		expect(late.resets).toBe(1)
		expect(late.machines).toEqual([{ delayedBranching: false }])
		for (const observer of simulator.observers) observer.onMemoryRead?.(0, 4)
		expect(late.reads).toBe(1)
		expect((registry.views() as Record<string, { reads: number }>).late.reads).toBe(1)
	})

	it('takes its stored settings with it', () => {
		store.set('thrax-web.settings.tools.late', JSON.stringify({ label: 'remembered' }))
		const { registry } = fakeRegistry()
		const late = new FakeTool()
		registry.register({ key: 'late', tool: late, setting: { storageKey: 'tools.late', defaults: FAKE_DEFAULTS, isValid: isFakeSettings } })
		expect(late.settings.label).toBe('remembered')
	})

	it('stops watching when it is dropped, and its reading goes with it', () => {
		const { registry } = fakeRegistry()
		const simulator = fakeSimulator()
		registry.setWanted(new Set(['late']))
		registry.attach(simulator, { delayedBranching: false })

		const late = new FakeTool()
		const drop = registry.register({ key: 'late', tool: late })
		const watching = simulator.observers.length
		expect(watching).toBeGreaterThan(0)

		expect(drop()).toBe(undefined)
		expect(registry.has('late')).toBe(false)
		expect(simulator.observers.length).toBe(watching - 1)
		expect('late' in registry.views()).toBe(false)
		// Nothing reaches it once it is gone, however long the run goes on.
		for (const observer of simulator.observers) observer.onMemoryRead?.(0, 4)
		expect(late.reads).toBe(0)
	})

	it('replaces whatever held the key before it', () => {
		const { registry } = fakeRegistry()
		const simulator = fakeSimulator()
		registry.setWanted(new Set(['late']))
		registry.attach(simulator, { delayedBranching: false })

		const first = new FakeTool()
		const second = new FakeTool()
		registry.register({ key: 'late', tool: first })
		registry.register({ key: 'late', tool: second })

		for (const observer of simulator.observers) observer.onMemoryRead?.(0, 4)
		expect(first.reads).toBe(0)
		expect(second.reads).toBe(1)
	})

	it('says nothing was dropped when there was nothing to drop', () => {
		const { registry } = fakeRegistry()
		expect(registry.unregister('never-registered')).toBe(false)
	})
})
