import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/common/services/editorWebWorkerMain?worker'
import { loader } from '@monaco-editor/react'
import { connectEditor, initializeArchitecture } from './architectures/registry'
import { restoreGitHubSession } from './services/githubSession'
import { readTargetSettings, useTHRAXStore } from './store/thraxStore'

// Vite cannot bundle the core editor worker from Monaco's internal
// `new URL('...editorWebWorkerMain.js', import.meta.url)` reference, so supply it
// explicitly. Other labels return undefined and keep their own bundled worker.
self.MonacoEnvironment = {
	getWorker: (_workerId, label) =>
		label === 'editorWorkerService' ? new EditorWorker() : (undefined as unknown as Worker),
}

// Use the bundled Monaco instead of the CDN copy, so the editor and the MIPS
// language registration below share one instance.
loader.config({ monaco })

// A GitHub token kept from an earlier visit signs in again.
restoreGitHubSession()

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

const root = document.getElementById('root')

if (!root) throw new Error('Unable to find the application root')

async function start() {
	// The workspace reopens on the target it was saved for.
	await initializeArchitecture(useTHRAXStore.getState().architecture, readTargetSettings)
	// Every activation installs its language, go-to-definition and data tips.
	await connectEditor(monaco, {
		settings: () => useTHRAXStore.getState().targetSettings,
		files: () => useTHRAXStore.getState().workspaceSnapshot().files,
		active: () => useTHRAXStore.getState().workspaceSnapshot().active,
		open: (file, line) => useTHRAXStore.getState().focusSourceLine(file, line),
		inspection: () => {
			const { registers, memory, labels } = useTHRAXStore.getState()
			return { registers, memory, labels }
		},
	})

	ReactDOM.createRoot(root!).render(
		<React.StrictMode>
			<App />
		</React.StrictMode>,
	)
}

void start().catch((error: unknown) => {
	root.textContent = `Unable to initialize architecture: ${error instanceof Error ? error.message : String(error)}`
})
