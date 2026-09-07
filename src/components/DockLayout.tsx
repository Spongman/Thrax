import React from 'react'
import { DockviewDefaultTab, DockviewReact, themeDark, type AddPanelOptions, type DockviewApi, type DockviewReadyEvent, type IDockviewPanel, type IDockviewPanelHeaderProps, type IDockviewPanelProps, type SerializedDockview } from 'dockview-react'
import 'dockview-react/dist/styles/dockview.css'
import { CP0_REGISTERS } from '../core/coprocessor'
import { visibleAddresses } from '../debug/session'
import { useTHRAXStore, type SourceDocument } from '../store/thraxStore'
import SourcePane from './SourcePane'
import RegisterView from './RegisterView'
import MemoryView from './MemoryView'
import ConsoleOutput from './ConsoleOutput'
import CallStackView from './CallStackView'
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
const MarsBotView = deferred(() => import('./MarsBotView'))
const MemoryReferenceView = deferred(() => import('./MemoryReferenceView'))
const MipsXrayView = deferred(() => import('./MipsXrayView'))
const PipelineView = deferred(() => import('./PipelineView'))
const ScavengerHuntView = deferred(() => import('./ScavengerHuntView'))
const DigitalLabView = deferred(() => import('./DigitalLabView'))
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

const RegistersPanel = () => {
	const { registers, fpRegisters, fpConditionFlags, cp0Registers, focusedRegister, halted, hovered, isPaused, isRunning, hover, setRegisterValue, setFpRegisterValue, setCp0RegisterValue } = useTHRAXStore()
	// Only while the machine is stopped, and only once it has one to edit.
	const editable = !isRunning && (isPaused || halted)

	const handleEdit = React.useCallback((entry: { name: string }, bits: number, high?: number) => {
		const name = entry.name
		if (name.startsWith('$f')) {
			const index = Number(name.slice(2))
			const low = setFpRegisterValue(index, bits)
			// A double occupies the register and its odd partner.
			return high === undefined ? low : low && setFpRegisterValue(index + 1, high)
		}
		const cp0 = CP0_REGISTERS.find((register) => register.name === name)
		if (cp0) return setCp0RegisterValue(cp0.index, bits)
		return setRegisterValue(name, bits | 0)
	}, [setCp0RegisterValue, setFpRegisterValue, setRegisterValue])
	return (
		<div className="dock-panel">
			<RegisterView
				registers={registers}
				editable={editable}
				focused={focusedRegister}
				hoveredAddress={hovered.address}
				onHoverAddress={(address) => hover({ address })}
				hoveredRegister={hovered.register}
				onHoverRegister={(register) => hover({ register })}
				onEdit={handleEdit}
				fpRegisters={fpRegisters}
				fpConditionFlags={fpConditionFlags}
				cp0Registers={cp0Registers}
			/>
		</div>
	)
}

const MemoryPanel = () => {
	const { callStack, focusedMemory, halted, hovered, isPaused, isRunning, memory, pc, setMemoryValue, sourceIndex, hover } = useTHRAXStore()
	const editable = !isRunning && (isPaused || halted)
	// Mark the program counter only where the editor can highlight it too: once a
	// program halts, the pc sits past the last instruction and belongs to neither.
	const instructionAddresses = React.useMemo(() => visibleAddresses(sourceIndex), [sourceIndex])
	const returnAddresses = React.useMemo(() => new Set(callStack.map((frame) => frame.returnAddress)), [callStack])
	return (
		<div className="dock-panel dock-panel-flush">
			<MemoryView
				memory={memory}
				pc={instructionAddresses.has(pc) ? pc : null}
				returnAddresses={returnAddresses}
				focusAddress={focusedMemory?.address ?? null}
				focusRequest={focusedMemory?.request ?? 0}
				onHoverAddress={(address) => hover({ address })}
				hoveredAddress={hovered.address}
				editable={editable}
				onEditWord={setMemoryValue}
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
	const memory = useTHRAXStore((state) => state.memory)
	return <div className="dock-panel"><BitmapDisplay memory={memory} /></div>
}

const KeyboardDisplayPanel = () => {
	const { keyboardDisplay, sendKeyboardInput } = useTHRAXStore()
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

const XrayPanel = () => {
	const { memory, pc } = useTHRAXStore()
	return <div className="dock-panel"><MipsXrayView memory={memory} pc={pc} /></div>
}

const PipelinePanel = () => {
	const { pipeline, pipelineSettings, setPipelineSettings } = useTHRAXStore()
	return <div className="dock-panel"><PipelineView pipeline={pipeline} settings={pipelineSettings} onChange={setPipelineSettings} /></div>
}

const MemoryReferencePanel = () => {
	const { memoryReference, memoryReferenceSettings, setMemoryReferenceSettings } = useTHRAXStore()
	return <div className="dock-panel"><MemoryReferenceView memoryReference={memoryReference} settings={memoryReferenceSettings} onChange={setMemoryReferenceSettings} /></div>
}

const MarsBotPanel = () => {
	const marsBot = useTHRAXStore((state) => state.marsBot)
	return <div className="dock-panel"><MarsBotView marsBot={marsBot} /></div>
}

const DigitalLabPanel = () => {
	const digitalLab = useTHRAXStore((state) => state.digitalLab)
	const pressKey = useTHRAXStore((state) => state.pressDigitalLabKey)
	return <div className="dock-panel"><DigitalLabView state={digitalLab} onPressKey={pressKey} /></div>
}

const ScavengerHuntPanel = () => {
	const scavengerHunt = useTHRAXStore((state) => state.scavengerHunt)
	return <div className="dock-panel"><ScavengerHuntView scavengerHunt={scavengerHunt} /></div>
}

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

const components = {
	source: SourcePanel,
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
	marsBot: MarsBotPanel,
	scavengerHunt: ScavengerHuntPanel,
	digitalLab: DigitalLabPanel,
	pipeline: PipelinePanel,
	xray: XrayPanel,
}

const LAYOUT_KEY = 'thrax-web.dock-layout'
/**
 * Bumped when a stored layout can no longer be read; older ones are discarded.
 * A layout holding tabs a release no longer opens by itself is one such.
 */
const LAYOUT_VERSION = 3

/**
 * Where a panel lands: beside the registers, or below the source with the
 * memory.  The group leaders are placed against the file panels first, so a
 * panel opened later has something of its own kind to join.
 */
const DOCK_LEADER: Record<'side' | 'bottom', string> = { side: 'registers', bottom: 'memory' }

function panelOptions(id: string, anchor: string): AddPanelOptions | null {
	const panel = panelById(id)
	if (!panel) return null
	const leader = DOCK_LEADER[panel.dock]
	const options = { id: panel.id, component: panel.id, title: panel.title }
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
		Number(right.id === DOCK_LEADER[right.dock]) - Number(left.id === DOCK_LEADER[left.dock]))
	return order.map((panel) => panelOptions(panel.id, anchor)).filter((options): options is AddPanelOptions => options !== null)
}

/** A stored layout is only usable while every panel in it still has a component. */
function readStoredLayout(): SerializedDockview | null {
	try {
		const raw = window.localStorage.getItem(LAYOUT_KEY)
		if (raw === null) return null
		const stored: unknown = JSON.parse(raw)
		if (typeof stored !== 'object' || stored === null) return null
		const { version, layout } = stored as { version?: unknown, layout?: SerializedDockview }
		if (version !== LAYOUT_VERSION || !layout?.grid || !layout.panels) return null
		const known = Object.values(layout.panels).every((panel) => panel.contentComponent !== undefined && panel.contentComponent in components)
		return known ? layout : null
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
function syncFilePanels(api: DockviewApi, documents: readonly SourceDocument[], removing: Set<string>) {
	const wanted = new Map(documents.map((document) => [filePanelId(document.id), document]))
	for (const panel of api.panels) {
		if (!isFilePanel(panel) || wanted.has(panel.id)) continue
		// Removing a panel ourselves must not read back as the user closing a file.
		removing.add(panel.id)
		api.removePanel(panel)
	}

	let anchor = api.panels.find(isFilePanel)
	for (const [id, document] of wanted) {
		const existing = api.getPanel(id)
		if (existing) {
			if (existing.title !== fileTitle(document)) existing.api.setTitle(fileTitle(document))
			continue
		}
		const panel = api.addPanel({
			id,
			component: 'source',
			tabComponent: 'source',
			title: fileTitle(document),
			params: { documentId: document.id },
			...(anchor ? { position: { referencePanel: anchor.id, direction: 'within' as const } } : {}),
			inactive: true,
		})
		anchor ??= panel
	}
	return anchor
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
			api.fromJSON(stored)
		} catch {
			api.clear()
		}
	}
	const restored = api.panels.length > 0
	const { activeDocumentId, documents } = useTHRAXStore.getState()
	const anchor = syncFilePanels(api, documents, removing)

	for (const options of initialPanels(anchor?.id ?? '')) {
		if (api.getPanel(options.id)) continue
		const reference = options.position && 'referencePanel' in options.position ? options.position.referencePanel : undefined
		if (!restored || (typeof reference === 'string' && api.getPanel(reference))) {
			api.addPanel(options)
			continue
		}
		// Its usual neighbour is gone, so it joins whichever group is in front.
		const { position, ...loose } = options
		api.addPanel({ ...loose, inactive: true })
	}
	api.getPanel(filePanelId(activeDocumentId))?.api.setActive()
	publishOpenPanels(api)
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
	const { activeDocumentId, cancelCloseDocument, confirmCloseDocument, console: output, consoleAttention, documents, focusedMemory, focusedRegister, focusedSource, pendingClose, pendingInput, runToken, setConsoleAttention } = useTHRAXStore()
	const switchedForRun = React.useRef<number | null>(null)
	const deliveredOutput = React.useRef('')
	/** File panels this component is removing, which are not files being closed. */
	const removingPanels = React.useRef(new Set<string>())
	const shownDocument = React.useRef<string | null>(null)

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
			useTHRAXStore.getState().selectDocument(documentIdOf(panel))
		}))

		// Dockview also removes a panel to move it, so a file is closed only once
		// the panel has not come back by the end of the move.
		subscriptions.current.push(event.api.onDidRemovePanel((panel) => {
			if (!isFilePanel(panel)) return
			const { id } = panel
			window.setTimeout(() => {
				if (removingPanels.current.delete(id) || apiRef.current?.getPanel(id)) return
				useTHRAXStore.getState().requestCloseDocument(documentIdOf(panel))
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
		syncFilePanels(api, documents, removingPanels.current)
		// Only a change of file moves the tabs, so running a program leaves
		// whichever panel the user is looking at in front.
		if (shownDocument.current === activeDocumentId) return
		shownDocument.current = activeDocumentId
		api.getPanel(filePanelId(activeDocumentId))?.api.setActive()
	}, [activeDocumentId, documents])

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
		// Selecting a file that is already the active one changes nothing in the
		// store, so the effect that follows the active document stays quiet and the
		// tab stays behind whatever is in front of it.  A navigation has to bring
		// it forward either way.
		apiRef.current?.getPanel(filePanelId(target.id))?.api.setActive()
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
