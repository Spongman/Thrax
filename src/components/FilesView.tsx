import React from 'react'
import { shownDocuments, useTHRAXStore } from '../store/thraxStore'
import { connectedFolder, rememberedFolder, supportsFolders } from '../services/localFiles'
import { useGitHubSession } from '../services/githubSession'
import { clearProject, deleteCurrentGist, deleteDocumentEverywhere, downloadWorkspaceZip, newGistProject, openFilesFromDisk, reconnectProjectFolder, saveDocument, saveToCurrentGist, saveToNewGist } from '../services/workspaceActions'
import { ExportIcon, NewFileIcon, NewGistIcon, OpenIcon, TrashIcon, UploadIcon, UploadNewIcon } from './icons'
import './FilesView.css'

/**
 * The project's files: every one the assembler can see, whether or not it has
 * a tab.  Selecting one brings it forward; a tab that was closed is brought
 * back from here; and this is where a file is taken out of the project, since
 * closing its tab no longer does that.
 */
export function FilesPanel() {
	const { activeDocumentId, createDocument, documents, entryDocumentId, requestDeleteDocument, selectDocument, settings } = useTHRAXStore()
	const { viewer, gist } = useGitHubSession()
	const [message, setMessage] = React.useState<string | null>(null)
	const [folder, setFolder] = React.useState<string | null>(connectedFolder()?.name ?? null)
	const [remembered, setRemembered] = React.useState<string | null>(null)

	React.useEffect(() => {
		let live = true
		void rememberedFolder().then((known) => { if (live) setRemembered(known?.name ?? null) })
		return () => { live = false }
	}, [])

	const report = (result: string | null | Promise<string | null>) => {
		void Promise.resolve(result).then((text) => {
			setFolder(connectedFolder()?.name ?? null)
			if (text) setMessage(text)
		}).catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)))
	}

	const shown = new Set(shownDocuments(documents).map((document) => document.id))
	const entryIsEveryFile = settings.assembleAll

	const remove = (documentId: string) => {
		const document = documents.find((candidate) => candidate.id === documentId)
		if (!document) return
		if (document.dirty) {
			requestDeleteDocument(documentId)
			return
		}
		// Removing from a connected folder deletes the file on disk, so it is asked about.
		if (folder && !window.confirm(`Delete ${document.title} from ${folder}?`)) return
		report(deleteDocumentEverywhere(documentId).then(() => `Removed ${document.title}`))
	}

	const clearAll = () => {
		const unsaved = documents.filter((document) => document.dirty).length
		const warning = unsaved ? ` ${unsaved} ${unsaved === 1 ? 'has' : 'have'} changes not saved to disk.` : ''
		if (!window.confirm(`Remove every file from the project?${warning}`)) return
		report(clearProject())
	}

	const activeTitle = documents.find((document) => document.id === activeDocumentId)?.title
	const askDescription = (title: string) => window.prompt(title, activeTitle ? `Thrax: ${activeTitle}` : 'Thrax workspace')

	const startGist = () => {
		const unsaved = documents.filter((document) => document.dirty).length
		if (!window.confirm(`Start a new gist with a blank workspace? The files open now are replaced.${unsaved ? ` ${unsaved} ${unsaved === 1 ? 'has' : 'have'} changes not saved to disk.` : ''}`)) return
		const description = askDescription('Description for the new gist')
		if (description !== null) report(newGistProject(description))
	}

	const saveNewGist = () => {
		const description = askDescription('Description for the new gist')
		if (description !== null) report(saveToNewGist(description))
	}

	const removeGist = () => {
		if (!gist) return
		if (!window.confirm(`Delete the gist "${gist.description || gist.id}" from GitHub? The files stay open here.`)) return
		report(deleteCurrentGist())
	}

	return (
		<div className="files-view">
			<div className="files-actions">
				<div className="btn-group" role="group" aria-label="Project">
					<button className="btn btn-icon" onClick={createDocument} title="New file" aria-label="New file"><NewFileIcon /></button>
					<button className="btn btn-icon" onClick={() => report(openFilesFromDisk())} title="Open files, or a .zip of them, from this machine" aria-label="Open files"><OpenIcon /></button>
					<button className="btn btn-icon" onClick={() => report(downloadWorkspaceZip())} title="Download the workspace as a .zip" aria-label="Download workspace"><ExportIcon /></button>
					<button className="btn btn-icon" onClick={clearAll} title="Remove every file from the project" aria-label="Remove all files"><TrashIcon /></button>
				</div>
				{viewer && (
					<div className="btn-group" role="group" aria-label="Gist">
						<button className="btn btn-icon" onClick={startGist} title="New gist: a blank workspace bound to a new gist" aria-label="New gist"><NewGistIcon /></button>
						<button className="btn btn-icon" onClick={() => report(saveToCurrentGist())} disabled={!gist} title={gist ? `Save to gist ${gist.description || gist.id}` : 'Save to the current gist (none yet)'} aria-label="Save to current gist"><UploadIcon /></button>
						<button className="btn btn-icon" onClick={saveNewGist} title="Save to a new gist" aria-label="Save to new gist"><UploadNewIcon /></button>
						<button className="btn btn-icon" onClick={removeGist} disabled={!gist} title={gist ? `Delete gist ${gist.description || gist.id} from GitHub` : 'Delete the current gist (none yet)'} aria-label="Delete gist"><TrashIcon /></button>
					</div>
				)}
				{!folder && supportsFolders() && remembered && (
					<button className="btn btn-secondary" onClick={() => report(reconnectProjectFolder())} title={`Reconnect ${remembered}`}>Reconnect {remembered}</button>
				)}
			</div>
			{folder && <div className="files-folder" title="Saving writes into this folder">📁 {folder}</div>}
			{viewer && gist && (
				<div className="files-folder" title="Save to current gist writes back here">
					☁ <a href={gist.url} target="_blank" rel="noreferrer">{gist.description || gist.id}</a>
				</div>
			)}
			<ul className="files-list">
				{documents.map((document) => {
					const isEntry = entryIsEveryFile || document.id === entryDocumentId
					return (
						<li key={document.id} className={`files-item${document.id === activeDocumentId ? ' active' : ''}${shown.has(document.id) ? '' : ' hidden-file'}`}>
							<button
								className="files-name"
								onClick={() => selectDocument(document.id)}
								title={shown.has(document.id) ? `Show ${document.title}` : `${document.title} is off the tab bar; bring it back`}
							>
								<span className="files-marker" aria-hidden="true">{isEntry ? '▸' : ''}</span>
								{document.title}
								{document.dirty && <span className="files-dirty" title="Has changes not saved to disk"> ●</span>}
							</button>
							<button className="files-icon" onClick={() => report(saveDocument(document.id))} title={folder ? `Save ${document.title} to ${folder}` : `Download ${document.title}`} aria-label={`Save ${document.title}`}>💾</button>
							<button className="files-icon" onClick={() => remove(document.id)} title={`Remove ${document.title} from the project`} aria-label={`Remove ${document.title}`}><TrashIcon /></button>
						</li>
					)
				})}
			</ul>
			{message && <div className="files-message" role="status">{message}</div>}
		</div>
	)
}

export default FilesPanel
