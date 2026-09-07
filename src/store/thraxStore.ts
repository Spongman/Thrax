import { create } from 'zustand'
import { HOVER_KINDS, NOTHING_HOVERED, type Hovered } from './hover'
import { Assembler, type SourceFile } from '../core/assembler'
import { CP0_REGISTER_COUNT, CP0_STATUS_INITIAL, FP_CONDITION_FLAG_COUNT, FP_REGISTER_COUNT } from '../core/coprocessor'
import { formatDiagnostic, hasErrors } from '../core/diagnostics'
import { disassemble } from '../core/disassembler'
import { parseWord } from '../core/format'
import { DEFAULT_SETTINGS, MEMORY_CONFIGURATIONS, SETTINGS_VALIDATORS, type MemoryConfigurationValues, type ThraxSettings } from '../core/settings'
import { MipsSimulator } from '../core/simulator'
import { EMPTY_SOURCE_INDEX, type SourceIndex, type SourceRow } from '../core/sourceIndex'
import { EffectStore } from '../core/effectStore'
import { HistoryLog, moveToEntry } from '../core/historyLog'
import type { CallFrame, CodeWord, CoprocessorState, Diagnostic, KeyboardDisplayState, MemoryView, PendingInput, Registers, SymbolTables } from '../core/types'
import { DebugSession } from '../debug/session'
import { isFlagSet, readStoredSetting, writeStoredSetting } from '../hooks/useStoredState'
import { downloadHexText } from '../services/hexTextExport'
import type { BranchHistorySettings, BranchHistorySnapshot } from '../tools/branchHistory'
import { effectiveCacheSettings, type CacheSettings, type CacheSnapshot } from '../tools/cache'
import type { MarsBotSnapshot } from '../tools/marsBot'
import type { MemoryReferenceSettings, MemoryReferenceSnapshot } from '../tools/memoryReference'
import type { PipelineSettings, PipelineSnapshot } from '../tools/pipeline'
import type { ProfileSnapshot } from '../tools/profile'
import { createToolRegistry } from '../tools/registry'
import type { ScavengerHuntSnapshot } from '../tools/scavengerHunt'
import type { DigitalLabSim, DigitalLabState } from '../tools/digitalLab'
import type { StatisticsSnapshot } from '../tools/statistics'

/**
 * Instructions per second the run-speed control offers.  null runs flat out;
 * the slow end is where an animated run is worth watching.
 */
export const RUN_SPEEDS: Array<number | null> = [1, 2, 5, 10, 30, 100, 300, 1000, 5000, 30000, null]

const SAVED_PROGRAM_KEY = 'thrax-web.saved-program'
const SAVED_PROGRAM_VERSION = 2
const INITIAL_CODE = '# Simple addition example\n# $t0 = 5, $t1 = 3, $t2 = $t0 + $t1\naddi $t0, $zero, 5\naddi $t1, $zero, 3\nadd $t2, $t0, $t1\n\n# Print result (syscall 1)\nmove $a0, $t2\naddi $v0, $zero, 1\nsyscall\n\n# Exit (syscall 10)\naddi $v0, $zero, 10\nsyscall\n'
interface SavedProgram {
	version: number
	code: string
	savedAt: string
	documents?: SourceDocument[]
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

/**
 * Where each IDE setting persists.  `delayedBranching` and `assembleAll` keep
 * the keys they had as toolbar toggles, so an existing choice survives.
 */
const SETTING_KEYS: { [Key in keyof ThraxSettings]: string } = {
	delayedBranching: 'assemble.delayedBranching',
	assembleAll: 'assemble.allFiles',
	extendedAssembler: 'assemble.extended',
	warningsAreErrors: 'assemble.warningsAreErrors',
	startAtMain: 'assemble.startAtMain',
	bareMachine: 'assemble.bareMachine',
	exceptionHandler: 'assemble.exceptionHandler',
	selfModifyingCode: 'simulate.selfModifyingCode',
	programArguments: 'simulate.programArguments',
	programArgumentsText: 'simulate.programArgumentsText',
	backstepLimit: 'simulate.backstepLimit',
	memoryConfiguration: 'memory.configuration',
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
 * Settings the assembler or the machine reads at build time, so changing one
 * invalidates the program the way editing the source does.
 */
const ASSEMBLY_SETTINGS: ReadonlySet<keyof ThraxSettings> = new Set<keyof ThraxSettings>([
	'delayedBranching',
	'assembleAll',
	'extendedAssembler',
	'warningsAreErrors',
	'startAtMain',
	'bareMachine',
	'exceptionHandler',
	'memoryConfiguration',
	// Read once when the simulator is built, so a change needs a fresh one.
	'selfModifyingCode',
])

const settingKeys = Object.keys(DEFAULT_SETTINGS) as Array<keyof ThraxSettings>

/** Every setting as it was left, falling back to its default. */
function readSettings(): ThraxSettings {
	const stored = settingKeys.map((key) => [key, readStoredSetting(SETTING_KEYS[key], DEFAULT_SETTINGS[key], SETTINGS_VALIDATORS[key])])
	return Object.fromEntries(stored) as ThraxSettings
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

function getSavedProgram(): SavedProgram | null {
	try {
		const rawProgram = window.localStorage.getItem(SAVED_PROGRAM_KEY)
		if (!rawProgram) return null
		const program: unknown = JSON.parse(rawProgram)
		if (
			typeof program !== 'object' ||
			program === null ||
			!('version' in program) ||
			!('code' in program) ||
			((program as SavedProgram).version !== 1 && (program as SavedProgram).version !== SAVED_PROGRAM_VERSION) ||
			typeof (program as SavedProgram).code !== 'string'
		) {
			return null
		}
		return program as SavedProgram
	} catch {
		return null
	}
}

function hasSavedDocuments(program: SavedProgram): program is SavedProgram & { documents: SourceDocument[], activeDocumentId: string } {
	return Array.isArray(program.documents) &&
		program.documents.length > 0 &&
		program.documents.every((document) =>
			typeof document === 'object' &&
			document !== null &&
			typeof document.id === 'string' &&
			typeof document.title === 'string' &&
			typeof document.code === 'string'
		) &&
		typeof program.activeDocumentId === 'string' &&
		program.documents.some((document) => document.id === program.activeDocumentId)
}

/**
 * The program arguments field is one line of text.  Words are separated by
 * whitespace, and quoting keeps one that has spaces in it together.
 */
export function splitProgramArguments(text: string): string[] {
	return [...text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)]
		.map((match) => match[1] ?? match[2] ?? match[3])
}

/** The registers a reset leaves behind, under the selected memory configuration. */
function initialRegisters(memory: MemoryConfigurationValues): Registers {
	return {
		$zero: 0,
		$at: 0,
		$v0: 0,
		$v1: 0,
		$a0: 0,
		$a1: 0,
		$a2: 0,
		$a3: 0,
		$t0: 0,
		$t1: 0,
		$t2: 0,
		$t3: 0,
		$t4: 0,
		$t5: 0,
		$t6: 0,
		$t7: 0,
		$s0: 0,
		$s1: 0,
		$s2: 0,
		$s3: 0,
		$s4: 0,
		$s5: 0,
		$s6: 0,
		$s7: 0,
		$t8: 0,
		$t9: 0,
		$k0: 0,
	$k1: 0,
		$gp: memory.globalPointer,
		$sp: memory.stackPointer,
		$fp: 0,
		$ra: 0,
		$pc: memory.textBaseAddress,
		$hi: 0,
		$lo: 0,
	}
}

function initialCoprocessorState(): CoprocessorState {
	const cp0Registers = new Array(CP0_REGISTER_COUNT).fill(0)
	cp0Registers[12] = CP0_STATUS_INITIAL
	return {
		fpRegisters: new Array(FP_REGISTER_COUNT).fill(0),
		fpConditionFlags: new Array(FP_CONDITION_FLAG_COUNT).fill(false),
		cp0Registers,
	}
}

/**
 * The word at `address` as memory holds it now.  Bytes are read one at a time,
 * which keeps a display read off the observer seam and past the access checks a
 * running instruction goes through.
 */
function liveWord(simulator: MipsSimulator, address: number): number {
	return [0, 1, 2, 3].reduce((word, offset) => word | (simulator.readByte(address + offset) << (offset * 8)), 0) >>> 0
}

interface THRAXStore extends CoprocessorState {
	code: string
	documents: SourceDocument[]
	activeDocumentId: string
	/**
	 * The file the program is assembled from.  It follows the tab bar only until
	 * the program starts, so switching tabs mid-run leaves it running.
	 */
	entryDocumentId: string
	/** The IDE settings, as the settings dialog edits them. */
	settings: ThraxSettings
	registers: Registers
	memory: MemoryView
	console: string
	pc: number
	halted: boolean
	instructionCount: number
	/** Which line of which file every machine word of the program came from. */
	sourceIndex: SourceIndex
	/** Everything wrong with the source, as the editor marks it up. */
	diagnostics: Diagnostic[]
	/** Machine words of each assembled file, keyed by source line, in address order. */
	codeWords: Map<string, Map<number, CodeWord[]>>
	labels: Map<string, number>
	callStack: CallFrame[]
	pendingInput: PendingInput | null
	keyboardDisplay: KeyboardDisplayState
	isRunning: boolean
	isPaused: boolean
	breakpoints: Set<number>
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
	executionHistory: ReturnType<MipsSimulator['getExecutionHistory']>
	/** How many entries stand behind the present; the rest are ahead of it. */
	historyCursor: number
	/** The columns every entry's effects are read out of. */
	historyEffects: EffectStore
	/**
	 * Bumped whenever the log changes.  The log is published by reference and is
	 * written in place, so a selector comparing it would never see a change.
	 */
	historyVersion: number
	/** Symbols of the assembled program, by the file that owns them. */
	symbols: SymbolTables
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
	marsBot: MarsBotSnapshot
	scavengerHunt: ScavengerHuntSnapshot
	digitalLab: DigitalLabState
	/** Holds or releases a keypad key on the Digital Lab device. */
	pressDigitalLabKey: (key: number | null) => void
	setCode: (code: string) => void
	/** Edits one open file, which need not be the one being assembled. */
	setDocumentCode: (documentId: string, code: string) => void
	/** Changes one setting; the ones the assembler reads rebuild the program. */
	setSetting: <Key extends keyof ThraxSettings>(key: Key, value: ThraxSettings[Key]) => void
	saveProgram: () => boolean
	loadProgram: () => boolean
	exportHexText: () => boolean
	createDocument: () => void
	selectDocument: (documentId: string) => void
	renameDocument: (documentId: string, title: string) => void
	closeDocument: (documentId: string) => void
	/** Closes a file, asking first when it has edits that were never saved. */
	requestCloseDocument: (documentId: string) => void
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
	 * Sets a register, a coprocessor register or a word of memory by hand.  Each
	 * is a history entry of its own, so it shows in the panel and steps back
	 * like anything else.
	 */
	setRegisterValue: (name: string, value: number) => boolean
	setFpRegisterValue: (index: number, value: number) => boolean
	setCp0RegisterValue: (index: number, value: number) => boolean
	setMemoryValue: (address: number, value: number) => boolean
	stepOver: () => Promise<void>
	stepToReturn: () => Promise<void>
	/** Runs until the given address is reached, without keeping a breakpoint there. */
	runToAddress: (address: number) => Promise<void>
	/** Moves execution to the given address without running anything. */
	setProgramCounter: (address: number) => void
	pause: () => void
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

	/** A simulator over the assembled program, or the diagnostics that stopped it. */
	const createSimulator = (): { simulator: MipsSimulator | null, diagnostics: Diagnostic[] } => {
		const { files, entries } = assemblySources()
		const settings = get().settings
		const { backstepLimit, delayedBranching, extendedAssembler, memoryConfiguration, selfModifyingCode, warningsAreErrors } = settings
		const memory = MEMORY_CONFIGURATIONS[memoryConfiguration]
		const assembler = new Assembler(files, entries, { delayedBranching, extendedAssembler, warningsAreErrors, memory })
		const { program, machineCode, diagnostics } = assembler.assemble()
		// A program that did not assemble is not worth loading; its diagnostics stand
		// for it, and the stale program it would have replaced is let go.
		if (hasErrors(diagnostics)) {
			debug.detach()
			return { simulator: null, diagnostics }
		}
		const nextSimulator = new MipsSimulator(machineCode, program, memory, {
			startAtMain: settings.startAtMain,
			// The field is one line of text; the machine wants the words of it.
			programArguments: settings.programArguments ? splitProgramArguments(settings.programArgumentsText) : undefined,
		})
		nextSimulator.delayedBranching = delayedBranching
		// Off, stores into text and fetches outside it fault.
		nextSimulator.selfModifyingCode = selfModifyingCode
		// How far back the workspace is willing to let the program be rewound.
		nextSimulator.maxHistorySize = backstepLimit
		nextSimulator.configure({ speed: get().runSpeed })
		// A paced run is worth watching, so refresh the workspace between batches.
		nextSimulator.onProgress = () => set({ ...simulatorView(), ...tools.views(), isRunning: true, isPaused: false })
		// Attach first: connecting before the run exists would push the observers
		// onto the machine being replaced, and configure them with its device port.
		tools.attach(nextSimulator, { delayedBranching, device: nextSimulator.devicePort() })
		tools.setWanted(wantedTools())
		// Breakpoints and the addresses worth stopping at outlive re-assembly.
		debug.rebind(nextSimulator, program.sourceIndex)
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
	 * The index says which words a line owns; the bytes are read live, so data
	 * the program has written to shows what it holds now.
	 */
	const codeWordFor = (row: SourceRow, current: MipsSimulator): CodeWord => {
		if (row.instruction === null) {
			const bytes = Array.from({ length: row.length ?? 0 }, (_, offset) => current.readByte(row.address + offset))
			return { address: row.address, word: null, bytes, directive: row.directive, offset: row.offset, truncated: row.truncated }
		}
		// Bug 13: the assembled array is what the program started as, not what it
		// holds now, so an instruction the program overwrote read back as the original.
		const word = liveWord(current, row.address)
		return { address: row.address, word, bytes: [0, 1, 2, 3].map((offset) => (word >>> (24 - offset * 8)) & 0xff) }
	}

	/**
	 * The assembled bytes of every file, under the line that wrote them.  Each
	 * editor reads its own file's words, so an included file gets the same gutter
	 * the entry file does.
	 */
	const codeWordsByFile = (current: MipsSimulator) => {
		const index = current.program.sourceIndex
		return new Map([...index.files()].map((file) =>
			[file, new Map([...index.lines(file)].map(([line, rows]) => [line, rows.map((row) => codeWordFor(row, current))]))]))
	}

	/** The code of every open file, keyed by the title assembly identifies it by. */

	const simulatorView = () => {
		const simulator = debug.machine
		if (!simulator) return {}
		const state = simulator.getState()
		return {
			registers: state.registers,
			memory: state.memory,
			console: state.console,
			pc: state.pc,
			halted: state.halted,
			instructionCount: state.instructionCount,
			isRunning: false,
			isPaused: state.paused,
			executionHistory: simulator.getExecutionHistory(),
			historyCursor: simulator.getHistoryCursor(),
			historyEffects: simulator.effects,
			historyVersion: get().historyVersion + 1,
			symbols: simulator.program.symbols,
			breakpoints: new Set(simulator.getBreakpoints()),
			sourceIndex: simulator.program.sourceIndex,
			codeWords: codeWordsByFile(simulator),
			labels: new Map(simulator.program.labels),
			callStack: state.callStack,
			selectedFrame: null,
			pendingInput: state.pendingInput,
			keyboardDisplay: state.keyboardDisplay,
			fpRegisters: state.fpRegisters,
			fpConditionFlags: state.fpConditionFlags,
			cp0Registers: state.cp0Registers,
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
	function ensureSimulator(): MipsSimulator | null {
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

	const controlledAsync = async (action: () => Promise<boolean>, after: () => Partial<THRAXStore> = () => ({})) => {
		try {
			set((await action()) ? { ...simulatorView(), ...after() } : { isRunning: false })
		} catch (error) {
			set({ ...reportException(error), isRunning: false })
		}
	}

	const paused = { isPaused: true }

	/**
	 * A change the user made rather than one the program made.  Only while the
	 * machine is stopped: editing under a running program would race it.
	 */
	const edited = (change: (machine: MipsSimulator) => boolean): boolean => {
		const machine = debug.machine
		if (!machine || get().isRunning) return false
		if (!change(machine)) return false
		set({ ...simulatorView(), ...paused })
		return true
	}

	// Takes the settings rather than reading them, so a reset caused by changing
	// the memory configuration lays out from the new one and not the old.
	const resetExecution = (settings: ThraxSettings = get().settings) => {
		const layout = MEMORY_CONFIGURATIONS[settings.memoryConfiguration]
		return {
			registers: initialRegisters(layout),
			memory: { words: new Map() },
			console: '',
			pc: layout.textBaseAddress,
			halted: false,
			instructionCount: 0,
			sourceIndex: EMPTY_SOURCE_INDEX,
			codeWords: new Map<string, Map<number, CodeWord[]>>(),
			labels: new Map<string, number>(),
			callStack: [],
			selectedFrame: null,
			pendingInput: null,
			keyboardDisplay: { queuedInput: '', displayOutput: '' },
			isRunning: false,
			isPaused: false,
			breakpoints: new Set<number>(),
				executionHistory: new HistoryLog(),
			historyCursor: 0,
			historyEffects: new EffectStore(),
			historyVersion: (get()?.historyVersion ?? 0) + 1,
			symbols: { locals: new Map(), globals: new Map() },
			...initialCoprocessorState(),
		}
	}

	// `get()` has nothing to return while the initial state is being built.
	const initialSettings = readSettings()

	return {
		code: INITIAL_CODE,
		documents: [{ id: 'main', title: 'main.asm', code: INITIAL_CODE, dirty: false }],
		activeDocumentId: 'main',
		entryDocumentId: 'main',
		settings: initialSettings,
		...resetExecution(initialSettings),
		focusedMemory: null,
		focusedSource: null,
		focusedRegister: null,
		breakpointLines: new Map<string, Set<number>>(),
		breakpointAddresses: new Set<number>(),
		diagnostics: [],
		hovered: NOTHING_HOVERED,
		selectedFrame: null,
		pendingClose: null,
		gutterColumns: savedGutterColumns,
		heatMap: readStoredSetting(HEAT_MAP_SETTING, false, (value) => typeof value === 'boolean'),
		heatMapLines: readStoredSetting(HEAT_MAP_LINES_SETTING, false, (value) => typeof value === 'boolean'),
		runToken: 0,
		consoleAttention: 'none',
		openPanels: [],
		hasSavedProgram: getSavedProgram() !== null,
		runSpeed: readStoredSetting<number | null>(RUN_SPEED_SETTING, null, (value) => RUN_SPEEDS.includes(value as number | null)),
		...tools.views(),
		cacheSettings: effectiveCacheSettings(toolSettings.cache),
		branchHistorySettings: toolSettings.branchHistory,
		pipelineSettings: toolSettings.pipeline,
		memoryReferenceSettings: toolSettings.memoryReference,

		setCode: (newCode) => {
			debug.detach()
			set((state) => ({
				code: newCode,
				documents: state.documents.map((document) => document.id === state.activeDocumentId
					? { ...document, code: newCode, dirty: true }
					: document),
				...resetExecution(),
			}))
		},

		// Editing a file that is not the entry point still invalidates the
		// program, since `.include` and the all-files setting can pull it in.
		setDocumentCode: (documentId, newCode) => {
			const state = get()
			if (documentId === state.activeDocumentId) {
				state.setCode(newCode)
				return
			}
			debug.detach()
			set({
				documents: state.documents.map((document) => document.id === documentId
					? { ...document, code: newCode, dirty: true }
					: document),
				...resetExecution(),
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
			debug.detach()
			set({ settings, ...resetExecution(settings) })
		},

		saveProgram: () => {
			try {
				const state = get()
				const documents = state.documents.map((document) => ({ ...document, dirty: false }))
				const program: SavedProgram = {
					version: SAVED_PROGRAM_VERSION,
					code: state.code,
					savedAt: new Date().toISOString(),
					documents,
					activeDocumentId: state.activeDocumentId,
					assembleAllFiles: state.settings.assembleAll,
				}
				window.localStorage.setItem(SAVED_PROGRAM_KEY, JSON.stringify(program))
				// What was written out is what is open, so nothing is unsaved any more.
				set({ documents, hasSavedProgram: true })
				return true
			} catch {
				return false
			}
		},

		loadProgram: () => {
			const program = getSavedProgram()
			if (!program) return false
			const saved = hasSavedDocuments(program)
				? program.documents
				: [{ id: 'main', title: 'main.asm', code: program.code, dirty: false }]
			// A workspace saved before titles were kept apart can still collide.
			const documents = saved.reduce<SourceDocument[]>((all, document) =>
				[...all, { ...document, dirty: false, title: uniqueTitle(document.title, all) }], [])
			const activeDocumentId = hasSavedDocuments(program) ? program.activeDocumentId : documents[0].id
			const activeDocument = documents.find((document) => document.id === activeDocumentId)!
			debug.detach()
			set({
				code: activeDocument.code,
				documents,
				activeDocumentId,
				entryDocumentId: activeDocumentId,
				settings: { ...get().settings, assembleAll: program.assembleAllFiles === true },
				hasSavedProgram: true,
				...resetExecution(),
			})
			return true
		},

		exportHexText: () => {
			try {
				const { files, entries } = assemblySources()
				// The same options the run assembles with: delayed branching changes
				// what a pseudo-instruction expands to, so exporting without it would
				// hand out words the program never ran.
				// The export has to be the program that runs, so it takes the same options.
				const { delayedBranching, extendedAssembler, memoryConfiguration, warningsAreErrors } = get().settings
				const memory = MEMORY_CONFIGURATIONS[memoryConfiguration]
				const { machineCode, diagnostics } = new Assembler(files, entries, { delayedBranching, extendedAssembler, warningsAreErrors, memory }).assemble()
				set(report(diagnostics))
				if (hasErrors(diagnostics)) return false
				downloadHexText(machineCode)
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
				title: uniqueTitle('untitled.asm', get().documents),
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
			if (!document || document.id === get().activeDocumentId) return
			const started = (debug.machine?.instructionCount ?? 0) > 0
			set({ activeDocumentId: document.id, code: document.code, ...(started ? {} : { entryDocumentId: document.id }) })
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

		requestCloseDocument: (documentId) => {
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
			const remainingDocuments = documents.length ? documents : [{ id: newDocumentId(), title: 'untitled.asm', code: '', dirty: false }]
			const activeDocument = documentId === state.activeDocumentId
				? remainingDocuments[Math.max(0, state.documents.findIndex((document) => document.id === documentId) - 1)]
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
		refreshAssembly: () => {
			try {
				const created = createSimulator()
				if (!created.simulator) {
					set({ diagnostics: created.diagnostics })
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

		pressDigitalLabKey: (key: number | null) => {
			// The registry types a tool by its snapshot, which says nothing about
			// the device methods only this one has.
			const device = tools.instance('digitalLab') as unknown as DigitalLabSim | undefined
			device?.pressKey(key)
			set(tools.views())
		},

		sendKeyboardInput: (input) => {
			if (!input || !debug.machine) return
			debug.machine.queueKeyboardInput(input)
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
			const index = machine.getExecutionHistory().indexOfId(id)
			if (index < 0) return false
			// Behind the present it is a rewind; ahead of it, running forward again.
			const move = moveToEntry(machine.getHistoryCursor(), index)
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

		setRegisterValue: (name, value) => edited((machine) => machine.setRegister(name, value)),
		setFpRegisterValue: (index, value) => edited((machine) => machine.setFpRegister(index, value)),
		setCp0RegisterValue: (index, value) => edited((machine) => machine.setCp0Register(index, value)),
		setMemoryValue: (address, value) => edited((machine) => machine.setMemoryWord(address, value)),

		stepOver: () => controlledAsync(() => debug.stepOver(), () => paused),

		stepToReturn: () => controlledAsync(() => debug.stepToReturn(), () => paused),

		pause: () => controlled(() => debug.pause()),

		runToAddress: (address) => {
			set({ isRunning: true, isPaused: false })
			return controlledAsync(() => debug.runTo(address), () => ({ isPaused: !debug.machine?.halted }))
		},

		setProgramCounter: (address) => controlled(() => debug.setProgramCounter(address), paused),

		continue: () => controlledAsync(() => debug.continue()),

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
