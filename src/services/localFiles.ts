/**
 * The files on this machine: picked, dropped, or a whole folder.
 *
 * A file picker and a download work in every browser, and are how a file is
 * opened and saved by default.  Where the browser can hand over a folder
 * (Chromium), the folder becomes the project the way a directory is MARS's: its
 * sources are the files, and saving writes each back where it came from.  The
 * folder is remembered across reloads, though the browser asks again before it
 * is touched.
 */

import { isZipName, unzipFiles } from './archive'
import { isSourceName, type WorkspaceFile } from './workspace'

// The folder picker is not in the DOM typings this project compiles against.
interface DirectoryHandle extends FileSystemDirectoryHandle {
	values(): AsyncIterableIterator<FileSystemHandle>
	queryPermission(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
	requestPermission(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
}

type DirectoryPicker = (options?: { mode?: 'read' | 'readwrite' }) => Promise<DirectoryHandle>

export function supportsFolders(): boolean {
	return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

/** Lets the user pick files; resolves with none when the dialog is dismissed. */
export function pickFiles(accept: string, multiple = true): Promise<File[]> {
	return new Promise((resolve) => {
		const input = document.createElement('input')
		input.type = 'file'
		input.accept = accept
		input.multiple = multiple
		input.style.display = 'none'
		const finish = () => {
			resolve(Array.from(input.files ?? []))
			input.remove()
		}
		input.addEventListener('change', finish)
		input.addEventListener('cancel', finish)
		document.body.append(input)
		input.click()
	})
}

export const SOURCE_ACCEPT = '.asm,.s,.txt,.zip,.json'

/** Files as picked or dropped, with each archive among them opened up. */
export async function readFiles(files: readonly File[]): Promise<WorkspaceFile[]> {
	const read = await Promise.all(files.map(async (file): Promise<WorkspaceFile[]> =>
		isZipName(file.name)
			? unzipFiles(new Uint8Array(await file.arrayBuffer()))
			: [{ title: file.name, code: await file.text() }]))
	return read.flat()
}

// --- A folder as the project -------------------------------------------------

const DATABASE = 'thrax-web'
const STORE = 'handles'
const FOLDER_KEY = 'folder'

function openDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DATABASE, 1)
		request.onupgradeneeded = () => request.result.createObjectStore(STORE)
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error)
	})
}

async function withStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	const database = await openDatabase()
	return new Promise((resolve, reject) => {
		const request = action(database.transaction(STORE, mode).objectStore(STORE))
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error)
	})
}

/** The folder connected in this session; the handles live only in memory. */
let folder: DirectoryHandle | null = null

export function connectedFolder(): { name: string } | null {
	return folder ? { name: folder.name } : null
}

/** The folder remembered from an earlier session, if the browser still has it. */
export async function rememberedFolder(): Promise<{ name: string } | null> {
	if (!supportsFolders()) return null
	try {
		const handle = await withStore<DirectoryHandle | undefined>('readonly', (store) => store.get(FOLDER_KEY))
		return handle ? { name: handle.name } : null
	} catch {
		return null
	}
}

async function rememberFolder(handle: DirectoryHandle | null): Promise<void> {
	try {
		if (handle) await withStore('readwrite', (store) => store.put(handle, FOLDER_KEY))
		else await withStore('readwrite', (store) => store.delete(FOLDER_KEY))
	} catch {
		// Nothing remembered means the folder is picked again next time.
	}
}

/** The sources a folder holds, top level only, the way MARS reads a directory. */
async function readFolder(handle: DirectoryHandle): Promise<WorkspaceFile[]> {
	const files: WorkspaceFile[] = []
	for await (const entry of handle.values()) {
		if (entry.kind !== 'file' || !isSourceName(entry.name)) continue
		const file = await (entry as FileSystemFileHandle).getFile()
		files.push({ title: entry.name, code: await file.text() })
	}
	return files.sort((left, right) => left.title.localeCompare(right.title))
}

/** Asks for a folder and reads it; resolves null when the dialog is dismissed. */
export async function openFolder(): Promise<{ name: string, files: WorkspaceFile[] } | null> {
	const picker = (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker
	if (!picker) return null
	try {
		const handle = await picker({ mode: 'readwrite' })
		folder = handle
		await rememberFolder(handle)
		return { name: handle.name, files: await readFolder(handle) }
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') return null
		throw error
	}
}

/**
 * Reconnects the remembered folder.  Needs a click to happen in: the browser
 * only asks about a stored folder inside a user gesture.
 */
export async function reconnectFolder(): Promise<{ name: string, files: WorkspaceFile[] } | null> {
	let handle: DirectoryHandle | undefined
	try {
		handle = await withStore<DirectoryHandle | undefined>('readonly', (store) => store.get(FOLDER_KEY))
	} catch {
		return null
	}
	if (!handle) return null
	const permission = await handle.queryPermission({ mode: 'readwrite' }) === 'granted'
		? 'granted'
		: await handle.requestPermission({ mode: 'readwrite' })
	if (permission !== 'granted') return null
	folder = handle
	return { name: handle.name, files: await readFolder(handle) }
}

export async function disconnectFolder(): Promise<void> {
	folder = null
	await rememberFolder(null)
}

/** Writes one file into the connected folder; false when no folder is connected. */
export async function writeToFolder(title: string, code: string): Promise<boolean> {
	if (!folder) return false
	const handle = await folder.getFileHandle(title, { create: true })
	const writable = await handle.createWritable()
	await writable.write(code)
	await writable.close()
	return true
}

/** Removes a file from the connected folder; a file that is not there is no error. */
export async function removeFromFolder(title: string): Promise<boolean> {
	if (!folder) return false
	try {
		await folder.removeEntry(title)
	} catch (error) {
		if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error
	}
	return true
}
