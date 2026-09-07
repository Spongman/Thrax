/**
 * The register of tools that watch a run.
 *
 * Each tool observes through the ExecutionObserver seam and knows nothing about
 * the store.  What the store needs of them is the same for every one: attach to
 * a freshly assembled program, restart between runs, remember the settings the
 * user chose, and hand the view a snapshot.  Saying that once here means a new
 * tool is one entry below rather than an edit in every one of those places.
 */

import type { ExecutionObserver, InstructionHistory, MachineConfig } from '../core/observer'
import type { ServiceHost } from '../core/service'
import { readStoredSetting, writeStoredSetting } from '../hooks/useStoredState'
import { BranchHistoryTable, DEFAULT_BHT_SETTINGS } from './branchHistory'
import { CacheSimulator, DEFAULT_CACHE_SETTINGS } from './cache'
import { MarsBot } from './marsBot'
import { DigitalLabSim } from './digitalLab'
import { DEFAULT_MEMORY_REFERENCE_SETTINGS, MemoryReferenceVisualizer, isMemoryReferenceSettings } from './memoryReference'
import { DEFAULT_PIPELINE_SETTINGS, PipelineModel } from './pipeline'
import { ExecutionProfile } from './profile'
import { ScavengerHunt } from './scavengerHunt'
import { InstructionStatistics } from './statistics'

/** An observer that can also be read and, for some, configured. */
export interface Tool<Settings = unknown, Snapshot = unknown> extends ExecutionObserver {
	configure?(settings: Settings): void
	snapshot(): Snapshot
}

/** Settings the user chooses, which outlive the session. */
export interface ToolSetting<Settings = unknown> {
	/** Key under the settings prefix; see readStoredSetting. */
	storageKey: string
	defaults: Settings
	/**
	 * Settings are validated field by field: a stored setting the tool cannot
	 * read would otherwise reach it as a configuration it has no branch for.
	 */
	isValid: (value: unknown) => boolean
}

export interface ToolEntry<Key extends string = string, Settings = unknown, Snapshot = unknown> {
	/** Names the tool, and the field its snapshot lands in. */
	key: Key
	tool: Tool<Settings, Snapshot>
	/** Absent for a tool with nothing to configure. */
	setting?: ToolSetting<Settings>
}

type Entries = readonly ToolEntry[]

/** What a run has to offer for the tools to be attached to it. */
interface ToolSource {
	observers: ExecutionObserver[]
	executionHistory?: InstructionHistory
	register?: ServiceHost['register']
}

/** Every tool's snapshot, keyed by tool. */
export type ToolViews<E extends Entries> = {
	[Entry in E[number] as Entry['key']]: ReturnType<Entry['tool']['snapshot']>
}

/** The settings of the tools that have any, keyed by tool. */
export type ToolSettings<E extends Entries> = {
	[Entry in E[number] as Entry extends { setting: ToolSetting } ? Entry['key'] : never]:
		Entry extends { setting: ToolSetting<infer Settings> } ? Settings : never
}

/** Callbacks a tool is watched through, so a wrapper can forward them all. */
const CALLBACKS: Array<keyof ExecutionObserver> = ['onInstruction', 'onMemoryRead', 'onMemoryWrite', 'onBranch', 'onReset', 'onSeek', 'onConfigure']

type Callback = (...args: never[]) => void

interface ToolState {
	entry: ToolEntry
	/** What the simulator sees: the tool, plus a note that it has read something. */
	observer: ExecutionObserver
	version: number
	/** Version the held snapshot was taken at, or -1 for none yet. */
	viewedVersion: number
	view: unknown
	/** Whether this tool is in the simulator's observer list right now. */
	attached: boolean
}

/**
 * Wraps a tool so that every callback it implements marks its reading as moved
 * on.  Callbacks it does not implement are left off, so the simulator skips it
 * for events it does not care about.
 */
function watch(entry: ToolEntry): ToolState {
	const state: ToolState = { entry, observer: {}, version: 0, viewedVersion: -1, view: undefined, attached: false }
	const tool = entry.tool as unknown as Record<string, Callback | undefined>
	const observer = state.observer as unknown as Record<string, Callback>
	for (const name of CALLBACKS) {
		if (typeof tool[name] !== 'function') continue
		observer[name] = (...args: never[]) => {
			state.version += 1
			// Called through the tool so the method keeps its own `this`.
			tool[name]!(...args)
		}
	}
	// A tool holding state of its own is rolled back by the machine rather than
	// by anything it is told, so its reading moves on a seek whether or not it
	// listens for one.  Without this its panel would go on showing what it read
	// before the step back.
	if (typeof tool.exchange === 'function' && observer.onSeek === undefined) {
		observer.onSeek = () => { state.version += 1 }
	}
	return state
}

export class ToolRegistry<E extends Entries> {
	/** Grows and shrinks: a tool may join a run in progress and leave again. */
	private states: ToolState[]
	/** The run the wanted tools watch, and the machine it is on. */
	private simulator: { observers: ExecutionObserver[] } | null = null
	private machine: MachineConfig | null = null
	/** Tools something is asking for; the rest cost nothing because they do not run. */
	private wanted: ReadonlySet<string> = new Set()

	constructor(entries: E) {
		this.states = entries.map(watch)
	}

	/**
	 * Points the wanted tools at a fresh run of `machine`, from clean readings.
	 * The reset and the machine both go out through the observer interface, which
	 * is the only thing the simulator itself would use.
	 *
	 * A tool nobody is asking for is left off the run entirely.  Watching costs
	 * an observer call per instruction and, for the ones that model a pipeline or
	 * count every address, a great deal more: the whole set attached made a run
	 * twenty-five times slower whether or not a single panel was open.
	 */
	attach(simulator: ToolSource, machine: MachineConfig) {
		this.simulator = simulator
		// A tool that rebuilds itself by replaying the run reads the machine's own
		// log, and one that holds state of its own signs up to roll back with it,
		// so both are handed over here rather than left to each caller to pass.
		this.machine = {
			...machine,
			history: machine.history ?? simulator.executionHistory,
			services: machine.services ?? (simulator.register ? simulator as ServiceHost : undefined),
		}
		this.resetAll()
		for (const state of this.states) {
			state.attached = false
			// `resetAll` has just cleared every tool, so connecting must not do it again.
			if (this.wanted.has(state.entry.key)) this.connect(state, false)
		}
	}

	/**
	 * Says which tools something is consuming: a panel that is open, or a feature
	 * of another panel that reads one.  A tool joining a run in progress starts
	 * from nothing, since it did not see what came before.
	 */
	setWanted(keys: ReadonlySet<string>) {
		this.wanted = new Set(keys)
		for (const state of this.states) {
			const want = this.wanted.has(state.entry.key)
			if (want === state.attached) continue
			if (want) this.connect(state)
			else this.disconnect(state)
		}
	}

	private connect(state: ToolState, reset = true) {
		if (!this.simulator || state.attached) return
		// Its readings begin here, so whatever it holds is from a run it missed.
		if (reset) state.observer.onReset?.()
		if (this.machine) state.observer.onConfigure?.(this.machine)
		this.simulator.observers.push(state.observer)
		state.attached = true
	}

	private disconnect(state: ToolState) {
		state.attached = false
		const observers = this.simulator?.observers
		const at = observers?.indexOf(state.observer) ?? -1
		if (observers && at >= 0) observers.splice(at, 1)
		// Its readings stop here, so they are cleared rather than left standing:
		// a tool that keeps the numbers it had when it stopped watching shows them
		// beside numbers that are still moving, and does not roll back on a seek.
		state.observer.onReset?.()
		state.version += 1
	}

	/** Tells every tool its accumulated readings belong to a previous run. */
	resetAll() {
		for (const state of this.states) state.observer.onReset?.()
	}

	/**
	 * The tool itself, for the few that are driven as well as watched: a device
	 with a keypad has to be told a key was pressed.
	 */
	instance<Key extends E[number]['key']>(key: Key) {
		return this.states.find((candidate) => candidate.entry.key === key)?.entry.tool
	}

	/** Configures one tool and remembers the choice. */
	setSettings<Key extends keyof ToolSettings<E> & string>(key: Key, settings: ToolSettings<E>[Key]) {
		const state = this.states.find((candidate) => candidate.entry.key === key)
		if (!state?.entry.setting) return
		state.entry.tool.configure?.(settings)
		state.version += 1
		writeStoredSetting(state.entry.setting.storageKey, settings)
	}

	/** Applies what was stored for each tool, and reports it. */
	loadSettings(): ToolSettings<E> {
		const settings: Record<string, unknown> = {}
		for (const state of this.states) {
			const setting = state.entry.setting
			if (!setting) continue
			const stored = readStoredSetting(setting.storageKey, setting.defaults, setting.isValid)
			state.entry.tool.configure?.(stored)
			state.version += 1
			settings[state.entry.key] = stored
		}
		return settings as ToolSettings<E>
	}

	/**
	 * Each tool's reading.  A tool that has seen nothing since the last call
	 * hands back the same object, so a view of it does not redraw: snapshots are
	 * whole-run copies, and most of them are taken for a panel nobody opened.
	 */
	views(): ToolViews<E> {
		const views: Record<string, unknown> = {}
		for (const state of this.states) {
			if (state.viewedVersion !== state.version) {
				state.view = state.entry.tool.snapshot()
				state.viewedVersion = state.version
			}
			views[state.entry.key] = state.view
		}
		return views as ToolViews<E>
	}
}

const CACHE_SETTING = 'tools.cache'
const BRANCH_HISTORY_SETTING = 'tools.branchHistory'
const PIPELINE_SETTING = 'tools.pipeline'
const MEMORY_REFERENCE_SETTING = 'tools.memoryReference'

const isBoolean = (value: unknown) => typeof value === 'boolean'
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isCount = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value > 0

const isCacheSettings = (value: unknown) => isRecord(value) &&
	isCount(value.blockCount) && isCount(value.blockSizeBytes) && isCount(value.associativity) &&
	['lru', 'random', 'fifo'].includes(value.replacement as string)

const isBranchHistorySettings = (value: unknown) => isRecord(value) &&
	isCount(value.entryCount) && (value.historyBits === 1 || value.historyBits === 2) && isBoolean(value.initiallyTaken)

const isPipelineSettings = (value: unknown) => isRecord(value) &&
	['forwarding', 'split-decode', 'none'].includes(value.dataHazards as string) &&
	['id', 'ex', 'mem'].includes(value.resolveBranchIn as string) &&
	['id', 'ex'].includes(value.resolveJumpIn as string) &&
	['none', 'taken', 'not-taken', 'one-bit', 'two-bit'].includes(value.prediction as string) &&
	isCount(value.windowSize)

/** The tools a run is watched by.  A new one is an entry in this list. */
export function createToolRegistry() {
	return new ToolRegistry([
		{ key: 'statistics', tool: new InstructionStatistics() },
		{ key: 'profile', tool: new ExecutionProfile() },
		{
			key: 'cache',
			tool: new CacheSimulator(),
			setting: { storageKey: CACHE_SETTING, defaults: DEFAULT_CACHE_SETTINGS, isValid: isCacheSettings },
		},
		{
			key: 'branchHistory',
			tool: new BranchHistoryTable(),
			setting: { storageKey: BRANCH_HISTORY_SETTING, defaults: DEFAULT_BHT_SETTINGS, isValid: isBranchHistorySettings },
		},
		{
			key: 'pipeline',
			tool: new PipelineModel(),
			setting: { storageKey: PIPELINE_SETTING, defaults: DEFAULT_PIPELINE_SETTINGS, isValid: isPipelineSettings },
		},
		{
			key: 'memoryReference',
			tool: new MemoryReferenceVisualizer(),
			// Its grid and colour ramp are nested, so the check lives beside the
			// shape it checks rather than being restated here.
			setting: { storageKey: MEMORY_REFERENCE_SETTING, defaults: DEFAULT_MEMORY_REFERENCE_SETTINGS, isValid: isMemoryReferenceSettings },
		},
		{ key: 'marsBot', tool: new MarsBot() },
		{ key: 'digitalLab', tool: new DigitalLabSim() },
		{ key: 'scavengerHunt', tool: new ScavengerHunt() },
	] as const)
}
