import { create } from 'zustand'
import { HOVER_KINDS, NOTHING_HOVERED, type Hovered } from './hover'
import { ActivationSuperseded, activateArchitecture, activeArchitecture, knownArchitectures, onArchitectureActivated, peekArchitecture } from '../architectures/registry'
import { EMPTY_HISTORY, EMPTY_MEMORY, variantOf, type ArchitectureActivation, type ArchitectureDefinition, type ArchitectureServices, type ArchitectureVariant, type AssembledProgram, type CallFrame, type CodeRow, type DataDeclaration, type Diagnostic, type HistoryFormatter, type KeyboardDisplayState, type Machine, type MachineHistory, type MachineProfile, type MemoryInspector, type PendingInput, type RegisterValue, type Registers, type SourceFile, type SourceLocation, type SymbolTables } from '../architectures/contracts'
import type { ExecutionObserver } from '../core/observer'
import { formatDiagnostic, hasErrors } from '../core/diagnostics'
import { DEFAULT_SETTINGS, isRecord, SETTINGS_VALIDATORS, validSettings, type TargetSettings, type ThraxSettings } from '../core/settings'
import { codeRowOf, EMPTY_SOURCE_INDEX, type SourceIndex } from '../core/sourceIndex'
import { moveToEntry } from '../core/historyLog'
import { DebugSession } from '../debug/session'
import { isFlagSet, readStoredSetting, writeStoredSetting } from '../hooks/useStoredState'
import { downloadHexText } from '../services/hexTextExport'
import { DEFAULT_ARCHITECTURE, fromWorkspaceDocument, newFileExtension, toWorkspaceDocument, type WorkspaceFile, type WorkspaceSnapshot } from '../services/workspace'
import type { BranchHistorySettings, BranchHistorySnapshot } from '../tools/branchHistory'
import { effectiveCacheSettings, type CacheSettings, type CacheSnapshot } from '../tools/cache'
import type { MemoryReferenceSettings, MemoryReferenceSnapshot } from '../tools/memoryReference'
import type { PipelineSettings, PipelineSnapshot } from '../tools/pipeline'
import type { ProfileSnapshot } from '../tools/profile'
import { createToolRegistry } from '../tools/registry'
import type { StatisticsSnapshot } from '../tools/statistics'

/**
 * Instructions per second the run-speed control offers.  null runs flat out;
 * the slow end is where an animated run is worth watching.
 */
export const RUN_SPEEDS: Array<number | null> = [1, 2, 5, 10, 30, 100, 300, 1000, 5000, 30000, null]

const SAVED_PROGRAM_KEY = 'thrax-web.saved-program'
/**
 * Where the open files go as they are typed, so a reload or a closed tab loses
 * nothing.  Separate from the slot Save writes: that one is what was asked for,
 * this one is what was there.
 */
const AUTOSAVE_KEY = 'thrax-web.autosave'
const AUTOSAVE_DELAY_MS = 400
const INITIAL_CODE = '# Simple addition example\n# $t0 = 5, $t1 = 3, $t2 = $t0 + $t1\naddi $t0, $zero, 5\naddi $t1, $zero, 3\nadd $t2, $t0, $t1\n\n# Print result (syscall 1)\nmove $a0, $t2\naddi $v0, $zero, 1\nsyscall\n\n# Exit (syscall 10)\naddi $v0, $zero, 10\nsyscall\n'
/** The shape the browser slot held before it was a workspace document. */
interface SavedProgram {
	version: number
	code: string
	documents?: Array<{ title: string, code: string, id?: string }>
	activeDocumentId?: string
	assembleAllFiles?: boolean
}

/** Machine-word columns the source editor draws between the gutter and the code. */
export interface GutterColumns {
	address: boolean
	code: boolean
	disassembly: boolean
}

/** Code shows the instruction word; data shows its bytes in address order. */
export const DEFAULT_GUTTER_COLUMNS: GutterColumns = { address: false, code: false, disassembly: false }

const GUTTER_SETTING = 'source.gutter'
const HEAT_MAP_SETTING = 'source.heatmap'
const RUN_SPEED_SETTING = 'run.speed'
const HEAT_MAP_LINES_SETTING = 'source.heatmap.lines'

/** Where each shared setting persists. */
const SETTING_KEYS: { [Key in keyof ThraxSettings]: string } = {
	// Kept from when it was a toolbar toggle, so an existing choice survives.
	assembleAll: 'assemble.allFiles',
	backstepLimit: 'simulate.backstepLimit',
	displayValuesInHex: 'display.valuesInHex',
	displayAddressesInHex: 'display.addressesInHex',
	hexDimming: 'display.hexDimming',
	highlightNavigation: 'display.highlightNavigation',
	highlightChanges: 'display.highlightChanges',
	highlightSeconds: 'display.highlightSeconds',
	highlightNavigationColor: 'display.highlightNavigationColor',
	highlightChangeColor: 'display.highlightChangeColor',
}

/**
 * Shared settings the assembler reads, so changing one invalidates the program
 * the way editing the source does.  An architecture marks its own with `rebuild`.
 */
const ASSEMBLY_SETTINGS: ReadonlySet<keyof ThraxSettings> = new Set<keyof ThraxSettings>(['assembleAll'])

const settingKeys = Object.keys(DEFAULT_SETTINGS) as Array<keyof ThraxSettings>

/** Every setting as it was left, falling back to its default. */
function readSettings(): ThraxSettings {
	const stored = settingKeys.map((key) => [key, readStoredSetting(SETTING_KEYS[key], DEFAULT_SETTINGS[key], SETTINGS_VALIDATORS[key])])
	return Object.fromEntries(stored) as ThraxSettings
}

/** Each architecture's own settings persist as one object, apart from every other's. */
const targetSettingsKey = (id: string) => `architecture.${id}`

/**
 * An architecture's settings as they were left.  The first read since settings
 * were per architecture carries over what the shared keys held, and keeps it
 * under the architecture's own key from then on.
 */
function readTargetSettings(definition: ArchitectureDefinition): TargetSettings {
	const { id, settings: schema } = definition
	const stored = readStoredSetting<unknown>(targetSettingsKey(id), null, isRecord)
	if (stored !== null) return validSettings(schema, stored)
	const legacy: TargetSettings = {}
	for (const { key, legacyKey, isValid } of schema.fields) {
		if (legacyKey !== undefined) legacy[key] = readStoredSetting<unknown>(legacyKey, undefined, isValid)
	}
	const values = validSettings(schema, legacy)
	if (Object.values(legacy).some((value) => value !== undefined)) writeStoredSetting(targetSettingsKey(id), values)
	return values
}

/**
 * A document id is unique for the life of the session.  A timestamp alone is
 * not: two files created in the same millisecond shared one, so renaming either
 * renamed both and dockview collapsed them into a single panel.
 */
let documentSequence = 0
const newDocumentId = () => `source-${Date.now()}-${documentSequence++}`

export interface SourceDocument {
	id: string
	title: string
	code: string
	dirty: boolean
	/**
	 * In the project but off the tab bar.  Closing a tab puts a file here rather
	 * than out of the program, so it still assembles and `.include` still finds
	 * it; the file list is where it is brought back or removed for good.
	 */
	hidden?: true
}

/** What the tab bar shows: the files not put away. */
export const shownDocuments = (documents: readonly SourceDocument[]) => documents.filter((document) => !document.hidden)

/**
 * The tab that comes forward when the one at `index` (in `before`) goes: the
 * shown file nearest to its left, else the first still showing, else none.
 */
function neighbourOf(documents: readonly SourceDocument[], before: readonly SourceDocument[], index: number): SourceDocument | undefined {
	const shown = shownDocuments(documents)
	return [...shown].reverse().find((document) => before.indexOf(document) < index) ?? shown[0]
}

/**
 * `title`, or the first `name-2.asm`, `name-3.asm` ... no other open file has.
 * Assembly identifies a file by its title, so two files sharing one would leave
 * the assembler seeing only whichever came first.
 */
function uniqueTitle(title: string, documents: readonly SourceDocument[], exceptId?: string): string {
	const taken = new Set(documents.filter((document) => document.id !== exceptId).map((document) => document.title))
	if (!taken.has(title)) return title
	const dot = title.lastIndexOf('.')
	const stem = dot > 0 ? title.slice(0, dot) : title
	const extension = dot > 0 ? title.slice(dot) : ''
	for (let suffix = 2; ; suffix++) {
		const candidate = `${stem}-${suffix}${extension}`
		if (!taken.has(candidate)) return candidate
	}
}

/**
 * Everything about the open files the assembler reads.  The workspace watches
 * this rather than the active file alone, so editing an included file - or
 * renaming one - rebuilds the program too.
 */
export function sourceSignature(documents: readonly SourceDocument[]): string {
	return documents.map((document) => `${document.title}\u0000${document.code}`).join('\u0001')
}

/** A workspace document, or the older saved-program shape, from storage. */
function readStoredWorkspace(key: string): WorkspaceSnapshot | null {
	try {
		const raw = window.localStorage.getItem(key)
		if (!raw) return null
		const parsed: unknown = JSON.parse(raw)
		const workspace = fromWorkspaceDocument(parsed)
		if (workspace) return workspace
		return fromSavedProgram(parsed)
	} catch {
		return null
	}
}

function fromSavedProgram(value: unknown): WorkspaceSnapshot | null {
	if (typeof value !== 'object' || value === null) return null
	const program = value as Partial<SavedProgram>
	if (typeof program.version !== 'number' || typeof program.code !== 'string') return null
	const documents = Array.isArray(program.documents) && program.documents.length > 0 &&
		program.documents.every((document) => typeof document?.title === 'string' && typeof document.code === 'string')
		? program.documents
		: [{ title: 'main.asm', code: program.code }]
	const active = documents.find((document) => document.id === program.activeDocumentId)?.title
	return { files: documents.map(({ title, code }) => ({ title, code })), active, assembleAll: program.assembleAllFiles === true, architecture: DEFAULT_ARCHITECTURE }
}

const isKnownArchitecture = (id: string) => knownArchitectures().includes(id)

function unknownArchitectureDiagnostic(id: string): Diagnostic {
	return {
		severity: 'error',
		message: `Saved workspace targets unknown architecture '${id}' (known: ${knownArchitectures().join(', ')}); it was not opened and is left unchanged in storage`,
	}
}

function writeStoredWorkspace(key: string, snapshot: WorkspaceSnapshot): boolean {
	try {
		// A workspace this build cannot open is never overwritten.
		const existing = readStoredWorkspace(key)
		if (existing && !isKnownArchitecture(existing.architecture)) return false
		window.localStorage.setItem(key, JSON.stringify(toWorkspaceDocument(snapshot)))
		return true
	} catch {
		return false
	}
}

/**
 * Open files from what a workspace carries.  Titles are kept apart the way
 * they are everywhere else, since a workspace saved before that can collide.
 */
function documentsFrom(files: readonly WorkspaceFile[]): SourceDocument[] {
	return files.reduce<SourceDocument[]>((all, file) =>
		[...all, { id: newDocumentId(), title: uniqueTitle(file.title, all), code: file.code, dirty: false }], [])
}

const NO_KEYBOARD_DISPLAY: KeyboardDisplayState = Object.freeze({ queuedInput: '', displayOutput: '' })

export interface OpenFilesOptions {
	/** The files become the whole project rather than joining it. */
	replace?: boolean
	/** Title of the file to bring to the front; the first opened when absent. */
	active?: string
	assembleAll?: boolean
	/** The architecture the files target; switching to it when it is not the one active. */
	architecture?: string
}

interface THRAXStore {
	code: string
	documents: SourceDocument[]
	activeDocumentId: string
	/**
	 * The file the program is assembled from.  It follows the tab bar only until
	 * the program starts, so switching tabs mid-run leaves it running.
	 */
	entryDocumentId: string
	/** The shared IDE settings, as the settings dialog edits them. */
	settings: ThraxSettings
	/** The active architecture's own settings, as its definition declares them. */
	targetSettings: TargetSettings
	/** Id of the architecture the workspace targets, persisted with it. */
	architecture: string
	/** The active architecture's definition and services; null until one has loaded. */
	target: ArchitectureActivation | null
	/** Its layout under the current settings. */
	targetProfile: MachineProfile | null
	/** Its language, registers and examples under the current settings. */
	targetVariant: ArchitectureVariant | null
	/** Every register by descriptor id, across all of the target's banks. */
	registers: Registers
	memory: MemoryInspector
	console: string
	pc: number
	halted: boolean
	instructionCount: number
	/** Which line of which file every machine word of the program came from. */
	sourceIndex: SourceIndex
	/** Everything wrong with the source, as the editor marks it up. */
	diagnostics: Diagnostic[]
	/** Machine words of each assembled file, keyed by source line, in address order. */
	codeWords: Map<string, Map<number, CodeRow[]>>
	labels: ReadonlyMap<string, number>
	callStack: readonly CallFrame[]
	pendingInput: PendingInput | null
	/** The memory-mapped keyboard and display; null when the machine has none. */
	keyboardDisplay: KeyboardDisplayState | null
	isRunning: boolean
	isPaused: boolean
	breakpoints: Set<number>
	/**
	 * Whether a program is loaded, from the debugger's own view of itself.  A
	 * panel offering to edit the machine asks this: with no machine an edit has
	 * nowhere to land, and a cell that accepts the value only to refuse it reads
	 * as the value being wrong rather than as there being no program.
	 */
	hasMachine: boolean
	/** Lines holding a breakpoint, keyed by the file they were set in. */
	breakpointLines: Map<string, Set<number>>
	/** Breakpoints on addresses with no source line, such as the tail of a pseudo-instruction. */
	breakpointAddresses: Set<number>
	/** Counts runs, so the console is brought forward only once per run. */
	runToken: number
	/** How the console tab asks to be noticed while it is hidden. */
	consoleAttention: 'none' | 'output' | 'input'
	/**
	 * Dock panels currently on screen, so the menu can tick what is already open
	 * rather than offer it again.  The dock owns the arrangement; this is the
	 * part of it the menu needs to read.
	 */
	openPanels: readonly string[]
	/** Machine-word columns the source gutter is showing. */
	gutterColumns: GutterColumns
	/** Whether the editor colours line numbers by how often they ran. */
	heatMap: boolean
	/** Whether the heat map tints the source line behind the code as well. */
	heatMapLines: boolean
	/** Whether the source editor is showing its find and replace bar. */
	/**
	 * What is under the pointer, by kind: an address, a register named rather
	 * than indexed (the history knows a register by its name, and $t0, $f0 and
	 * the CP0 registers share one namespace here), a symbol.  Whichever panel
	 * the pointer is over says what it is over and every other answers; see
	 * `store/hover`.
	 */
	hovered: Hovered
	/** Index into callStack of the selected frame, -1 for the running frame, null for none. */
	selectedFrame: number | null
	/** The file whose close is waiting on an answer, or null when none is. */
	pendingClose: string | null
	executionHistory: MachineHistory
	/** How many entries stand behind the present; the rest are ahead of it. */
	historyCursor: number
	/** How the machine's entries read; null with no machine. */
	historyFormat: HistoryFormatter | null
	/**
	 * Bumped whenever the log changes.  The log is published by reference and is
	 * written in place, so a selector comparing it would never see a change.
	 */
	historyVersion: number
	/** Symbols of the assembled program, by the file that owns them. */
	symbols: SymbolTables
	/** Where each of those names is written, so a name can open its own line. */
	symbolSites: ReadonlyMap<string, ReadonlyMap<string, SourceLocation>>
	/**
	 * The runs of bytes the data directives laid out, which is what a symbol was
	 * declared as: the symbol table reads a name's type and value from these.
	 */
	programData: readonly DataDeclaration[]
	/**
	 * An address another panel asked the memory view to show.  It carries a
	 * sequence number because asking for the same address twice has to move the
	 * view both times.
	 */
	focusedMemory: { address: number, request: number } | null
	/**
	 * Where a click in another panel is sending the eye.  Each carries a request
	 * counter, so asking for the same place twice is still two navigations and
	 * lights the destination again.
	 */
	focusedSource: { file: string, line: number, request: number } | null
	focusedRegister: { name: string, request: number } | null
	hasSavedProgram: boolean
	/** Instructions per second while running, or null for no pacing. */
	runSpeed: number | null
	statistics: StatisticsSnapshot
	/** Execution count per instruction address, shown as a heat map in the editor. */
	profile: ProfileSnapshot
	cache: CacheSnapshot
	cacheSettings: CacheSettings
	branchHistory: BranchHistorySnapshot
	branchHistorySettings: BranchHistorySettings
	pipeline: PipelineSnapshot
	pipelineSettings: PipelineSettings
	/** Access count per grid cell, shown as a heat map of addresses. */
	memoryReference: MemoryReferenceSnapshot
	memoryReferenceSettings: MemoryReferenceSettings
	/** Runs an action on an architecture-contributed tool, then refreshes the views. */
	driveTool: (key: string, action: (tool: ExecutionObserver) => void) => void
	setCode: (code: string) => void
	/** Edits one open file, which need not be the one being assembled. */
	setDocumentCode: (documentId: string, code: string) => void
	/** Changes one setting; the ones the assembler reads rebuild the program. */
	setSetting: <Key extends keyof ThraxSettings>(key: Key, value: ThraxSettings[Key]) => void
	/** Changes one of the active architecture's settings; a value its field refuses is ignored. */
	setTargetSetting: (key: string, value: unknown) => void
	/** Writes the workspace to this browser's slot; `loadProgram` reads it back. */
	saveProgram: () => boolean
	loadProgram: () => boolean
	exportHexText: () => boolean
	/** The project as a document: every file, the one in front, the multi-file setting. */
	workspaceSnapshot: () => WorkspaceSnapshot
	/**
	 * Adds files to the project, or with `replace` makes them the project.  A
	 * file named like one already open takes that file's place, so opening a
	 * file again reloads it rather than making a copy.
	 */
	openFiles: (files: readonly WorkspaceFile[], options?: OpenFilesOptions) => void
	/** Records that these files are on disk as they stand. */
	markDocumentsSaved: (documentIds: readonly string[]) => void
	createDocument: () => void
	/** Brings a file to the front, back onto the tab bar if it was put away. */
	selectDocument: (documentId: string) => void
	renameDocument: (documentId: string, title: string) => void
	/** Takes a file out of the project. */
	closeDocument: (documentId: string) => void
	/** Takes a file off the tab bar; it stays in the project. */
	hideDocument: (documentId: string) => void
	/** What closing a tab does: the file is put away, never lost. */
	requestCloseDocument: (documentId: string) => void
	/** Removes a file from the project, asking first when it has edits that were never saved. */
	requestDeleteDocument: (documentId: string) => void
	confirmCloseDocument: () => void
	cancelCloseDocument: () => void
	assemble: () => void
	submitInput: (input: string, cancelled?: boolean) => Promise<void>
	setRunSpeed: (speed: number | null) => void
	setCacheSettings: (settings: CacheSettings) => void
	setBranchHistorySettings: (settings: BranchHistorySettings) => void
	setPipelineSettings: (settings: PipelineSettings) => void
	setMemoryReferenceSettings: (settings: MemoryReferenceSettings) => void
	sendKeyboardInput: (input: string) => void
	run: () => Promise<void>
	step: () => void
	/** Puts the machine at one history entry, however far away it is. */
	moveHistoryTo: (id: number) => void
	stepBack: () => void
	/** Asks the memory view to show an address, from a symbol or a history row. */
	focusMemoryAddress: (address: number) => void
	focusSourceLine: (file: string, line: number) => void
	focusRegister: (name: string) => void
	/** Steps back until the history entry with this id has been undone. */
	rewindTo: (id: number) => void
	/**
	 * Sets a register (by descriptor id) or a byte of memory by hand.  Each
	 * is a history entry of its own, so it shows in the panel and steps back
	 * like anything else.
	 */
	setRegisterValue: (id: string, value: RegisterValue) => boolean
	setMemoryByte: (address: number, value: number) => boolean
	/**
	 * Makes room for a byte, or takes one away, moving the rest of the region
	 * `[address, limit]` with it.  `limit` is the end of the memory section on
	 * show, which is what a byte pushed off the end falls off.
	 */
	insertMemoryByte: (address: number, limit: number, value: number) => boolean
	deleteMemoryByte: (address: number, limit: number) => boolean
	stepOver: () => Promise<void>
	stepToReturn: () => Promise<void>
	/** Runs until the given address is reached, without keeping a breakpoint there. */
	runToAddress: (address: number) => Promise<void>
	/** Moves execution to the given address without running anything. */
	setProgramCounter: (address: number) => void
	pause: () => void
	/** Ends the run where it stands, keeping what it left for inspection. */
	stop: () => void
	continue: () => Promise<void>
	toggleBreakpointLine: (file: string, line: number) => void
	toggleBreakpointAddress: (address: number) => void
	/** Toggles the breakpoint a text segment row's checkbox stands for. */
	toggleBreakpointAt: (file: string, line: number, address: number) => void
	/** Writes a machine code word typed into the text segment table. */
	setBreakpointLines: (file: string, lines: Iterable<number>) => void
	/** Says what is under the pointer; kinds left out keep what they had. */
	hover: (values: Partial<Hovered>) => void
	setSelectedFrame: (frame: number | null) => void
	setGutterColumns: (columns: GutterColumns) => void
	setHeatMap: (shown: boolean) => void
	setHeatMapLines: (shown: boolean) => void
	setConsoleAttention: (attention: 'none' | 'output' | 'input') => void
	setOpenPanels: (ids: readonly string[]) => void
	/** Assembles without reporting failures, to keep the memory view current while editing. */
	refreshAssembly: () => void
	/**
	 * Targets another architecture: the open files and line breakpoints stay,
	 * the machine and everything it ran go.  False when the load failed or a
	 * later switch superseded it.
	 */
	switchArchitecture: (id: string) => Promise<boolean>
	reset: () => void
}

export const useTHRAXStore = create<THRAXStore>((set, get) => {
	// A setting saved before a column existed still names the ones it knew about.
	const savedGutterColumns: GutterColumns = { ...DEFAULT_GUTTER_COLUMNS, ...readStoredSetting(GUTTER_SETTING, DEFAULT_GUTTER_COLUMNS, isFlagSet(['code', 'disassembly'])) }

	/** Stepping policy, breakpoints, and the runtime they drive. */
	const debug = new DebugSession(() => ensureSimulator())
	debug.setWordRows(savedGutterColumns.disassembly)

	/**
	 * Every open tab is visible to `.include`; which of them are assembled into
	 * the program depends on the multi-file setting.  The entry document comes
	 * first, so it is the entry file and the layout starts there.
	 */
	const assemblySources = (): { files: SourceFile[], entries: string[] } => {
		const { activeDocumentId, code, documents, entryDocumentId, settings } = get()
		// The tab being typed into holds its live text in `code`.
		const textOf = (document: SourceDocument) => document.id === activeDocumentId ? code : document.code
		// A closed entry file falls back to the tab in front of the user.
		const entry = documents.find((document) => document.id === entryDocumentId)
			?? documents.find((document) => document.id === activeDocumentId)
		const ordered = entry ? [entry, ...documents.filter((document) => document.id !== entry.id)] : documents
		// Titles are unique by construction: every site that sets one goes through
		// `uniqueTitle`, so there is nothing here to deduplicate.
		const files = ordered.map((document) => ({ name: document.title, code: textOf(document) }))
		if (files.length === 0) files.push({ name: 'main.asm', code })
		return { files, entries: settings.assembleAll ? files.map((file) => file.name) : [files[0].name] }
	}

	const tools = createToolRegistry()

	/**
	 * The tools something is consuming, and so the only ones worth running.
	 *
	 * A tool panel consumes the tool of the same name.  The profile has no panel
	 * of its own: the editor's heat map is what reads it, so the toggle for that
	 * is what asks for it.
	 */
	const wantedTools = (): Set<string> => {
		const { heatMap, heatMapLines, openPanels } = get()
		const wanted = new Set<string>(openPanels)
		if (heatMap || heatMapLines) wanted.add('profile')
		return wanted
	}

	/** Re-reads what is being consumed, after anything that changes it. */
	const syncTools = () => {
		tools.setWanted(wantedTools())
		set(tools.views())
	}
	// Tool settings outlive the session, so the tools start configured as they
	// were left rather than at their defaults.
	const toolSettings = tools.loadSettings()

	/** Keys of the tools the active architecture contributed. */
	let contributed: string[] = []
	/** Swaps the previous architecture's tools for those of `services`. */
	const contributeTools = (services: ArchitectureServices | undefined) => {
		const gone = Object.fromEntries(contributed.map((key) => [key, undefined]))
		for (const key of contributed) tools.unregister(key)
		const entries = services?.createTools?.() ?? []
		for (const entry of entries) tools.register(entry)
		contributed = entries.map((entry) => entry.key)
		return { ...gone, ...tools.views() }
	}
	contributeTools(peekArchitecture()?.services)

	/** The architecture in force; assembly is only offered once one has loaded. */
	const services = () => activeArchitecture().services

	/** The program the open files assemble to, or the diagnostics that stopped it. */
	const assembleProgram = (): AssembledProgram => services().assemble(assemblySources(), get().targetSettings)

	const createSimulator = (): { simulator: Machine | null, diagnostics: Diagnostic[] } => {
		const settings = get().settings
		const program = assembleProgram()
		const { diagnostics } = program
		// A program that did not assemble is not worth loading; its diagnostics stand
		// for it, and the stale program it would have replaced is let go.
		if (hasErrors(diagnostics)) {
			debug.detach()
			return { simulator: null, diagnostics }
		}
		const nextSimulator = services().createMachine(program, get().targetSettings, {
			speed: get().runSpeed,
			// How far back the workspace is willing to let the program be rewound.
			historyLimit: settings.backstepLimit,
		})
		// A paced run is worth watching, so refresh the workspace between batches.
		nextSimulator.onProgress = () => set({ ...simulatorView(), ...tools.views(), isRunning: true, isPaused: false })
		// Attach first: connecting before the run exists would push the observers
		// onto the machine being replaced, and configure them with its device port.
		tools.attach(nextSimulator, nextSimulator.toolConfig())
		tools.setWanted(wantedTools())
		// Breakpoints and the addresses worth stopping at outlive re-assembly.
		debug.rebind(nextSimulator, program.sourceIndex, program.breakpoints)
		return { simulator: nextSimulator, diagnostics }
	}

	/**
	 * Diagnostics reach the editor as markers; the console keeps the one line per
	 * error it printed before there were any.
	 */
	const report = (diagnostics: Diagnostic[]) => {
		const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
		return errors.length === 0
			? { diagnostics }
			: { diagnostics, console: errors.map(formatDiagnostic).join('\n') }
	}

	/** An exception no pass turned into a diagnostic is reported as one. */
	const reportException = (error: unknown) => report([{ severity: 'error', message: error instanceof Error ? error.message : String(error) }])

	/**
	 * The assembled bytes of every file, under the line that wrote them.  Each
	 * editor reads its own file's words, so an included file gets the same gutter
	 * the entry file does.
	 */
	const codeWordsByFile = (index: SourceIndex, memory: MemoryInspector) =>
		new Map([...index.files()].map((file) =>
			[file, new Map([...index.lines(file)].map(([line, rows]) => [line, rows.map((row) => codeRowOf(row, memory))]))]))

	const simulatorView = () => {
		const machine = debug.machine
		if (!machine) return {}
		const { program } = machine
		const memory = machine.inspectMemory()
		return {
			registers: machine.registerValues(),
			memory,
			console: machine.console,
			pc: machine.pc,
			halted: machine.halted,
			instructionCount: machine.instructionCount,
			isRunning: false,
			isPaused: machine.paused,
			executionHistory: machine.history,
			historyCursor: machine.historyCursor,
			historyFormat: machine.historyFormat,
			historyVersion: get().historyVersion + 1,
			symbols: program.symbols,
			symbolSites: program.symbolSites,
			programData: program.data,
			breakpoints: new Set(machine.getBreakpoints()),
			sourceIndex: program.sourceIndex,
			codeWords: codeWordsByFile(program.sourceIndex, memory),
			labels: new Map(program.labels),
			callStack: machine.callStack,
			selectedFrame: null,
			pendingInput: machine.pendingInput,
			keyboardDisplay: machine.keyboardDisplay?.state() ?? null,
			...tools.views(),
		}
	}

	/**
	 * An explicit build - Assemble, Run, or a control pressed before there was a
	 * program - takes the tab in front of the user as its entry file.  Nothing
	 * else moves it, so a background reassembly cannot change what is running.
	 */
	const pinEntryToActiveDocument = () => {
		const { activeDocumentId, entryDocumentId } = get()
		if (activeDocumentId !== entryDocumentId) set({ entryDocumentId: activeDocumentId })
	}

	/** Builds the program a debug control was pressed before there was one. */
	function ensureSimulator(): Machine | null {
		pinEntryToActiveDocument()
		const created = createSimulator()
		set({ ...debug.view(), ...report(created.diagnostics) })
		return created.simulator
	}

	/**
	 * Runs one debug control and publishes what it did.  A control with no
	 * program to drive says so rather than throwing, and a fault in the program
	 * is reported as a diagnostic.
	 */
	const controlled = (action: () => boolean, after: Partial<THRAXStore> = {}) => {
		try {
			// Nothing to drive still clears the run flag the caller may have raised.
			set(action() ? { ...simulatorView(), ...after } : { isRunning: false })
		} catch (error) {
			set({ ...reportException(error), isRunning: false })
		}
	}

	let executionGeneration = 0
	const controlledAsync = async (action: () => Promise<boolean>, after: () => Partial<THRAXStore> = () => ({})) => {
		const target = peekArchitecture()
		const generation = executionGeneration
		try {
			const acted = await action()
			// A target switched in meanwhile has already published its own view.
			if (peekArchitecture() !== target || generation !== executionGeneration) return
			set(acted ? { ...simulatorView(), ...after() } : { isRunning: false })
		} catch (error) {
			if (peekArchitecture() !== target || generation !== executionGeneration) return
			set({ ...reportException(error), isRunning: false })
		}
	}

	const paused = { isPaused: true }

	/** A control that runs on its own until something stops it, lit as running meanwhile. */
	const freeRunning = (action: () => Promise<boolean>, after?: () => Partial<THRAXStore>) => {
		set({ isRunning: true, isPaused: false })
		return controlledAsync(action, after)
	}

	/**
	 * A change the user made rather than one the program made.  Only while the
	 * machine is stopped: editing under a running program would race it.
	 */
	const edited = (change: (machine: Machine) => boolean): boolean => {
		const machine = debug.machine
		if (!machine || get().isRunning) return false
		if (!change(machine)) return false
		set({ ...simulatorView(), ...paused })
		return true
	}

	/** The active target's layout under `settings`, or null before one has loaded. */
	const profileFor = (settings: TargetSettings) => peekArchitecture()?.services.profile(settings) ?? null

	/** Each architecture's settings once read, so switching back finds them as left. */
	const targetSettingsCache = new Map<string, TargetSettings>()
	const targetSettingsOf = (definition: ArchitectureDefinition) => {
		let values = targetSettingsCache.get(definition.id)
		if (!values) {
			values = readTargetSettings(definition)
			targetSettingsCache.set(definition.id, values)
		}
		return values
	}

	// Takes the settings rather than reading them, so a reset caused by changing
	// the memory configuration lays out from the new one and not the old.
	const resetExecution = (settings: TargetSettings = get().targetSettings) => {
		const profile = profileFor(settings)
		const definition = peekArchitecture()?.definition
		return {
			targetProfile: profile,
			targetVariant: definition ? variantOf(definition, settings) : null,
			registers: profile?.resetRegisters ?? {},
			memory: EMPTY_MEMORY,
			console: '',
			pc: profile?.resetPc ?? 0,
			halted: false,
			instructionCount: 0,
			sourceIndex: EMPTY_SOURCE_INDEX,
			codeWords: new Map<string, Map<number, CodeRow[]>>(),
			labels: new Map<string, number>(),
			callStack: [],
			selectedFrame: null,
			pendingInput: null,
			keyboardDisplay: NO_KEYBOARD_DISPLAY,
			isRunning: false,
			isPaused: false,
			breakpoints: new Set<number>(),
			executionHistory: EMPTY_HISTORY,
			historyCursor: 0,
			historyFormat: null,
			historyVersion: (get()?.historyVersion ?? 0) + 1,
			symbols: { locals: new Map(), globals: new Map() },
			symbolSites: new Map(),
			programData: [],
		}
	}

	/** A model or memory-layout change invalidates the machine, including a run in flight. */
	const detachForRebuild = () => {
		executionGeneration++
		const machine = debug.machine
		if (machine) {
			machine.onProgress = null
			machine.stop()
			machine.dispose()
		}
		tools.detach()
		debug.detach()
	}

	// A committed activation is the only place a target takes effect.  Nothing
	// the old one assembled, ran or recorded can be read as the new CPU, so the
	// machine and address breakpoints go; the files and line breakpoints stay.
	onArchitectureActivated((activation) => {
		debug.detach()
		debug.forgetAddresses()
		tools.detach()
		const targetSettings = targetSettingsOf(activation.definition)
		// The old target's diagnostics describe a build that is gone; the first
		// activation keeps what startup reported.
		const diagnostics = get().target ? { diagnostics: [] } : {}
		set({ target: activation, architecture: activation.definition.id, targetSettings, ...resetExecution(targetSettings), ...debug.view(), ...contributeTools(activation.services), ...diagnostics })
	})

	// `get()` has nothing to return while the initial state is being built.
	const initialSettings = readSettings()
	const initialTarget = peekArchitecture() ?? null
	const initialTargetSettings = initialTarget ? targetSettingsOf(initialTarget.definition) : {}

	// What was open when the page was last here, or the first example when it never was.
	const stored = readStoredWorkspace(AUTOSAVE_KEY)
	const unopenable = stored && !isKnownArchitecture(stored.architecture) ? stored : null
	const autosaved = unopenable ? null : stored
	const initialDocuments = autosaved ? documentsFrom(autosaved.files) : [{ id: 'main', title: 'main.asm', code: INITIAL_CODE, dirty: false }]
	const initialActive = initialDocuments.find((document) => document.title === autosaved?.active) ?? initialDocuments[0]
	if (autosaved) initialSettings.assembleAll = autosaved.assembleAll

	return {
		code: initialActive.code,
		documents: initialDocuments,
		activeDocumentId: initialActive.id,
		entryDocumentId: initialActive.id,
		settings: initialSettings,
		architecture: autosaved?.architecture ?? DEFAULT_ARCHITECTURE,
		targetSettings: initialTargetSettings,
		target: initialTarget,
		...resetExecution(initialTargetSettings),
		focusedMemory: null,
		focusedSource: null,
		focusedRegister: null,
		breakpointLines: new Map<string, Set<number>>(),
		breakpointAddresses: new Set<number>(),
		// Nothing is assembled until something asks for it, so the panels start out
		// with values to look at and nothing to edit.
		hasMachine: false,
		...report(unopenable ? [unknownArchitectureDiagnostic(unopenable.architecture)] : []),
		hovered: NOTHING_HOVERED,
		selectedFrame: null,
		pendingClose: null,
		gutterColumns: savedGutterColumns,
		heatMap: readStoredSetting(HEAT_MAP_SETTING, false, (value) => typeof value === 'boolean'),
		heatMapLines: readStoredSetting(HEAT_MAP_LINES_SETTING, false, (value) => typeof value === 'boolean'),
		runToken: 0,
		consoleAttention: 'none',
		openPanels: [],
		hasSavedProgram: readStoredWorkspace(SAVED_PROGRAM_KEY) !== null,
		runSpeed: readStoredSetting<number | null>(RUN_SPEED_SETTING, null, (value) => RUN_SPEEDS.includes(value as number | null)),
		...tools.views(),
		cacheSettings: effectiveCacheSettings(toolSettings.cache),
		branchHistorySettings: toolSettings.branchHistory,
		pipelineSettings: toolSettings.pipeline,
		memoryReferenceSettings: toolSettings.memoryReference,

		// An edit leaves the machine alone; refreshAssembly decides what it changes.
		setCode: (newCode) => {
			set((state) => ({
				code: newCode,
				documents: state.documents.map((document) => document.id === state.activeDocumentId
					? { ...document, code: newCode, dirty: true }
					: document),
			}))
		},

		setDocumentCode: (documentId, newCode) => {
			const state = get()
			if (documentId === state.activeDocumentId) {
				state.setCode(newCode)
				return
			}
			set({
				documents: state.documents.map((document) => document.id === documentId
					? { ...document, code: newCode, dirty: true }
					: document),
			})
		},

		setSetting: (key, value) => {
			writeStoredSetting(SETTING_KEYS[key], value)
			const settings = { ...get().settings, [key]: value }
			// A setting the assembler reads has to be built in, so the program is
			// dropped rather than merely restarted.
			if (!ASSEMBLY_SETTINGS.has(key)) {
				set({ settings })
				return
			}
			detachForRebuild()
			set({ settings, ...resetExecution(), ...debug.view(), ...tools.views() })
		},

		setTargetSetting: (key, value) => {
			const { target } = get()
			const field = target?.definition.settings.fields.find((one) => one.key === key)
			if (!target || !field?.isValid(value)) return
			const targetSettings = { ...get().targetSettings, [key]: value }
			targetSettingsCache.set(target.definition.id, targetSettings)
			writeStoredSetting(targetSettingsKey(target.definition.id), targetSettings)
			if (!field.rebuild) {
				set({ targetSettings })
				return
			}
			detachForRebuild()
			set({ targetSettings, ...resetExecution(targetSettings), ...debug.view(), ...tools.views() })
		},

		workspaceSnapshot: () => {
			const { activeDocumentId, code, documents, settings } = get()
			return {
				// The tab being typed into holds its live text in `code`.
				files: documents.map((document) => ({ title: document.title, code: document.id === activeDocumentId ? code : document.code })),
				active: documents.find((document) => document.id === activeDocumentId)?.title,
				assembleAll: settings.assembleAll,
				architecture: get().architecture,
			}
		},

		saveProgram: () => {
			if (!writeStoredWorkspace(SAVED_PROGRAM_KEY, get().workspaceSnapshot())) return false
			// What was written out is what is open, so nothing is unsaved any more.
			set((state) => ({ documents: state.documents.map((document) => ({ ...document, dirty: false })), hasSavedProgram: true }))
			return true
		},

		loadProgram: () => {
			const workspace = readStoredWorkspace(SAVED_PROGRAM_KEY)
			if (!workspace) return false
			if (!isKnownArchitecture(workspace.architecture)) {
				set(report([unknownArchitectureDiagnostic(workspace.architecture)]))
				return false
			}
			get().openFiles(workspace.files, { replace: true, active: workspace.active, assembleAll: workspace.assembleAll, architecture: workspace.architecture })
			set({ hasSavedProgram: true })
			return true
		},

		openFiles: (files, options = {}) => {
			if (files.length === 0) return
			const state = get()
			const kept = options.replace ? [] : state.documents
			// A file opened again lands in its own document, shown again if it was put away.
			const replaced = new Map(files.map((file) => [file.title, file]))
			const updated = kept.map((document) => {
				const file = replaced.get(document.title)
				return file ? { id: document.id, title: document.title, code: file.code, dirty: false } : document
			})
			const added = documentsFrom(files.filter((file) => !kept.some((document) => document.title === file.title)))
			const documents = [...updated, ...added]
			const wanted = options.active ?? files[0].title
			const active = documents.find((document) => document.title === wanted) ?? documents[0]
			const settings = options.assembleAll === undefined ? state.settings : { ...state.settings, assembleAll: options.assembleAll }
			if (settings !== state.settings) writeStoredSetting(SETTING_KEYS.assembleAll, settings.assembleAll)
			if (options.architecture !== undefined && options.architecture !== state.architecture) void state.switchArchitecture(options.architecture)
			debug.detach()
			set({
				code: active.code,
				documents,
				activeDocumentId: active.id,
				entryDocumentId: active.id,
				settings,
				...resetExecution(),
			})
		},

		markDocumentsSaved: (documentIds) => {
			const saved = new Set(documentIds)
			set((state) => ({ documents: state.documents.map((document) => saved.has(document.id) ? { ...document, dirty: false } : document) }))
		},

		exportHexText: () => {
			try {
				const exportWords = services().exportWords
				if (!exportWords) return false
				// The export has to be the program that runs, so it takes the same settings:
				// delayed branching changes what a pseudo-instruction expands to.
				const program = assembleProgram()
				set(report(program.diagnostics))
				if (hasErrors(program.diagnostics)) return false
				downloadHexText([...exportWords(program)])
				return true
			} catch (error) {
				set(reportException(error))
				return false
			}
		},

		createDocument: () => {
			const id = newDocumentId()
			const document: SourceDocument = {
				id,
				title: uniqueTitle(`untitled${newFileExtension(get().target?.definition)}`, get().documents),
				code: '',
				dirty: false,
			}
			debug.detach()
			set((state) => ({
				documents: [...state.documents, document],
				activeDocumentId: id,
				entryDocumentId: id,
				code: document.code,
				...resetExecution(),
			}))
		},

		// Bug 12: the tab bar used to choose the entry file, so switching tabs
		// detached the debugger and threw away the running program, its
		// breakpoints and its history.  It now navigates and nothing more, except
		// while the program has yet to run, where following the tab is what makes
		// the file in front of the user the one being assembled.
		selectDocument: (documentId) => {
			const document = get().documents.find((candidate) => candidate.id === documentId)
			if (!document) return
			// A file that was put away comes back onto the tab bar as it is selected.
			const shown = document.hidden
				? { documents: get().documents.map(({ hidden, ...rest }) => rest.id === documentId || !hidden ? rest : { ...rest, hidden }) }
				: {}
			if (document.id === get().activeDocumentId) {
				if (document.hidden) set(shown)
				return
			}
			const started = (debug.machine?.instructionCount ?? 0) > 0
			set({ ...shown, activeDocumentId: document.id, code: document.code, ...(started ? {} : { entryDocumentId: document.id }) })
			if (!started) get().refreshAssembly()
		},

		renameDocument: (documentId, title) => {
			debug.detach()
			set((state) => {
				const wanted = uniqueTitle(title, state.documents, documentId)
				return {
					documents: state.documents.map((document) => document.id === documentId ? { ...document, title: wanted, dirty: true } : document),
					...resetExecution(),
				}
			})
		},

		requestCloseDocument: (documentId) => get().hideDocument(documentId),

		hideDocument: (documentId) => {
			const state = get()
			const index = state.documents.findIndex((document) => document.id === documentId)
			if (index < 0 || state.documents[index].hidden) return
			const documents = state.documents.map((document) => document.id === documentId ? { ...document, hidden: true as const } : document)
			if (documentId !== state.activeDocumentId) {
				set({ documents })
				return
			}
			const next = neighbourOf(documents, state.documents, index)
			set(next ? { documents, activeDocumentId: next.id, code: next.code } : { documents })
		},

		requestDeleteDocument: (documentId) => {
			const document = get().documents.find((candidate) => candidate.id === documentId)
			if (!document) return
			// Edits that were never saved are only thrown away on an explicit answer.
			if (document.dirty) {
				set({ pendingClose: documentId })
				return
			}
			get().closeDocument(documentId)
		},

		confirmCloseDocument: () => {
			const { pendingClose } = get()
			if (pendingClose === null) return
			set({ pendingClose: null })
			get().closeDocument(pendingClose)
		},

		cancelCloseDocument: () => set({ pendingClose: null }),

		closeDocument: (documentId) => {
			const state = get()
			if (!state.documents.some((document) => document.id === documentId)) return
			const documents = state.documents.filter((document) => document.id !== documentId)
			const remainingDocuments = documents.length ? documents : [{ id: newDocumentId(), title: `untitled${newFileExtension(state.target?.definition)}`, code: '', dirty: false }]
			const index = state.documents.findIndex((document) => document.id === documentId)
			const activeDocument = documentId === state.activeDocumentId
				? (neighbourOf(remainingDocuments, state.documents, index) ?? remainingDocuments[Math.max(0, index - 1)])
				: remainingDocuments.find((document) => document.id === state.activeDocumentId)!
			debug.detach()
			set({
				documents: remainingDocuments,
				activeDocumentId: activeDocument.id,
				// The entry file only moves when it is the one being closed.
				entryDocumentId: remainingDocuments.some((document) => document.id === state.entryDocumentId)
					? state.entryDocumentId
					: activeDocument.id,
				code: activeDocument.code,
				...resetExecution(),
			})
		},

		// Half-written source is expected here, so the diagnostics reach the editor
		// live while the console is left to the Assemble button and to running.
		// Once the program has run or been stopped, an edit only updates the
		// diagnostics: the run stays until Run, Assemble or Reset replaces it.
		refreshAssembly: () => {
			try {
				const machine = debug.machine
				if (machine && (machine.instructionCount > 0 || machine.halted)) {
					set({ diagnostics: assembleProgram().diagnostics })
					return
				}
				const created = createSimulator()
				if (!created.simulator) {
					// The machine has just been let go, so the debugger's view of it is
					// republished rather than left claiming there is still one.
					set({ ...debug.view(), diagnostics: created.diagnostics })
					return
				}
				set({ ...simulatorView(), ...debug.view(), diagnostics: created.diagnostics })
			} catch (error) {
				set({ diagnostics: reportException(error).diagnostics })
			}
		},

		assemble: () => {
			try {
				pinEntryToActiveDocument()
				const created = createSimulator()
				set({
					...(created.simulator ? simulatorView() : {}),
					...debug.view(),
					...report(created.diagnostics),
				})
			} catch (error) {
				set(reportException(error))
			}
		},

		setRunSpeed: (speed) => {
			debug.machine?.configure({ speed })
			writeStoredSetting(RUN_SPEED_SETTING, speed)
			set({ runSpeed: speed })
		},

		setCacheSettings: (settings) => {
			// The panel shows the cache that exists, not the one that was asked for.
			const effective = effectiveCacheSettings(settings)
			tools.setSettings('cache', effective)
			set({ cacheSettings: effective, ...tools.views() })
		},

		setBranchHistorySettings: (settings) => {
			tools.setSettings('branchHistory', settings)
			set({ branchHistorySettings: settings, ...tools.views() })
		},

		setPipelineSettings: (settings) => {
			tools.setSettings('pipeline', settings)
			set({ pipelineSettings: settings, ...tools.views() })
		},

		setMemoryReferenceSettings: (settings) => {
			tools.setSettings('memoryReference', settings)
			set({ memoryReferenceSettings: settings, ...tools.views() })
		},

		submitInput: async (input, cancelled = false) => {
			if (!debug.machine?.provideInput(input, cancelled)) return
			await debug.continue()
			set(simulatorView())
		},

		driveTool: (key, action) => {
			const tool = tools.instance(key)
			if (!tool) return
			action(tool)
			set(tools.views())
		},

		sendKeyboardInput: (input) => {
			const device = debug.machine?.keyboardDisplay
			if (!input || !device) return
			device.queue(input)
			set(simulatorView())
		},

		// Assembly failures are reported, not thrown: only an unexpected exception
		// reaches the error bar above the workspace.
		run: async (): Promise<void> => {
			pinEntryToActiveDocument()
			const created = createSimulator()
			if (!created.simulator) {
				set({ ...debug.view(), ...report(created.diagnostics) })
				return
			}
			set({
				isRunning: true,
				isPaused: false,
				pendingInput: null,
				...debug.view(),
				diagnostics: created.diagnostics,
				runToken: get().runToken + 1,
				consoleAttention: 'none',
			})
			await created.simulator.run()
			set(simulatorView())
		},

		step: () => controlled(() => debug.step(), paused),

		/**
		 * Puts the machine at one history entry, publishing once.
		 *
		 * Replaying is cheap and publishing is not: twenty thousand of the
		 * mandelbrot example's instructions replay in 3ms, while snapshotting the
		 * machine after each costs 30 seconds.  So the whole move happens first and
		 * the workspace hears about it once.
		 *
		 * It steps the machine rather than the session, so it lands on the entry
		 * asked for: a session step runs on past words the editor cannot point at.
		 */
		moveHistoryTo: (id: number) => controlled(() => {
			const machine = debug.machine
			if (!machine) return false
			const index = machine.history.indexOfId(id)
			if (index < 0) return false
			// Behind the present it is a rewind; ahead of it, running forward again.
			const move = moveToEntry(machine.historyCursor, index)
			if (move.rewind) return machine.rewindTo(id)
			for (let count = 0; count < move.steps; count++) machine.step()
			return true
		}, paused),

		stepBack: () => controlled(() => debug.stepBack()),

		focusMemoryAddress: (address: number) => set((state) => ({
			focusedMemory: { address, request: (state.focusedMemory?.request ?? 0) + 1 },
		})),

		focusSourceLine: (file: string, line: number) => set((state) => ({
			focusedSource: { file, line, request: (state.focusedSource?.request ?? 0) + 1 },
		})),

		focusRegister: (name: string) => set((state) => ({
			focusedRegister: { name, request: (state.focusedRegister?.request ?? 0) + 1 },
		})),

		rewindTo: (id: number) => controlled(() => debug.machine?.rewindTo(id) ?? false, paused),

		setRegisterValue: (id, value) => edited((machine) => machine.writeRegister(id, value)),
		setMemoryByte: (address, value) => edited((machine) => machine.writeByte(address, value)),
		insertMemoryByte: (address, limit, value) => edited((machine) => machine.insertByte(address, limit, value)),
		deleteMemoryByte: (address, limit) => edited((machine) => machine.deleteByte(address, limit)),

		stepOver: () => freeRunning(() => debug.stepOver(), () => paused),

		stepToReturn: () => freeRunning(() => debug.stepToReturn(), () => paused),

		pause: () => controlled(() => debug.pause()),

		stop: () => controlled(() => debug.stop()),

		runToAddress: (address) => freeRunning(() => debug.runTo(address), () => ({ isPaused: !debug.machine?.halted })),

		setProgramCounter: (address) => controlled(() => debug.setProgramCounter(address), paused),

		continue: () => freeRunning(() => debug.continue()),

		toggleBreakpointAddress: (address) => {
			if (debug.toggleBreakpointAddress(address)) set(debug.view())
		},

		toggleBreakpointLine: (file, line) => {
			if (debug.toggleBreakpointLine(file, line)) set(debug.view())
		},

		// A line already owns its first word's breakpoint, and that is the one the
		// editor gutter of that file shows, so the table toggles it rather than
		// laying a second breakpoint on the same address.
		toggleBreakpointAt: (file, line, address) => {
			if (get().sourceIndex.codeAddressForLine(file, line) === address) {
				get().toggleBreakpointLine(file, line)
				return
			}
			get().toggleBreakpointAddress(address)
		},


		// Pointing at what is already pointed at is not news.  Zustand publishes on
		// every `set`, and much of the workspace reads the store whole, so an
		// unguarded write here re-renders every panel on each mouse move.
		hover: (values) => {
			const held = get().hovered
			// Pointing at what is already pointed at is not news.
			if (HOVER_KINDS.every((kind) => !(kind in values) || values[kind] === held[kind])) return
			set({ hovered: { ...held, ...values } })
		},

		setSelectedFrame: (frame) => set({ selectedFrame: frame }),

		setConsoleAttention: (attention) => set({ consoleAttention: attention }),
		setOpenPanels: (ids) => {
			set({ openPanels: ids })
			// Opening a tool's panel is what starts it, and closing it is what stops it.
			syncTools()
		},

		setGutterColumns: (columns) => {
			// Word rows widen what stepping stops at, and what a paced run animates,
			// to every machine word rather than the first word of each line.
			debug.setWordRows(columns.disassembly)
			writeStoredSetting(GUTTER_SETTING, columns)
			set({ gutterColumns: columns })
		},

		setHeatMap: (shown) => {
			writeStoredSetting(HEAT_MAP_SETTING, shown)
			set({ heatMap: shown })
			syncTools()
		},

		setHeatMapLines: (shown) => {
			writeStoredSetting(HEAT_MAP_LINES_SETTING, shown)
			set({ heatMapLines: shown })
			syncTools()
		},

		setBreakpointLines: (file, lines) => {
			debug.setBreakpointLines(file, lines)
			set(debug.view())
		},

		switchArchitecture: async (id) => {
			if (!isKnownArchitecture(id)) {
				set(report([unknownArchitectureDiagnostic(id)]))
				return false
			}
			// Choosing the target in force still overrides a load in progress.
			const changing = peekArchitecture()?.definition.id !== id
			// The run ends now, at an instruction boundary, rather than racing the load.
			if (changing) debug.machine?.stop()
			try {
				await activateArchitecture(id)
				// Nothing committed, but an earlier request may have stopped the machine.
				if (!changing) set(simulatorView())
				return true
			} catch (error) {
				// A later switch replaced this one, and owns what is published.
				if (error instanceof ActivationSuperseded) return false
				// The previous target stays, with the machine this request stopped.
				set({ ...simulatorView(), ...reportException(error) })
				return false
			}
		},

		reset: () => {
			debug.clear()
			set({
				...resetExecution(),
				...debug.view(),
			})
			// Leave the freshly assembled program in memory rather than a blank view.
			get().refreshAssembly()
		},
	}
})

// The open files follow the typing into storage, a little behind it.
let autosaveHandle: ReturnType<typeof setTimeout> | null = null
useTHRAXStore.subscribe((state, previous) => {
	if (state.documents === previous.documents && state.code === previous.code && state.settings.assembleAll === previous.settings.assembleAll && state.architecture === previous.architecture) return
	if (autosaveHandle !== null) clearTimeout(autosaveHandle)
	autosaveHandle = setTimeout(() => {
		autosaveHandle = null
		writeStoredWorkspace(AUTOSAVE_KEY, useTHRAXStore.getState().workspaceSnapshot())
	}, AUTOSAVE_DELAY_MS)
})
