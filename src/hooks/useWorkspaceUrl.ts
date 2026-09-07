import { useEffect } from 'react'
import { LOAD_PARAMETER } from '../services/remote'
import { workspaceFromFragment } from '../services/share'
import { openSnapshot, openWorkspaceFromUrl } from '../services/workspaceActions'
import { useTHRAXStore } from '../store/thraxStore'

/**
 * A link can carry a workspace (`#ws=...`) or point at one (`?load=<url>`).
 * Either replaces what is open, after asking when there is something to lose,
 * and the address bar is then cleaned so a reload does not ask again.
 */
export function useWorkspaceUrl(onError: (message: string) => void) {
	useEffect(() => {
		const shared = workspaceFromFragment(window.location.hash)
		const load = new URLSearchParams(window.location.search).get(LOAD_PARAMETER)
		if (!shared && !load) return
		const clean = () => window.history.replaceState(null, '', window.location.pathname)
		const { documents } = useTHRAXStore.getState()
		const hasWork = documents.some((document) => document.code.trim() !== '')
		if (hasWork && !window.confirm('Open the workspace this link carries? The files open now are replaced.')) {
			clean()
			return
		}
		if (shared) {
			openSnapshot(shared)
			clean()
			return
		}
		openWorkspaceFromUrl(load!)
			.catch((error: unknown) => onError(error instanceof Error ? error.message : String(error)))
			.finally(clean)
	// Runs once, for the URL the page was opened with.
	}, [])
}
