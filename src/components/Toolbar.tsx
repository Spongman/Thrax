import React from 'react'
import { DEFAULT_GUTTER_COLUMNS, RUN_SPEEDS, useTHRAXStore } from '../store/thraxStore'
import { AddressIcon, ArchiveIcon, BrowserLoadIcon, BrowserSaveIcon, CodeBytesIcon, DisassemblyIcon, ExportIcon, FilesIcon, GitBranchIcon, GlobeIcon, HeatLinesIcon, HeatMapIcon, LinkIcon, NewFileIcon, OpenFolderIcon, PauseIcon, ResetIcon, RunIcon, SaveAllIcon, SaveIcon, StepBackIcon, StepIntoIcon, StepOutIcon, StepOverIcon } from './icons'
import { nextToggles } from './toggleGroup'
import MainMenu from './MainMenu'
import SettingsDialog from './SettingsDialog'
import GitHubDialog from './GitHubDialog'
import { openPanel } from './DockLayout'
import type { MenuAction } from './MainMenu'
import { openFindReplace } from '../services/findReplace'
import { supportsFolders } from '../services/localFiles'
import { copyShareLink, downloadWorkspaceZip, openFilesFromDisk, openFolderAsProject, openWorkspaceFromUrl, saveAllDocuments, saveDocument } from '../services/workspaceActions'
import './Toolbar.css'

interface ToolbarProps {
	onRun: () => Promise<void>
	onReset: () => void
}

/**
 * The toolbar carries what a run is driven with, left to right in the order it
 * is used: assemble, run, step, pace.  What is chosen once a session lives in
 * the menu, and what belongs to the file sits on the right.
 */
function Toolbar({ onRun, onReset }: ToolbarProps) {
	const { activeDocumentId, assemble, continue: continueExecution, createDocument, exportHexText, gutterColumns, hasSavedProgram, heatMap, heatMapLines, isPaused, isRunning, loadProgram, openPanels, pause, runSpeed, saveProgram, setGutterColumns, setHeatMap, setHeatMapLines, setRunSpeed, step, stepBack, stepOver, stepToReturn } = useTHRAXStore()
	const [showSettings, setShowSettings] = React.useState(false)
	const [showGitHub, setShowGitHub] = React.useState(false)
	const [storageMessage, setStorageMessage] = React.useState<string | null>(null)

	const handleLoadExample = (code: string) => {
		window.dispatchEvent(new CustomEvent('load-example', { detail: { code } }))
	}

	const showStorageMessage = (message: string) => {
		setStorageMessage(message)
		window.setTimeout(() => setStorageMessage(null), 2500)
	}

	/** Every file action reports through the one status line, success or refusal alike. */
	const report = (result: string | null | Promise<string | null>) => {
		Promise.resolve(result)
			.then((text) => { if (text) showStorageMessage(text) })
			.catch((error: unknown) => showStorageMessage(error instanceof Error ? error.message : String(error)))
	}

	const handleSaveToBrowser = () => {
		showStorageMessage(saveProgram() ? 'Workspace saved in this browser' : 'Unable to save workspace')
	}

	const handleLoadFromBrowser = () => {
		if (!window.confirm('Replace the current workspace with the saved workspace?')) return
		showStorageMessage(loadProgram() ? 'Saved workspace loaded' : 'No saved workspace is available')
	}

	const handleOpenUrl = () => {
		const url = window.prompt('Open a workspace from a link: a GitHub file, folder or gist, a .zip, or a source file')
		if (url) report(openWorkspaceFromUrl(url))
	}

	const handleExport = () => {
		showStorageMessage(exportHexText() ? 'Downloaded HexText' : 'Unable to assemble HexText')
	}

	/** The File menu, MARS's plus the ways a browser has of getting files in and out. */
	const fileActions: MenuAction[] = [
		{ id: 'new', icon: NewFileIcon, label: 'New file', run: createDocument },
		{ id: 'open', icon: FilesIcon, label: 'Open files…', title: 'Add files, or a .zip of them, from this machine', run: () => report(openFilesFromDisk()) },
		{ id: 'url', icon: GlobeIcon, label: 'Open from URL…', run: handleOpenUrl },
		...(supportsFolders() ? [{ id: 'folder', icon: OpenFolderIcon, label: 'Open folder…', title: 'Make a folder on this machine the project; Save writes back into it', run: () => report(openFolderAsProject()) }] : []),
		{ id: 'save', icon: SaveIcon, label: 'Save file', title: 'Into the open folder, or as a download', run: () => report(saveDocument(activeDocumentId)) },
		{ id: 'saveAll', icon: SaveAllIcon, label: 'Save all', title: 'Every file into the open folder, or the workspace as a .zip', run: () => report(saveAllDocuments()) },
		{ id: 'sep1', label: '-', run: () => {} },
		{ id: 'saveBrowser', icon: BrowserSaveIcon, label: 'Save in this browser', run: handleSaveToBrowser },
		{ id: 'loadBrowser', icon: BrowserLoadIcon, label: 'Load from this browser', disabled: !hasSavedProgram, run: handleLoadFromBrowser },
		{ id: 'sep2', label: '-', run: () => {} },
		{ id: 'share', icon: LinkIcon, label: 'Copy share link', title: 'A link that carries every file in the workspace', run: () => report(copyShareLink()) },
		{ id: 'zip', icon: ArchiveIcon, label: 'Download .zip', run: () => report(downloadWorkspaceZip()) },
		{ id: 'hex', icon: ExportIcon, label: 'Download HexText', title: 'The assembled program as HexText', run: handleExport },
		{ id: 'github', icon: GitBranchIcon, label: 'GitHub…', title: 'Sign in, browse your gists, publish the workspace as one', run: () => setShowGitHub(true) },
	]

	// The slider steps through the speed list, with the fastest notch unpaced.
	const speedIndex = Math.max(0, RUN_SPEEDS.indexOf(runSpeed))
	const speedLabel = runSpeed === null
		? 'no limit'
		: runSpeed < 1000 ? `${runSpeed}/s` : `${runSpeed / 1000}k/s`

	return (
		<div className="toolbar">
			<MainMenu
				onSettings={() => setShowSettings(true)}
				onLoadExample={handleLoadExample}
				onOpenPanel={openPanel}
				openPanels={openPanels}
				fileActions={fileActions}
			/>

			<span className="toolbar-separator" />

			<button className="btn btn-secondary" onClick={assemble} title="Assemble the current source">
				Assemble
			</button>

			<div className="btn-group">
				<button className="btn btn-icon btn-primary" onClick={() => (isPaused ? void continueExecution() : void onRun())} title={isPaused ? 'Continue (F5)' : 'Run (F5)'}>
					<RunIcon />
				</button>
				<button className="btn btn-icon" onClick={pause} disabled={!isRunning} title="Pause">
					<PauseIcon />
				</button>
				<button className="btn btn-icon" onClick={onReset} title="Reset (alt+F5), restart with shift+F5">
					<ResetIcon />
				</button>
			</div>

			<div className="btn-group">
				<button className="btn btn-icon" onClick={() => stepBack()} disabled={!isPaused} title="Step back">
					<StepBackIcon />
				</button>
				<button className="btn btn-icon" onClick={() => step()} title="Step into (F8)">
					<StepIntoIcon />
				</button>
				<button className="btn btn-icon" onClick={() => void stepOver()} title="Step over (F10)">
					<StepOverIcon />
				</button>
				<button className="btn btn-icon" onClick={() => void stepToReturn()} title="Step out (shift+F7)">
					<StepOutIcon />
				</button>
			</div>

			<label className="toolbar-speed" title="Instructions per second while running; the rightmost notch runs at full speed">
				<span className="toolbar-speed-icon" aria-hidden="true">🐢</span>
				<input
					type="range"
					min={0}
					max={RUN_SPEEDS.length - 1}
					step={1}
					value={speedIndex}
					onChange={(event) => setRunSpeed(RUN_SPEEDS[Number(event.target.value)])}
					aria-label="Run speed"
				/>
				<span className="toolbar-speed-value">{speedLabel}</span>
			</label>

			<span className="toolbar-separator" />

			<div className="gutter-toggles" role="group" aria-label="Gutter columns">
				<button
					className={`gutter-toggle${gutterColumns.address ? ' active' : ''}`}
					type="button"
					aria-pressed={gutterColumns.address}
					title="Address: show the address of each machine word"
					aria-label="Address"
					onClick={(event) => setGutterColumns(nextToggles({ ...DEFAULT_GUTTER_COLUMNS, ...gutterColumns }, 'address', event))}
				>
					<AddressIcon />
				</button>
				<button
					className={`gutter-toggle${gutterColumns.code ? ' active' : ''}`}
					type="button"
					aria-pressed={gutterColumns.code}
					title="Code bytes: show each machine word beside its source line"
					aria-label="Code bytes"
					onClick={(event) => setGutterColumns(nextToggles({ ...DEFAULT_GUTTER_COLUMNS, ...gutterColumns }, 'code', event))}
				>
					<CodeBytesIcon />
				</button>
				<button
					className={`gutter-toggle${gutterColumns.disassembly ? ' active' : ''}`}
					type="button"
					aria-pressed={gutterColumns.disassembly}
					title="Disassembly: show the decoded instruction beside its source line"
					aria-label="Disassembly"
					onClick={(event) => setGutterColumns(nextToggles({ ...DEFAULT_GUTTER_COLUMNS, ...gutterColumns }, 'disassembly', event))}
				>
					<DisassemblyIcon />
				</button>
			</div>

			<div className="gutter-toggles" role="group" aria-label="Profile heat map">
				<button
					className={`gutter-toggle${heatMap ? ' active' : ''}`}
					type="button"
					aria-pressed={heatMap}
					title="Profile heat map: colour each line number by how often the line ran"
					aria-label="Profile heat map"
					onClick={() => setHeatMap(!heatMap)}
				>
					<HeatMapIcon />
				</button>
				<button
					className={`gutter-toggle${heatMap && heatMapLines ? ' active' : ''}`}
					type="button"
					aria-pressed={heatMapLines}
					disabled={!heatMap}
					title="Tint the source line behind the code with its heat as well"
					aria-label="Heat map line tint"
					onClick={() => setHeatMapLines(!heatMapLines)}
				>
					<HeatLinesIcon />
				</button>
			</div>

			<div className="spacer"></div>

			{storageMessage && <span className="storage-message" role="status">{storageMessage}</span>}

			<button className="btn btn-secondary" onClick={openFindReplace} title="Find and replace in the source being assembled">
				Find
			</button>

			{showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
			{showGitHub && <GitHubDialog onClose={() => setShowGitHub(false)} onReport={showStorageMessage} />}
		</div>
	)
}

export default Toolbar
