import { useEffect } from 'react'
import type { Example } from '../architectures/contracts'
import { openPanel } from '../components/DockLayout'
import { useTHRAXStore } from '../store/thraxStore'

interface LoadExampleEvent extends Event {
	detail: Example
}

export function useExamples() {
	const loadExample = useTHRAXStore((state) => state.loadExample)

	useEffect(() => {
		const handleLoadExample = (event: Event) => {
			const { detail } = event as LoadExampleEvent
			loadExample(detail)
			const state = useTHRAXStore.getState()
			state.selectDocument(state.activeDocumentId)
			for (const id of detail.tools ?? []) openPanel(id)
		}

		window.addEventListener('load-example', handleLoadExample)
		return () => window.removeEventListener('load-example', handleLoadExample)
	}, [loadExample])
}
