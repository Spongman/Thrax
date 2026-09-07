/**
 * A workspace in a link.  The files are compressed and written into the URL
 * fragment, so the link carries the whole project and no server holds a copy.
 * A few kilobytes of source fits in well under the length any browser allows.
 */

import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate'
import { fromWorkspaceDocument, toWorkspaceDocument, type WorkspaceSnapshot } from './workspace'

export const SHARE_PARAMETER = 'ws'

function toBase64Url(bytes: Uint8Array): string {
	let binary = ''
	for (let index = 0; index < bytes.length; index += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
	const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4)
	return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
}

export function encodeWorkspace(snapshot: WorkspaceSnapshot): string {
	// Two links to the same workspace should read the same, so the timestamp stays out.
	const { savedAt: _savedAt, ...document } = toWorkspaceDocument(snapshot)
	return toBase64Url(deflateSync(strToU8(JSON.stringify(document)), { level: 9 }))
}

export function decodeWorkspace(encoded: string): WorkspaceSnapshot | null {
	try {
		return fromWorkspaceDocument(JSON.parse(strFromU8(inflateSync(fromBase64Url(encoded)))))
	} catch {
		return null
	}
}

/** The fragment a share link carries: `#ws=...`. */
export function shareFragment(snapshot: WorkspaceSnapshot): string {
	return `#${SHARE_PARAMETER}=${encodeWorkspace(snapshot)}`
}

/** A link to this page that opens with the given workspace. */
export function shareLink(snapshot: WorkspaceSnapshot, location: { origin: string, pathname: string } = window.location): string {
	return `${location.origin}${location.pathname}${shareFragment(snapshot)}`
}

/** The workspace a fragment carries, or null when it carries none. */
export function workspaceFromFragment(hash: string): WorkspaceSnapshot | null {
	const encoded = new URLSearchParams(hash.replace(/^#/, '')).get(SHARE_PARAMETER)
	return encoded ? decodeWorkspace(encoded) : null
}
