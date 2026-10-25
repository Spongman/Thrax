import { useEffect } from 'react'
import type { Example } from '../architectures/contracts'
import { openPanel } from '../components/DockLayout'
import { useTHRAXStore } from '../store/thraxStore'

interface LoadExampleEvent extends Event {
	detail: Example
}

export function useExamples() {
	const loadExample = useTHRAXStore((state) => state.loadExample)
	const activation = useTHRAXStore((state) => state.exampleActivation)

	useEffect(() => {
		if (!activation) return
		const state = useTHRAXStore.getState()
		if (state.activeDocumentId !== activation.documentId || state.code !== activation.example.code) return
		if (activation.focus) state.selectDocument(activation.documentId)
		for (const id of activation.example.tools ?? []) openPanel(id)
	}, [activation])

	useEffect(() => {
		const handleLoadExample = (event: Event) => {
			const { detail } = event as LoadExampleEvent
			loadExample(detail)
		}

		window.addEventListener('load-example', handleLoadExample)
		return () => window.removeEventListener('load-example', handleLoadExample)
	}, [loadExample])
}
