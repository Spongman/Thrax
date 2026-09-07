/**
 * Opening a workspace from a URL: `?load=<url>`.
 *
 * GitHub's raw files, gists and the contents API all answer a browser on
 * another origin, so a page, a gist or a folder in a repository can be opened
 * without anyone signing in.  Anything else is fetched as it is: a zip, a
 * workspace document, or one source file.
 */

import { isZipName, looksLikeZip, unzipFiles } from './archive'
import { baseName, fromWorkspaceDocument, isSourceName, workspaceFromFiles, type WorkspaceFile, type WorkspaceSnapshot } from './workspace'

export const LOAD_PARAMETER = 'load'

/** Where a workspace came from, for putting it back there. */
export interface WorkspaceOrigin {
	gist?: { id: string, url: string, description: string }
}

export interface LoadedWorkspace {
	snapshot: WorkspaceSnapshot
	origin: WorkspaceOrigin
}

/** One of the ways a GitHub URL names some files. */
export type GitHubTarget =
	| { kind: 'gist', id: string }
	| { kind: 'blob', owner: string, repo: string, ref: string, path: string }
	| { kind: 'tree', owner: string, repo: string, ref: string, path: string }

export function parseGitHubUrl(text: string): GitHubTarget | null {
	let url: URL
	try {
		url = new URL(text)
	} catch {
		return null
	}
	const segments = url.pathname.split('/').filter(Boolean)
	if (url.hostname === 'gist.github.com') {
		const id = segments[segments.length - 1]
		return id ? { kind: 'gist', id } : null
	}
	if (url.hostname !== 'github.com' || segments.length < 2) return null
	const [owner, repo, mode, ref, ...rest] = segments
	if (mode === undefined) return { kind: 'tree', owner, repo, ref: 'HEAD', path: '' }
	if ((mode !== 'blob' && mode !== 'tree') || !ref) return null
	return { kind: mode, owner, repo, ref, path: rest.join('/') }
}

export function rawGitHubUrl(target: Extract<GitHubTarget, { kind: 'blob' }>): string {
	return `https://raw.githubusercontent.com/${target.owner}/${target.repo}/${target.ref}/${target.path}`
}

export function gitHubContentsUrl(target: Extract<GitHubTarget, { kind: 'tree' }>): string {
	const ref = target.ref === 'HEAD' ? '' : `?ref=${encodeURIComponent(target.ref)}`
	return `https://api.github.com/repos/${target.owner}/${target.repo}/contents/${target.path}${ref}`
}

export function gistApiUrl(id: string): string {
	return `https://api.github.com/gists/${id}`
}

const GITHUB_HEADERS = { Accept: 'application/vnd.github+json' }

/** GitHub's headers, signed when a token is at hand so private gists answer too. */
export function gitHubHeaders(token?: string | null): Record<string, string> {
	return token ? { ...GITHUB_HEADERS, Authorization: `Bearer ${token}` } : { ...GITHUB_HEADERS }
}

async function fetchOk(url: string, init?: RequestInit): Promise<Response> {
	const response = await fetch(url, init)
	if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`)
	return response
}

interface GistFile { filename: string, content?: string, truncated?: boolean, raw_url: string }
interface GistDetail { id: string, html_url: string, description: string | null, files: Record<string, GistFile> }

export async function loadGist(id: string, token?: string | null): Promise<LoadedWorkspace> {
	const gist = await (await fetchOk(gistApiUrl(id), { headers: gitHubHeaders(token) })).json() as GistDetail
	const files = await Promise.all(Object.values(gist.files).map(async (file): Promise<WorkspaceFile> => ({
		title: file.filename,
		// The API carries a file whole only up to a limit; past it, the raw copy has the rest.
		code: file.truncated || file.content === undefined ? await (await fetchOk(file.raw_url)).text() : file.content,
	})))
	const snapshot = workspaceFromFiles(files)
	if (!snapshot) throw new Error('The gist holds no source files')
	return { snapshot, origin: { gist: { id: gist.id, url: gist.html_url, description: gist.description ?? '' } } }
}

interface ContentsEntry { type: string, name: string, download_url: string | null }

async function loadTree(target: Extract<GitHubTarget, { kind: 'tree' }>): Promise<LoadedWorkspace> {
	const listing = await (await fetchOk(gitHubContentsUrl(target), { headers: GITHUB_HEADERS })).json() as ContentsEntry[]
	const sources = listing.filter((entry) => entry.type === 'file' && entry.download_url && isSourceName(entry.name))
	const files = await Promise.all(sources.map(async (entry): Promise<WorkspaceFile> => ({
		title: entry.name,
		code: await (await fetchOk(entry.download_url!)).text(),
	})))
	const snapshot = workspaceFromFiles(files)
	if (!snapshot) throw new Error('The folder holds no source files')
	return { snapshot, origin: {} }
}

/** Whatever one URL serves: an archive, a workspace document, or a source file. */
async function loadFile(url: string): Promise<LoadedWorkspace> {
	const response = await fetchOk(url)
	const bytes = new Uint8Array(await response.arrayBuffer())
	const type = response.headers.get('content-type') ?? ''
	if (isZipName(new URL(url).pathname) || type.includes('zip') || looksLikeZip(bytes)) {
		const snapshot = workspaceFromFiles(unzipFiles(bytes))
		if (!snapshot) throw new Error('The archive holds no source files')
		return { snapshot, origin: {} }
	}
	const text = new TextDecoder().decode(bytes)
	if (text.trimStart().startsWith('{')) {
		try {
			const snapshot = fromWorkspaceDocument(JSON.parse(text))
			if (snapshot) return { snapshot, origin: {} }
		} catch {
			// Not a workspace document; it is opened as the one file it is.
		}
	}
	return { snapshot: { files: [{ title: baseName(new URL(url).pathname), code: text }], assembleAll: false }, origin: {} }
}

export async function loadWorkspaceFromUrl(text: string, token?: string | null): Promise<LoadedWorkspace> {
	const url = new URL(text)
	if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only http and https links can be opened')
	const target = parseGitHubUrl(text)
	if (target?.kind === 'gist') return loadGist(target.id, token)
	if (target?.kind === 'tree') return loadTree(target)
	if (target?.kind === 'blob') return loadFile(rawGitHubUrl(target))
	return loadFile(text)
}
