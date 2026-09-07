/**
 * Publishing a workspace as a gist.
 *
 * GitHub's API answers a browser, but its sign-in flow does not, so the token
 * is one the user makes themselves (a fine-grained token with the gist scope)
 * and pastes in once.  It is kept in this browser and nowhere else.
 */

import { gistApiUrl, gitHubHeaders } from './remote'
import { isSourceName, type WorkspaceSnapshot } from './workspace'

const TOKEN_KEY = 'thrax-web.github.token'

export function readGitHubToken(): string | null {
	try {
		return window.localStorage.getItem(TOKEN_KEY)
	} catch {
		return null
	}
}

export function writeGitHubToken(token: string | null): void {
	try {
		if (token) window.localStorage.setItem(TOKEN_KEY, token)
		else window.localStorage.removeItem(TOKEN_KEY)
	} catch {
		// Storage can be blocked; the token is asked for again next time.
	}
}

/** Who the token belongs to. */
export interface Viewer {
	login: string
	name: string | null
	avatarUrl: string
	url: string
}

/**
 * Checks a token by asking whose it is.  A token GitHub does not know throws,
 * so signing in with a bad one fails at once rather than at the first save.
 */
export async function fetchViewer(token: string): Promise<Viewer> {
	const response = await fetch('https://api.github.com/user', { headers: gitHubHeaders(token) })
	if (response.status === 401) throw new Error('GitHub does not recognise that token')
	if (!response.ok) throw new Error(`GitHub refused: ${response.status} ${response.statusText}`)
	const user = await response.json() as { login: string, name: string | null, avatar_url: string, html_url: string }
	return { login: user.login, name: user.name, avatarUrl: user.avatar_url, url: user.html_url }
}

/** One of the viewer's gists, as the list shows it. */
export interface GistSummary {
	id: string
	description: string
	files: string[]
	/** Whether any file in it is something the assembler reads. */
	hasSource: boolean
	public: boolean
	updatedAt: string
	url: string
}

interface GistListEntry {
	id: string
	description: string | null
	files: Record<string, { filename: string }>
	public: boolean
	updated_at: string
	html_url: string
}

export function summariseGist(entry: GistListEntry): GistSummary {
	const files = Object.values(entry.files).map((file) => file.filename)
	return {
		id: entry.id,
		description: entry.description ?? '',
		files,
		hasSource: files.some(isSourceName),
		public: entry.public,
		updatedAt: entry.updated_at,
		url: entry.html_url,
	}
}

/** The viewer's gists, newest first; `page` counts from one. */
export async function listGists(token: string, page = 1, perPage = 30): Promise<GistSummary[]> {
	const response = await fetch(`https://api.github.com/gists?per_page=${perPage}&page=${page}`, { headers: gitHubHeaders(token) })
	if (!response.ok) throw new Error(`GitHub refused the gist list: ${response.status} ${response.statusText}`)
	return (await response.json() as GistListEntry[]).map(summariseGist)
}

export interface PublishedGist {
	id: string
	url: string
}

export async function deleteGist(token: string, id: string): Promise<void> {
	const response = await fetch(gistApiUrl(id), { method: 'DELETE', headers: gitHubHeaders(token) })
	if (!response.ok && response.status !== 404) throw new Error(`GitHub refused to delete the gist: ${response.status} ${response.statusText}`)
}

export interface GistBody {
	description: string
	public: boolean
	files: Record<string, { content: string }>
}

/** The body a gist is created or updated with: every file, by name. */
export function gistBody(snapshot: WorkspaceSnapshot, description: string): GistBody {
	const files: Record<string, { content: string }> = {}
	// A gist file cannot be empty, and cannot sit in a folder.
	for (const file of snapshot.files) files[file.title.replace(/\//g, '__')] = { content: file.code || '\n' }
	return { description, public: false, files }
}

/**
 * Creates a gist, or updates the one the workspace came from when the token
 * may write to it.  An update refused falls back to a new gist rather than
 * failing, since a link from someone else's gist is the common case.
 */
export async function publishGist(snapshot: WorkspaceSnapshot, token: string, description: string, existingId?: string): Promise<PublishedGist> {
	const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
	const body = JSON.stringify(gistBody(snapshot, description))
	if (existingId) {
		const updated = await fetch(gistApiUrl(existingId), { method: 'PATCH', headers, body })
		if (updated.ok) {
			const gist = await updated.json() as { id: string, html_url: string }
			return { id: gist.id, url: gist.html_url }
		}
		if (updated.status !== 403 && updated.status !== 404) throw new Error(`GitHub refused the update: ${updated.status} ${updated.statusText}`)
	}
	const created = await fetch('https://api.github.com/gists', { method: 'POST', headers, body })
	if (!created.ok) throw new Error(`GitHub refused the gist: ${created.status} ${created.statusText}`)
	const gist = await created.json() as { id: string, html_url: string }
	return { id: gist.id, url: gist.html_url }
}
