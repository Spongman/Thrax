/**
 * What the File menu, the toolbar and the file list do with a workspace: open
 * it from somewhere, save it somewhere, hand out a link to it.  Each returns
 * the one line the toolbar shows for it, so every caller reports the same way,
 * and throws when something outside the page refused.
 */

import { useTHRAXStore } from '../store/thraxStore'
import { zipWorkspace } from './archive'
import { downloadBlob, downloadText } from './download'
import { deleteGist, publishGist, readGitHubToken } from './github'
import { useGitHubSession, type BoundGist } from './githubSession'
import { connectedFolder, openFolder, pickFiles, readFiles, reconnectFolder, removeFromFolder, SOURCE_ACCEPT, writeToFolder } from './localFiles'
import { loadGist, loadWorkspaceFromUrl, type LoadedWorkspace } from './remote'
import { shareLink } from './share'
import { baseName, type WorkspaceSnapshot } from './workspace'

const store = () => useTHRAXStore.getState()

const fileCount = (count: number) => `${count} file${count === 1 ? '' : 's'}`

function replaceWith(loaded: LoadedWorkspace): string {
	const { snapshot } = loaded
	store().openFiles(snapshot.files, { replace: true, active: snapshot.active, assembleAll: snapshot.assembleAll })
	useGitHubSession.getState().setGist(loaded.origin.gist ?? null)
	return `Opened ${fileCount(snapshot.files.length)}`
}

/** Adds picked or dropped files to the project; an archive among them is opened up. */
export async function openDroppedFiles(files: readonly File[]): Promise<string | null> {
	const read = await readFiles(files)
	if (read.length === 0) return null
	store().openFiles(read)
	return `Opened ${fileCount(read.length)}`
}

export async function openFilesFromDisk(): Promise<string | null> {
	return openDroppedFiles(await pickFiles(SOURCE_ACCEPT))
}

function projectFromFolder(folder: { name: string, files: WorkspaceSnapshot['files'] } | null): string | null {
	if (!folder) return null
	if (folder.files.length === 0) {
		store().openFiles([{ title: 'main.asm', code: '' }], { replace: true, assembleAll: true })
	} else {
		store().openFiles(folder.files, { replace: true, assembleAll: folder.files.length > 1 })
	}
	useGitHubSession.getState().setGist(null)
	return `Opened folder ${folder.name}`
}

/** Makes a folder on this machine the project; null when the dialog was dismissed. */
export async function openFolderAsProject(): Promise<string | null> {
	return projectFromFolder(await openFolder())
}

export async function reconnectProjectFolder(): Promise<string | null> {
	return projectFromFolder(await reconnectFolder())
}

/**
 * Saves one file: into the connected folder, or as a download where there is
 * none.  Either way the file is then as saved as this page can make it.
 */
export async function saveDocument(documentId: string): Promise<string | null> {
	const { activeDocumentId, code, documents, markDocumentsSaved } = store()
	const document = documents.find((candidate) => candidate.id === documentId)
	if (!document) return null
	const text = document.id === activeDocumentId ? code : document.code
	const written = await writeToFolder(document.title, text)
	if (!written) downloadText(text, baseName(document.title))
	markDocumentsSaved([document.id])
	return written ? `Saved ${document.title} to ${connectedFolder()?.name}` : `Downloaded ${document.title}`
}

/** Saves every file into the connected folder, or the whole workspace as a zip without one. */
export async function saveAllDocuments(): Promise<string> {
	const folder = connectedFolder()
	if (!folder) return downloadWorkspaceZip()
	const snapshot = store().workspaceSnapshot()
	for (const file of snapshot.files) await writeToFolder(file.title, file.code)
	store().markDocumentsSaved(store().documents.map((document) => document.id))
	return `Saved ${fileCount(snapshot.files.length)} to ${folder.name}`
}

/** Takes a file out of the project, and out of the connected folder with it. */
export async function deleteDocumentEverywhere(documentId: string): Promise<void> {
	const document = store().documents.find((candidate) => candidate.id === documentId)
	if (!document) return
	await removeFromFolder(document.title)
	store().closeDocument(documentId)
}

/**
 * Empties the project down to one blank file.  Files on a connected folder are
 * left where they are: this clears the workspace, not the disk.
 */
export function clearProject(): string {
	store().openFiles([{ title: 'untitled.asm', code: '' }], { replace: true, assembleAll: false })
	useGitHubSession.getState().setGist(null)
	return connectedFolder() ? `Cleared the workspace; ${connectedFolder()!.name} is untouched` : 'Cleared the workspace'
}

/** The archive is named after the file in front, so two downloads tell apart. */
export function zipName(snapshot: WorkspaceSnapshot): string {
	const stem = (snapshot.active ?? snapshot.files[0]?.title ?? 'workspace').replace(/\.[^.]*$/, '')
	return `${baseName(stem, 'workspace')}.zip`
}

export function downloadWorkspaceZip(): string {
	const snapshot = store().workspaceSnapshot()
	downloadBlob(new Blob([zipWorkspace(snapshot) as BlobPart], { type: 'application/zip' }), zipName(snapshot))
	store().markDocumentsSaved(store().documents.map((document) => document.id))
	return `Downloaded ${zipName(snapshot)}`
}

/** Puts a link carrying the whole workspace on the clipboard. */
export async function copyShareLink(): Promise<string> {
	const link = shareLink(store().workspaceSnapshot())
	try {
		await navigator.clipboard.writeText(link)
		return `Copied a ${link.length.toLocaleString()}-character link to the clipboard`
	} catch {
		// The clipboard can be refused; the link is still worth having.
		window.prompt('Copy this link', link)
		return 'Share link shown'
	}
}

export async function openWorkspaceFromUrl(url: string): Promise<string> {
	return replaceWith(await loadWorkspaceFromUrl(url.trim(), readGitHubToken()))
}

/** Opens one of the viewer's gists, replacing the workspace. */
export async function openGist(id: string): Promise<string> {
	return replaceWith(await loadGist(id, readGitHubToken()))
}

/** The signed-in token, or an error saying to sign in first. */
function signedInToken(): string {
	const token = useGitHubSession.getState().token
	if (!token) throw new Error('Sign in to GitHub first')
	return token
}

async function saveGist(description: string, existing?: string): Promise<BoundGist> {
	const published = await publishGist(store().workspaceSnapshot(), signedInToken(), description, existing)
	const gist = { ...published, description }
	useGitHubSession.getState().setGist(gist)
	store().markDocumentsSaved(store().documents.map((document) => document.id))
	return gist
}

/** Writes the workspace back to the gist it is bound to. */
export async function saveToCurrentGist(): Promise<string> {
	const bound = useGitHubSession.getState().gist
	if (!bound) throw new Error('The workspace is not bound to a gist yet')
	const gist = await saveGist(bound.description, bound.id)
	return `Saved to gist ${gist.description || gist.id}`
}

/** Makes a new gist of the workspace and binds the workspace to it. */
export async function saveToNewGist(description: string): Promise<string> {
	const gist = await saveGist(description)
	return `Saved as a new gist: ${gist.url}`
}

/** Starts a blank workspace bound to a new gist. */
export async function newGistProject(description: string): Promise<string> {
	clearProject()
	const gist = await saveGist(description)
	return `Started gist ${gist.description || gist.id}`
}

/** Deletes the bound gist on GitHub; the files stay open, bound to nothing. */
export async function deleteCurrentGist(): Promise<string> {
	const bound = useGitHubSession.getState().gist
	if (!bound) throw new Error('The workspace is not bound to a gist')
	await deleteGist(signedInToken(), bound.id)
	useGitHubSession.getState().setGist(null)
	return `Deleted gist ${bound.description || bound.id}`
}

/** Opens what a share link or a `?load=` carries, replacing the workspace. */
export function openSnapshot(snapshot: WorkspaceSnapshot): string {
	return replaceWith({ snapshot, origin: {} })
}
