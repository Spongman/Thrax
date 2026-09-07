/**
 * Who is signed in to GitHub, and which gist the workspace is bound to.
 *
 * One store rather than state in the dialog, because the file list acts on the
 * same sign-in: its gist buttons appear when someone is signed in and act on
 * the gist the workspace came from or was last saved to.
 */

import { create } from 'zustand'
import { fetchViewer, readGitHubToken, writeGitHubToken, type Viewer } from './github'

/** The gist the workspace is bound to: saving goes back to it. */
export interface BoundGist {
	id: string
	url: string
	description: string
}

interface GitHubSession {
	token: string | null
	viewer: Viewer | null
	/** A sign-in is being checked with GitHub. */
	checking: boolean
	error: string | null
	gist: BoundGist | null
	/** Checks the token with GitHub and keeps it when GitHub knows it. */
	signIn: (token: string) => Promise<boolean>
	signOut: () => void
	setGist: (gist: BoundGist | null) => void
}

export const useGitHubSession = create<GitHubSession>((set) => ({
	token: null,
	viewer: null,
	checking: false,
	error: null,
	gist: null,

	signIn: async (token) => {
		set({ checking: true, error: null })
		try {
			const viewer = await fetchViewer(token)
			writeGitHubToken(token)
			set({ token, viewer, checking: false })
			return true
		} catch (failure) {
			// A token GitHub no longer knows is not worth keeping.
			if (failure instanceof Error && failure.message.includes('recognise')) writeGitHubToken(null)
			set({ token: null, viewer: null, checking: false, error: failure instanceof Error ? failure.message : String(failure) })
			return false
		}
	},

	signOut: () => {
		writeGitHubToken(null)
		set({ token: null, viewer: null, error: null })
	},

	setGist: (gist) => set({ gist }),
}))

/** A token kept from an earlier visit signs in again by itself. */
export function restoreGitHubSession(): void {
	const token = readGitHubToken()
	if (token) void useGitHubSession.getState().signIn(token)
}
