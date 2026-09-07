import React from 'react'
import { sourceSignature, useTHRAXStore } from './store/thraxStore'
import { useExamples } from './hooks/useExamples'
import { useWorkspaceUrl } from './hooks/useWorkspaceUrl'
import { openDroppedFiles } from './services/workspaceActions'
import Toolbar from './components/Toolbar'
import DockLayout from './components/DockLayout'
import { useHighlightTheme } from './components/highlight'
import './App.css'

function App() {
	const { refreshAssembly, run, reset } = useTHRAXStore()
	// Bug 12: watching the active file alone left an edit to an included file
	// out of the program until the active one was touched.
	const sources = useTHRAXStore((state) => sourceSignature(state.documents))
	const [error, setError] = React.useState<string | null>(null)

	useExamples()
	useHighlightTheme()
	useWorkspaceUrl(setError)

	// Files dropped anywhere on the workspace join the project.
	const handleDragOver = React.useCallback((event: React.DragEvent) => {
		if (event.dataTransfer.types.includes('Files')) event.preventDefault()
	}, [])
	const handleDrop = React.useCallback((event: React.DragEvent) => {
		if (event.dataTransfer.files.length === 0) return
		event.preventDefault()
		openDroppedFiles(Array.from(event.dataTransfer.files))
			.catch((error: unknown) => setError(error instanceof Error ? error.message : String(error)))
	}, [])

	// Keep the assembled program (and so the memory view) in step with the source.
	React.useEffect(() => {
		const handle = window.setTimeout(refreshAssembly, 300)
		return () => window.clearTimeout(handle)
	}, [sources, refreshAssembly])

	const handleRun = React.useCallback(async () => {
		setError(null)
		try {
			await run()
		} catch (error) {
			setError(error instanceof Error ? error.message : String(error))
		}
	}, [run])

	const handleReset = React.useCallback(() => {
		setError(null)
		reset()
	}, [reset])

	return (
		<div className="thrax-app" onDragOver={handleDragOver} onDrop={handleDrop}>
			<Toolbar onRun={handleRun} onReset={handleReset} />

			{error && (
				<div className="error-bar">
					<span className="error-icon">⚠️</span>
					<span>{error}</span>
					<button onClick={() => setError(null)}>×</button>
				</div>
			)}

			<div className="thrax-container">
				<DockLayout />
			</div>
		</div>
	)
}

export default App
