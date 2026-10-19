/**
 * The workspace as a document: the files, which one is in front, and whether
 * they assemble together.  One shape serves everything that carries a workspace
 * out of the session and back: browser storage, a `.zip`, a share link, a gist.
 *
 * Ids are not carried.  They are unique for the life of a session and mean
 * nothing outside it, so a workspace read back gets fresh ones.
 */

import { architectureManifests } from '../architectures/registry'

export interface WorkspaceFile {
	title: string
	code: string
}

export interface WorkspaceSnapshot {
	files: WorkspaceFile[]
	/** Title of the file in front, when the snapshot remembers one. */
	active?: string
	assembleAll: boolean
	/** Target architecture id; kept as read, even when it is not a known one. */
	architecture: string
}

/** What a workspace saved before architectures existed targets. */
export const DEFAULT_ARCHITECTURE = 'mips'

export const WORKSPACE_FORMAT = 'thrax-workspace'
export const WORKSPACE_VERSION = 1

/** How a workspace is written out as JSON. */
export interface WorkspaceDocument {
	format: typeof WORKSPACE_FORMAT
	version: number
	savedAt?: string
	active?: string
	assembleAll: boolean
	/** Absent in documents saved before architectures existed. */
	architecture?: string
	files: WorkspaceFile[]
}

/** Extensions every architecture reads. */
export const SOURCE_EXTENSIONS = ['.asm', '.s']

/** File names some architecture assembles; anything else in a folder or archive is left alone. */
export function isSourceName(name: string): boolean {
	const lower = name.toLowerCase()
	const extensions = [...SOURCE_EXTENSIONS, ...architectureManifests().flatMap((manifest) => manifest.fileExtensions ?? [])]
	return extensions.some((extension) => lower.endsWith(extension))
}

/** The extension a new file takes under an architecture. */
export function newFileExtension(definition?: { fileExtensions?: readonly string[] }): string {
	return definition?.fileExtensions?.[0] ?? '.asm'
}

/** The last segment of a path or URL, or `fallback` when there is none. */
export function baseName(path: string, fallback = 'main.asm'): string {
	const name = path.split(/[/\\]/).filter(Boolean).pop() ?? ''
	return name || fallback
}

export function toWorkspaceDocument(snapshot: WorkspaceSnapshot): WorkspaceDocument {
	return {
		format: WORKSPACE_FORMAT,
		version: WORKSPACE_VERSION,
		savedAt: new Date().toISOString(),
		active: snapshot.active,
		assembleAll: snapshot.assembleAll,
		architecture: snapshot.architecture,
		files: snapshot.files.map(({ title, code }) => ({ title, code })),
	}
}

function isWorkspaceFile(value: unknown): value is WorkspaceFile {
	return typeof value === 'object' && value !== null &&
		typeof (value as WorkspaceFile).title === 'string' &&
		typeof (value as WorkspaceFile).code === 'string'
}

/** A snapshot from parsed JSON, or null when it is not a workspace document. */
export function fromWorkspaceDocument(value: unknown): WorkspaceSnapshot | null {
	if (typeof value !== 'object' || value === null) return null
	const document = value as Partial<WorkspaceDocument>
	if (document.format !== WORKSPACE_FORMAT || !Array.isArray(document.files) || !document.files.every(isWorkspaceFile)) return null
	if (document.files.length === 0) return null
	const active = typeof document.active === 'string' && document.files.some((file) => file.title === document.active)
		? document.active
		: undefined
	const architecture = typeof document.architecture === 'string' && document.architecture ? document.architecture : DEFAULT_ARCHITECTURE
	return { files: document.files.map(({ title, code }) => ({ title, code })), active, assembleAll: document.assembleAll === true, architecture }
}

/**
 * Files taken from a folder or an archive, as one workspace.  Everything the
 * assembler reads is kept; a lone workspace document among them names the
 * active file and the multi-file setting.  Nothing that can be read as a
 * workspace leaves the result empty: an archive of other text is still opened,
 * file by file.
 */
export function workspaceFromFiles(files: readonly WorkspaceFile[]): WorkspaceSnapshot | null {
	const manifest = files.find((file) => baseName(file.title) === WORKSPACE_MANIFEST)
	if (manifest) {
		try {
			const parsed = fromWorkspaceDocument(JSON.parse(manifest.code))
			if (parsed) return parsed
		} catch {
			// Not a workspace document after all; the files stand on their own.
		}
	}
	const sources = files.filter((file) => isSourceName(file.title))
	const kept = sources.length > 0 ? sources : files.filter((file) => file !== manifest)
	if (kept.length === 0) return null
	return { files: kept, assembleAll: kept.length > 1, architecture: DEFAULT_ARCHITECTURE }
}

/** The file inside an archive that says which file was in front. */
export const WORKSPACE_MANIFEST = 'thrax-workspace.json'
