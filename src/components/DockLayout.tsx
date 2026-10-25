import { RGB32_LE } from '../core/bitmapFormats'
import React from 'react'
import { DockviewDefaultTab, DockviewReact, themeDark, type AddPanelOptions, type DockviewApi, type DockviewReadyEvent, type IDockviewPanel, type IDockviewPanelHeaderProps, type IDockviewPanelProps, type SerializedDockview } from 'dockview-react'
import 'dockview-react/dist/styles/dockview.css'
import type { PanelContribution } from '../architectures/contracts'
import { contributedPanelIds } from '../architectures/registry'
import { visibleAddresses } from '../debug/session'
import { shownDocuments, useTHRAXStore, type SourceDocument } from '../store/thraxStore'
import SourcePane from './SourcePane'
import RegisterView from './RegisterView'
import MemoryView from './MemoryView'
import ConsoleOutput from './ConsoleOutput'
import CallStackView from './CallStackView'
import FilesPanel from './FilesView'
import Modal from './Modal'
import { INITIAL_PANELS, PANELS, panelById } from './panels'
import './DockLayout.css'

/**
 * A view fetched the first time its panel is opened.
 *
 * Only the windows a fresh workspace shows are in the first bundle.  Everything
 * the menu opens is a chunk of its own, so a tool nobody opened, and the
 * drawings and tables behind it, are never downloaded at all.
 */
function deferred<P extends object>(load: () => Promise<{ default: React.ComponentType<P> }>): React.FC<P> {
	const View = React.lazy(load) as unknown as React.ComponentType<P>
	const Deferred = (props: P) => (
		<React.Suspense fallback={<div className="dock-panel dock-panel-loading">Loading…</div>}>
			<View {...props} />
		</React.Suspense>
	)
	Deferred.displayName = 'Deferred'
	return Deferred
}

const BitmapDisplay = deferred(() => import('./BitmapDisplay'))
const KeyboardDisplayTool = deferred(() => import('./KeyboardDisplayTool'))
const InstructionStatisticsView = deferred(() => import('./InstructionStatisticsView'))
const CacheSimulatorView = deferred(() => import('./CacheSimulatorView'))
const BranchHistoryView = deferred(() => import('./BranchHistoryView'))
const MemoryReferenceView = deferred(() => import('./MemoryReferenceView'))
const PipelineView = deferred(() => import('./PipelineView'))
// These two read the store themselves, so what is fetched is the panel rather
// than a view it is wrapped around.
const HistoryPanel = deferred(async () => ({ default: (await import('./HistoryView')).HistoryPanel }))
const SymbolTablePanel = deferred(async () => ({ default: (await import('./SymbolTableView')).SymbolTablePanel }))

/** Open files are panels of the main tab group, one editor each. */
const FILE_PREFIX = 'file:'
const filePanelId = (documentId: string) => `${FILE_PREFIX}${documentId}`
const documentIdOf = (panel: IDockviewPanel) => panel.id.slice(FILE_PREFIX.length)
const isFilePanel = (panel: IDockviewPanel) => panel.id.startsWith(FILE_PREFIX)
/** An unsaved file is marked in its tab, which shows the title and nothing else. */
const fileTitle = (document: SourceDocument) => `${document.dirty ? '● ' : ''}${document.title}`

const SourcePanel = (props: IDockviewPanelProps) => (
	<div className="dock-panel dock-panel-flush"><SourcePane documentId={props.params.documentId as string} /></div>
)

const FilesWindow = () => (
	<div className="dock-panel"><FilesPanel /></div>
)

const RegistersPanel = () => {
	const { focusedRegister, hasMachine, hovered, isRunning, hover, registers, setRegisterValue, targetProfile, targetVariant } = useTHRAXStore()
	// Whenever the machine is stopped, which includes a program that has been
	// assembled and not yet started: setting up a register before the first step
	// is what editing one is mostly for.  A machine has to exist to be edited,
	// though, or a cell would take the value only to refuse it.
	const editable = !isRunning && hasMachine
	return (
		<div className="dock-panel">
			<RegisterView
				registers={registers}
				descriptors={targetVariant?.registers ?? NO_REGISTERS}
				banks={targetVariant?.registerBanks}
				radix={targetVariant?.displayRadix}
				isAddress={targetProfile?.isMappedAddress}
				editable={editable}
				focused={focusedRegister}
				hoveredAddress={hovered.address}
				onHoverAddress={(address) => hover({ address })}
				hoveredRegister={hovered.register}
				onHoverRegister={(register) => hover({ register })}
				onEdit={setRegisterValue}
			/>
		</div>
	)
}

const MemoryPanel = () => {
	const { callStack, deleteMemoryByte, focusedMemory, hasMachine, hovered, insertMemoryByte, isRunning, memory, pc, setMemoryByte, sourceIndex, hover, target, targetProfile, targetVariant } = useTHRAXStore()
	const editable = !isRunning && hasMachine
	// Mark the program counter only where the editor can highlight it too: once a
	// program halts, the pc sits past the last instruction and belongs to neither.
	const instructionAddresses = React.useMemo(() => visibleAddresses(sourceIndex), [sourceIndex])
	// Keyed on the addresses, not the array, so an unchanged stack keeps every memory row's props.
	const returnKey = callStack.map((frame) => frame.returnAddress).join(',')
	const returnAddresses = React.useMemo(() => new Set(returnKey ? returnKey.split(',').map(Number) : []), [returnKey])
	return (
		<div className="dock-panel dock-panel-flush">
			{/* Another target is another address space: the view starts over at its first section. */}
			<MemoryView
				key={target?.definition.id}
				memory={memory}
				radix={targetVariant?.displayRadix}
				sections={targetProfile?.memorySections ?? NO_SECTIONS}
				disassembly={target?.services.disassembly}
				pc={instructionAddresses.has(pc) ? pc : null}
				returnAddresses={returnAddresses}
				focusAddress={focusedMemory?.address ?? null}
				focusRequest={focusedMemory?.request ?? 0}
				onHoverAddress={(address) => hover({ address })}
				hoveredAddress={hovered.address}
				editable={editable}
				onEditByte={setMemoryByte}
				onInsertByte={insertMemoryByte}
				onDeleteByte={deleteMemoryByte}
				characterSet={targetProfile?.characterSet}
			/>
		</div>
	)
}

const ConsolePanel = () => {
	const { console: output, focusSourceLine, pendingInput, submitInput } = useTHRAXStore()
	return <div className="dock-panel dock-panel-flush"><ConsoleOutput output={output} pendingInput={pendingInput} onSubmitInput={submitInput} onSelectSource={focusSourceLine} /></div>
}

const CallStackPanel = () => {
	const { callStack, focusMemoryAddress, halted, labels, pc, selectedFrame, setSelectedFrame, sourceIndex } = useTHRAXStore()
	// Selecting a frame shows where it returns to, which is a navigation like any
	// other: the memory window comes forward and the word is lit where it lands.
	const selectFrame = (frame: number | null) => {
		setSelectedFrame(frame)
		const address = frame === null ? null : frame === -1 ? pc : callStack[frame]?.returnAddress ?? null
		if (address !== null) focusMemoryAddress(address)
	}
	// Any assembled file having code means there is a program to have a stack.
	const hasProgram = React.useMemo(() => [...sourceIndex.files()].some((file) => sourceIndex.hasCode(file)), [sourceIndex])
	return (
		<div className="dock-panel">
			<CallStackView
				frames={callStack}
				pc={pc}
				labels={labels}
				hasProgram={hasProgram}
				halted={halted}
				selectedFrame={selectedFrame}
				onSelect={selectFrame}
			/>
		</div>
	)
}

const BitmapPanel = () => {
	const palette = useTHRAXStore((state) => state.bitmapPalette)
	const format = useTHRAXStore((state) => state.bitmapFormat ?? state.targetProfile?.bitmap ?? RGB32_LE)
	const memory = useTHRAXStore((state) => state.memory)
	const dataBase = useTHRAXStore((state) => state.targetProfile?.dataBase)
	const architecture = useTHRAXStore((state) => state.architecture)
	// Remounting on a switch reads the new target's own stored base.
	return <div className="dock-panel"><BitmapDisplay key={architecture} format={format} palette={palette} memory={memory} defaultBase={dataBase} architecture={architecture} /></div>
}

const KeyboardDisplayPanel = () => {
	const { keyboardDisplay, sendKeyboardInput, target } = useTHRAXStore()
	if (!keyboardDisplay) return <div className="dock-panel dock-panel-unavailable">{`Not available for ${target?.definition.name ?? 'this architecture'}.`}</div>
	return <div className="dock-panel"><KeyboardDisplayTool device={keyboardDisplay} onSend={sendKeyboardInput} /></div>
}

const StatisticsPanel = () => {
	const statistics = useTHRAXStore((state) => state.statistics)
	return <div className="dock-panel"><InstructionStatisticsView statistics={statistics} /></div>
}

const CachePanel = () => {
	const { cache, cacheSettings, setCacheSettings } = useTHRAXStore()
	return <div className="dock-panel"><CacheSimulatorView cache={cache} settings={cacheSettings} onChange={setCacheSettings} /></div>
}

const BranchHistoryPanel = () => {
	const { branchHistory, branchHistorySettings, setBranchHistorySettings } = useTHRAXStore()
	return <div className="dock-panel"><BranchHistoryView branchHistory={branchHistory} settings={branchHistorySettings} onChange={setBranchHistorySettings} /></div>
}

const PipelinePanel = () => {
	const { pipeline, pipelineSettings, setPipelineSettings } = useTHRAXStore()
	return <div className="dock-panel"><PipelineView pipeline={pipeline} settings={pipelineSettings} onChange={setPipelineSettings} /></div>
}

const MemoryReferencePanel = () => {
	const { memoryReference, memoryReferenceSettings, setMemoryReferenceSettings } = useTHRAXStore()
	return <div className="dock-panel"><MemoryReferenceView memoryReference={memoryReference} settings={memoryReferenceSettings} onChange={setMemoryReferenceSettings} /></div>
}

/**
 * A panel an architecture contributes.  Its id is kept in the layout whatever
 * the target, so switching away and back finds it where it was; a target that
 * supplies none shows it as unavailable.
 */
function ContributedPanel({ id }: { id: string }) {
	const target = useTHRAXStore((state) => state.target)
	const contribution = target?.definition.panels?.find((panel) => panel.id === id)
	const View = React.useMemo(() => contribution && React.lazy(contribution.load), [contribution])
	if (!View) {
		return <div className="dock-panel dock-panel-unavailable">{target ? `Not available for ${target.definition.name}.` : 'Loading…'}</div>
	}
	return (
		<React.Suspense fallback={<div className="dock-panel dock-panel-loading">Loading…</div>}>
			<View />
		</React.Suspense>
	)
}

/** One component per contributed id, made once, since dockview creates panels by name. */
function contributedComponent(id: string): React.FC {
	const Contributed = () => <ContributedPanel id={id} />
	Contributed.displayName = `Contributed(${id})`
	return Contributed
}

const contributions = (): readonly PanelContribution[] => useTHRAXStore.getState().target?.definition.panels ?? []

/** Carries the console's plea for attention while its tab sits in the background. */
const ConsoleTab = (props: IDockviewPanelHeaderProps) => {
	const attention = useTHRAXStore((state) => state.consoleAttention)
	return <DockviewDefaultTab {...props} className={attention === 'none' ? undefined : `console-tab-${attention}`} />
}

/** Double-clicking a file tab renames it, which `.include` resolves by title. */
const SourceTab = (props: IDockviewPanelHeaderProps) => {
	const documentId = props.params.documentId as string
	const renameDocument = useTHRAXStore((state) => state.renameDocument)
	const handleRename = (event: React.MouseEvent) => {
		event.preventDefault()
		event.stopPropagation()
		const { documents } = useTHRAXStore.getState()
		const title = documents.find((document) => document.id === documentId)?.title
		if (title === undefined) return
		const renamed = window.prompt('File name', title)
		const trimmed = renamed?.trim()
		if (trimmed && trimmed !== title) renameDocument(documentId, trimmed)
	}
	return <div className="source-tab" onDoubleClick={handleRename}><DockviewDefaultTab {...props} /></div>
}

const tabComponents = { console: ConsoleTab, source: SourceTab }

const SHARED_COMPONENTS: Record<string, React.FC<IDockviewPanelProps>> = {
	source: SourcePanel,
	files: FilesWindow,
	history: HistoryPanel,
	symbols: SymbolTablePanel,
	registers: RegistersPanel,
	memory: MemoryPanel,
	console: ConsolePanel,
	callStack: CallStackPanel,
	bitmap: BitmapPanel,
	keyboardDisplay: KeyboardDisplayPanel,
	statistics: StatisticsPanel,
	cache: CachePanel,
	branchHistory: BranchHistoryPanel,
	memoryReference: MemoryReferencePanel,
	pipeline: PipelinePanel,
}

/**
 * The components dockview creates panels from.  Contributed ids are added as
 * they are met, in a layout or a menu, since they are not known up front.
 */
const components: Record<string, React.FC<IDockviewPanelProps>> = { ...SHARED_COMPONENTS }

function ensureComponent(id: string) {
	if (!(id in components)) components[id] = contributedComponent(id)
}

const NO_REGISTERS: readonly never[] = []
const NO_SECTIONS: readonly never[] = []

const LAYOUT_KEY = 'thrax-web.dock-layout'
/**
 * Version 4 moves Files out of older arrangements into its own left column.
 * Version 3 layouts can be migrated without discarding the other panel groups.
 */
const LAYOUT_VERSION = 4

/**
 * Files get the outer left edge. Other panels join the registers at the right
 * or the memory below the source. Leaders are placed first so later panels
 * have something of their own kind to join.
 */
const DOCK_LEADER = { left: 'files', side: 'registers', bottom: 'memory' } as const

function panelOptions(id: string, anchor: string): AddPanelOptions | null {
	const panel = panelById(id, contributions())
	if (!panel) return null
	ensureComponent(panel.id)
	const leader = DOCK_LEADER[panel.dock]
	const options = { id: panel.id, component: panel.id, title: panel.title }
	if (panel.dock === 'left') return { ...options, position: { direction: 'left' }, initialWidth: 220 }
	// The console asks for attention through its tab, so it draws its own.
	const tab = panel.id === 'console' ? { tabComponent: 'console' } : {}
	if (panel.id === leader) {
		const placement = panel.dock === 'side'
			? { position: { referencePanel: anchor, direction: 'right' as const }, initialWidth: 340 }
			: { position: { referencePanel: anchor, direction: 'below' as const }, initialHeight: 260 }
		return { ...options, ...tab, ...placement }
	}
	return { ...options, ...tab, position: { referencePanel: leader, direction: 'within' as const }, inactive: true }
}

/**
 * The panels a fresh workspace opens, leaders first so the rest have a group to
 * join.  A tool is not among them: it is opened from the menu, and until then
 * neither its tab nor its code is here.
 */
function initialPanels(anchor: string): AddPanelOptions[] {
	const order = [...INITIAL_PANELS].sort((left, right) =>
		Number(right.dock === 'left') - Number(left.dock === 'left') ||
		Number(right.id === DOCK_LEADER[right.dock]) - Number(left.id === DOCK_LEADER[left.dock]))
	return order.map((panel) => panelOptions(panel.id, anchor)).filter((options): options is AddPanelOptions => options !== null)
}

/** A stored layout is only usable while every panel in it still has a component. */
function readStoredLayout(): { version: number, layout: SerializedDockview } | null {
	try {
		const raw = window.localStorage.getItem(LAYOUT_KEY)
		if (raw === null) return null
		const stored: unknown = JSON.parse(raw)
		if (typeof stored !== 'object' || stored === null) return null
		const { version, layout } = stored as { version?: unknown, layout?: SerializedDockview }
		if ((version !== 3 && version !== LAYOUT_VERSION) || !layout?.grid || !layout.panels) return null
		// A panel an architecture contributes keeps its place whichever target is
		// in force, and says whether that target supplies it.
		const contributed = contributedPanelIds()
		const known = Object.values(layout.panels).every(({ contentComponent: id }) => id !== undefined && (id in components || contributed.has(id)))
		if (!known) return null
		for (const panel of Object.values(layout.panels)) ensureComponent(panel.contentComponent!)
		return { version, layout }
	} catch {
		// Unreadable storage (private mode, bad JSON) just means the default layout.
		return null
	}
}

function saveLayout(api: DockviewApi) {
	try {
		window.localStorage.setItem(LAYOUT_KEY, JSON.stringify({ version: LAYOUT_VERSION, layout: api.toJSON() }))
	} catch {
		// Storage can be full or blocked; the layout simply is not remembered.
	}
}

/**
 * Brings the file panels in line with the open files: one panel per file, in
 * one tab group, with the titles they currently carry.  A stored layout can
 * name files this session does not have, and files can be opened and closed
 * while it is running, so both directions are reconciled here.
 */
export function syncFilePanels(api: DockviewApi, documents: readonly SourceDocument[], removing: Set<string>, activeId?: string, reveal = false, pendingRemoval?: ReadonlySet<string>) {
	// A file put away keeps its place in the project and gives up its tab.
	const wanted = new Map(shownDocuments(documents).map((document) => [filePanelId(document.id), document]))
	for (const panel of api.panels) {
		if (!isFilePanel(panel) || wanted.has(panel.id)) continue
		// Removing a panel ourselves must not read back as the user closing a file.
		removing.add(panel.id)
		api.removePanel(panel)
	}

	let anchor = api.panels.find(isFilePanel)
	let addedActive = false
	for (const [id, document] of wanted) {
		const existing = api.getPanel(id)
		if (existing) {
			if (existing.title !== fileTitle(document)) existing.api.setTitle(fileTitle(document))
			continue
		}
		// Selection can change before Dockview’s deferred close/move decision.
		// Leave a missing panel alone until that decision updates the file state.
		if (pendingRemoval?.has(id)) continue
		const panel = api.addPanel({
			id,
			component: 'source',
			tabComponent: 'source',
			title: fileTitle(document),
			params: { documentId: document.id },
			position: anchor ? { referencePanel: anchor.id, direction: 'within' } : editorPlacement(api),
			inactive: true,
		})
		anchor ??= panel
		if (document.id === activeId) addedActive = true
	}
	if (activeId && (reveal || addedActive)) api.getPanel(filePanelId(activeId))?.api.setActive()
	return anchor
}

/**
 * Where the editors go when every tab has been put away and one comes back.
 * Its group went with the last tab, so without this the file would join
 * whichever group is in front; the default arrangement has it above the
 * memory and left of the registers, and that is where it is put back.
 */
function editorPlacement(api: DockviewApi): AddPanelOptions['position'] {
	if (api.getPanel(DOCK_LEADER.bottom)) return { referencePanel: DOCK_LEADER.bottom, direction: 'above' }
	if (api.getPanel(DOCK_LEADER.side)) return { referencePanel: DOCK_LEADER.side, direction: 'left' }
	if (api.getPanel(DOCK_LEADER.left)) return { referencePanel: DOCK_LEADER.left, direction: 'right' }
	return undefined
}

/**
 * Restores the stored arrangement, then adds back any of the panels a fresh
 * workspace opens that it is missing, so a window added by a later release
 * still appears beside the ones it belongs with.  A panel the arrangement left
 * out on purpose is not put back: closing one is how it is turned off.
 */
export function buildLayout(api: DockviewApi, removing: Set<string>) {
	const stored = readStoredLayout()
	if (stored) {
		try {
			api.fromJSON(stored.layout)
		} catch {
			api.clear()
		}
	}
	const restored = api.panels.length > 0
	const migrateFiles = restored && stored !== null && stored.version < LAYOUT_VERSION
	if (migrateFiles) {
		const files = api.getPanel(DOCK_LEADER.left)
		// Reinsert this panel at the root edge, leaving its former neighbours in place.
		if (files) api.removePanel(files)
	}
	const { activeDocumentId, documents } = useTHRAXStore.getState()
	const anchor = syncFilePanels(api, documents, removing)

	for (const options of initialPanels(anchor?.id ?? '')) {
		if (api.getPanel(options.id)) continue
		const reference = options.position && 'referencePanel' in options.position ? options.position.referencePanel : undefined
		if (!restored || reference === undefined || (typeof reference === 'string' && api.getPanel(reference))) {
			api.addPanel(options)
			continue
		}
		// Its usual neighbour is gone, so it joins whichever group is in front.
		const { position, ...loose } = options
		api.addPanel({ ...loose, inactive: true })
	}
	api.getPanel(filePanelId(activeDocumentId))?.api.setActive()
	publishOpenPanels(api)
	if (migrateFiles) saveLayout(api)
}

/**
 * The dock this window is showing.  A module-level handle rather than a prop:
 * the menu that opens a panel is in the toolbar, which is not inside the dock.
 */
let dockApi: DockviewApi | null = null

/**
 * Opens a panel from the menu, or brings it forward when it is already there.
 * It joins the group its own kind sits in, or whichever group is in front when
 * that one has been closed.
 */
export function openPanel(id: string) {
	const api = dockApi
	if (!api) return
	const existing = api.getPanel(id)
	if (existing) {
		existing.api.setActive()
		return
	}
	const options = panelOptions(id, api.panels.find(isFilePanel)?.id ?? '')
	if (!options) return
	const reference = options.position && 'referencePanel' in options.position ? options.position.referencePanel : undefined
	if (typeof reference === 'string' && !api.getPanel(reference)) {
		const { position, ...loose } = options
		api.addPanel(loose).api.setActive()
		return
	}
	api.addPanel({ ...options, inactive: false }).api.setActive()
}

/** What the menu ticks: the panels currently on screen. */
function publishOpenPanels(api: DockviewApi) {
	const open = api.panels.filter((panel) => !isFilePanel(panel)).map((panel) => panel.id)
	const { openPanels, setOpenPanels } = useTHRAXStore.getState()
	if (open.length === openPanels.length && open.every((id, index) => id === openPanels[index])) return
	setOpenPanels(open)
}

function DockLayout() {
	const apiRef = React.useRef<DockviewApi | null>(null)
	const { activeDocumentId, documentSelection, cancelCloseDocument, confirmCloseDocument, console: output, consoleAttention, documents, focusedMemory, focusedRegister, focusedSource, pendingClose, pendingInput, runToken, setConsoleAttention } = useTHRAXStore()
	const switchedForRun = React.useRef<number | null>(null)
	const deliveredOutput = React.useRef('')
	/** File panels this component is removing, which are not files being closed. */
	const removingPanels = React.useRef(new Set<string>())
	const pendingRemoval = React.useRef(new Set<string>())
	const shownDocument = React.useRef<string | null>(null)
	const deliveredSelection = React.useRef(documentSelection)

	const saveHandle = React.useRef(0)
	const subscriptions = React.useRef<{ dispose: () => void }[]>([])

	const onReady = React.useCallback((event: DockviewReadyEvent) => {
		apiRef.current = event.api
		dockApi = event.api
		buildLayout(event.api, removingPanels.current)
		shownDocument.current = useTHRAXStore.getState().activeDocumentId

		// Bringing a file's tab forward makes it the file being assembled.
		subscriptions.current.push(event.api.onDidActivePanelChange(({ panel }) => {
			if (!panel || !isFilePanel(panel)) return
			shownDocument.current = documentIdOf(panel)
			const state = useTHRAXStore.getState()
			if (state.activeDocumentId !== documentIdOf(panel)) state.selectDocument(documentIdOf(panel))
		}))

		// Dockview also removes a panel to move it, so a file is closed only once
		// the panel has not come back by the end of the move.
		subscriptions.current.push(event.api.onDidRemovePanel((panel) => {
			if (!isFilePanel(panel)) return
			const { id } = panel
			const documentId = documentIdOf(panel)
			pendingRemoval.current.add(id)
			window.setTimeout(() => {
				pendingRemoval.current.delete(id)
				if (apiRef.current !== event.api || removingPanels.current.delete(id) || event.api.getPanel(id)) return
				useTHRAXStore.getState().requestCloseDocument(documentId)
			}, 0)
		}))
		// Dragging and resizing fire in bursts, so the layout is written once things settle.
		subscriptions.current.push(event.api.onDidLayoutChange(() => {
			publishOpenPanels(event.api)
			window.clearTimeout(saveHandle.current)
			saveHandle.current = window.setTimeout(() => saveLayout(event.api), 300)
		}))
		// Showing the console answers whatever it was asking for.
		const console = event.api.getPanel('console')
		if (console) {
			subscriptions.current.push(console.api.onDidActiveChange((change) => {
				if (change.isActive) useTHRAXStore.getState().setConsoleAttention('none')
			}))
		}
	}, [])

	React.useEffect(() => () => {
		window.clearTimeout(saveHandle.current)
		for (const subscription of subscriptions.current) subscription.dispose()
		subscriptions.current = []
		dockApi = null
	}, [])

	// One panel per open file, kept in step as files are opened, renamed and closed.
	React.useEffect(() => {
		const api = apiRef.current
		if (!api) return
		// Explicit opens reveal even the current file. Ordinary source edits and
		// running a program leave whichever tool the user is watching in front.
		const reveal = shownDocument.current !== activeDocumentId || deliveredSelection.current !== documentSelection
		deliveredSelection.current = documentSelection
		syncFilePanels(api, documents, removingPanels.current, activeDocumentId, reveal, pendingRemoval.current)
		shownDocument.current = activeDocumentId
	}, [activeDocumentId, documentSelection, documents])

	// The first console traffic of a run brings the panel forward; later traffic
	// only flashes the tab, and a request for input keeps flashing until it shows.
	React.useEffect(() => {
		const panel = apiRef.current?.getPanel('console')
		if (!panel) return
		// A run starts with an empty console, so what came before it means nothing.
		const newRun = switchedForRun.current !== runToken
		if (newRun) deliveredOutput.current = ''
		const grew = output.length > deliveredOutput.current.length
		deliveredOutput.current = output
		if (!grew && !pendingInput) return
		if (panel.api.isActive) {
			setConsoleAttention('none')
			return
		}
		if (newRun) {
			switchedForRun.current = runToken
			panel.api.setActive()
			setConsoleAttention('none')
			return
		}
		setConsoleAttention(pendingInput ? 'input' : 'output')
	}, [output, pendingInput, runToken, setConsoleAttention])

	// One flash for output; input keeps flashing, so it has no timer.
	React.useEffect(() => {
		if (consoleAttention !== 'output') return
		const handle = window.setTimeout(() => setConsoleAttention('none'), 1200)
		return () => window.clearTimeout(handle)
	}, [consoleAttention, setConsoleAttention])

	// A navigation is worthless if its destination is behind another tab, so the
	// panel it lands in comes forward.  A source line brings its own file forward
	// through the store, which already owns which file is in front.
	React.useEffect(() => {
		if (focusedMemory) openPanel('memory')
	}, [focusedMemory])
	React.useEffect(() => {
		if (focusedRegister) openPanel('registers')
	}, [focusedRegister])
	React.useEffect(() => {
		if (!focusedSource) return
		const { documents: open, selectDocument } = useTHRAXStore.getState()
		const target = open.find((document) => document.title === focusedSource.file)
		if (!target) return
		selectDocument(target.id)
	}, [focusedSource])

	const pending = documents.find((document) => document.id === pendingClose)

	// Dockview removed the panel before the store was asked, so keeping the file
	// means putting its panel back where it was.
	const keepDocument = () => {
		const id = pending?.id
		cancelCloseDocument()
		const api = apiRef.current
		if (!api || !id) return
		syncFilePanels(api, useTHRAXStore.getState().documents, removingPanels.current)
		api.getPanel(filePanelId(id))?.api.setActive()
	}

	return (
		<>
			<DockviewReact className="dock-layout" components={components} tabComponents={tabComponents} theme={themeDark} onReady={onReady} />
			{pending && (
				<Modal
					title="Unsaved changes"
					onClose={keepDocument}
					footer={(
						<>
							<button className="btn btn-secondary" onClick={keepDocument}>Keep editing</button>
							<button className="btn btn-primary" onClick={confirmCloseDocument}>Close without saving</button>
						</>
					)}
				>
					{`${pending.title} has changes that were never saved.`}
				</Modal>
			)}
		</>
	)
}

export default DockLayout
