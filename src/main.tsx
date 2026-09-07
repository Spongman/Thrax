import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/common/services/editorWebWorkerMain?worker'
import { loader } from '@monaco-editor/react'
import { registerMipsLanguage } from './core/mipsLanguage'
import { restoreGitHubSession } from './services/githubSession'

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

// Register MIPS language on app load
registerMipsLanguage()

// A GitHub token kept from an earlier visit signs in again.
restoreGitHubSession()

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

const root = document.getElementById('root')

if (!root) throw new Error('Unable to find the application root')

ReactDOM.createRoot(root).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
)
