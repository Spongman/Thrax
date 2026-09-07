import React from 'react'
import { listGists, type GistSummary } from '../services/github'
import { useGitHubSession } from '../services/githubSession'
import { openGist, saveToCurrentGist, saveToNewGist } from '../services/workspaceActions'
import { useTHRAXStore } from '../store/thraxStore'
import { useStoredState } from '../hooks/useStoredState'
import Modal from './Modal'
import './GitHubDialog.css'

interface GitHubDialogProps {
	onClose: () => void
	/** The one line the toolbar shows for what was done. */
	onReport: (message: string) => void
}

const TOKEN_PAGE = 'https://github.com/settings/tokens/new?scopes=gist&description=Thrax'
const PAGE_SIZE = 30

/**
 * Signing in to GitHub, and the gists that belong to whoever is signed in.
 *
 * GitHub's own sign-in cannot finish in a page served from nowhere in
 * particular (the token exchange refuses a browser on another origin), so
 * signing in is pasting a token once.  It is checked at once by asking whose
 * it is, kept in this browser, and forgotten from here.
 */
function GitHubDialog({ onClose, onReport }: GitHubDialogProps) {
	const activeTitle = useTHRAXStore((state) => state.documents.find((document) => document.id === state.activeDocumentId)?.title)
	const { token, viewer, checking, error: signInError, gist: bound, signIn, signOut } = useGitHubSession()
	const [draft, setDraft] = React.useState('')
	const [gists, setGists] = React.useState<GistSummary[] | null>(null)
	const [page, setPage] = React.useState(1)
	const [busy, setBusy] = React.useState(false)
	const [error, setError] = React.useState<string | null>(null)
	const [description, setDescription] = React.useState(() => activeTitle ? `Thrax: ${activeTitle}` : 'Thrax workspace')
	// Most of an account's gists are not programs; they are kept out of the way unless asked for.
	const [showAll, setShowAll] = useStoredState('github.showAllGists', false, (value) => typeof value === 'boolean')

	/** Runs a request against GitHub, showing its failure here rather than losing it. */
	const attempt = async (action: () => Promise<void>) => {
		setBusy(true)
		setError(null)
		try {
			await action()
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure))
		} finally {
			setBusy(false)
		}
	}

	// The list follows the sign-in: filled when someone is signed in, gone when they leave.
	React.useEffect(() => {
		if (!token) {
			setGists(null)
			return
		}
		let live = true
		void attempt(async () => {
			const first = await listGists(token, 1, PAGE_SIZE)
			if (!live) return
			setGists(first)
			setPage(1)
		})
		return () => { live = false }
	}, [token])

	const submitToken = (event: React.FormEvent) => {
		event.preventDefault()
		const pasted = draft.trim()
		if (!pasted) return
		setDraft('')
		void signIn(pasted)
	}

	const showPage = (next: number) => attempt(async () => {
		setGists(await listGists(token!, next, PAGE_SIZE))
		setPage(next)
	})

	const open = (gist: GistSummary) => attempt(async () => {
		onReport(await openGist(gist.id))
		onClose()
	})

	const publish = () => attempt(async () => {
		onReport(bound ? await saveToCurrentGist() : await saveToNewGist(description))
		setGists(await listGists(token!, 1, PAGE_SIZE))
		setPage(1)
	})

	const shown = gists?.filter((gist) => showAll || gist.hasSource) ?? null
	const hidden = (gists?.length ?? 0) - (shown?.length ?? 0)

	return (
		<Modal title="GitHub" onClose={onClose} className="github-dialog" movable persistKey="github">
			{!viewer && (
				<form className="github-sign-in" onSubmit={submitToken}>
					<p>
						Paste a personal access token with the <code>gist</code> scope. It is checked with GitHub,
						kept only in this browser, and forgotten when you sign out.
					</p>
					<a href={TOKEN_PAGE} target="_blank" rel="noreferrer">Make a token on GitHub</a>
					<div className="github-token-row">
						<input
							type="password"
							value={draft}
							onChange={(event) => setDraft(event.target.value)}
							placeholder="ghp_… or github_pat_…"
							aria-label="GitHub token"
							autoFocus
						/>
						<button type="submit" className="btn btn-primary" disabled={checking || !draft.trim()}>Sign in</button>
					</div>
				</form>
			)}

			{viewer && (
				<>
					<div className="github-viewer">
						<img src={viewer.avatarUrl} alt="" width={28} height={28} />
						<span>
							Signed in as <a href={viewer.url} target="_blank" rel="noreferrer">{viewer.login}</a>
							{viewer.name ? ` (${viewer.name})` : ''}
						</span>
						<button type="button" className="btn btn-secondary" onClick={signOut}>Sign out</button>
					</div>

					<div className="github-publish">
						{bound
							? <span className="github-bound">Bound to <a href={bound.url} target="_blank" rel="noreferrer">{bound.description || bound.id}</a></span>
							: (
								<input
									value={description}
									onChange={(event) => setDescription(event.target.value)}
									aria-label="Gist description"
								/>
							)}
						<button type="button" className="btn btn-primary" onClick={publish} disabled={busy} title={bound ? 'Writes every file back to the gist the workspace is bound to' : 'Creates a secret gist of every file'}>
							{bound ? 'Save to gist' : 'Publish gist'}
						</button>
					</div>

					<div className="github-gists-head">
						<span>Your gists</span>
						<button
							type="button"
							className={`btn btn-secondary github-filter${showAll ? '' : ' active'}`}
							aria-pressed={!showAll}
							onClick={() => setShowAll(!showAll)}
							title={showAll ? 'Hide gists with no .asm or .s file' : 'Show every gist, including those with nothing to assemble'}
						>
							{showAll ? 'Hide other gists' : `Show all${hidden ? ` (+${hidden})` : ''}`}
						</button>
						<span className="github-pager">
							<button type="button" className="btn btn-icon" onClick={() => showPage(page - 1)} disabled={busy || page === 1} aria-label="Newer gists">‹</button>
							<span>page {page}</span>
							<button type="button" className="btn btn-icon" onClick={() => showPage(page + 1)} disabled={busy || !gists || gists.length < PAGE_SIZE} aria-label="Older gists">›</button>
						</span>
					</div>
					<ul className="github-gists">
						{gists?.length === 0 && <li className="github-empty">No gists yet</li>}
						{gists && gists.length > 0 && shown?.length === 0 && <li className="github-empty">Nothing to assemble on this page; Show all lists the rest</li>}
						{shown?.map((gist) => (
							<li key={gist.id} className={`github-gist${gist.hasSource ? '' : ' no-source'}${gist.id === bound?.id ? ' bound' : ''}`}>
								<button type="button" className="github-gist-open" onClick={() => open(gist)} disabled={busy || !gist.hasSource} title={gist.hasSource ? 'Open in the workspace, replacing the files open now' : 'Holds no .asm or .s file'}>
									<span className="github-gist-title">{gist.description || gist.files[0] || gist.id}</span>
									<span className="github-gist-files">{gist.files.join(', ')}</span>
									<span className="github-gist-meta">{gist.public ? 'public' : 'secret'} · {new Date(gist.updatedAt).toLocaleDateString()}{gist.id === bound?.id ? ' · open now' : ''}</span>
								</button>
								<a className="github-gist-link" href={gist.url} target="_blank" rel="noreferrer" title="Open on GitHub">↗</a>
							</li>
						))}
					</ul>
				</>
			)}

			{(busy || checking) && <div className="github-status" role="status">Talking to GitHub…</div>}
			{(error ?? signInError) && <div className="github-error" role="alert">{error ?? signInError}</div>}
		</Modal>
	)
}

export default GitHubDialog
