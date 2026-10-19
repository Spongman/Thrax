/** The MARS-specific dock panels, fetched when one is first opened. */

import MipsXrayView from './components/MipsXrayView'
import MarsBotView from './components/MarsBotView'
import ScavengerHuntView from './components/ScavengerHuntView'
import DigitalLabView from './components/DigitalLabView'
import { useTHRAXStore } from '../../store/thraxStore'
import type { DigitalLabSim, DigitalLabState } from './tools/digitalLab'
import type { MarsBotSnapshot } from './tools/marsBot'
import type { ScavengerHuntSnapshot } from './tools/scavengerHunt'

/** A contributed tool's snapshot lands in the store under its key. */
function useToolView<View>(key: string) {
	return useTHRAXStore((state) => (state as unknown as Record<string, View>)[key])
}

export function XrayPanel() {
	const memory = useTHRAXStore((state) => state.memory)
	const pc = useTHRAXStore((state) => state.pc)
	return <div className="dock-panel"><MipsXrayView memory={memory} pc={pc} /></div>
}

export function MarsBotPanel() {
	const marsBot = useToolView<MarsBotSnapshot>('marsBot')
	return <div className="dock-panel"><MarsBotView marsBot={marsBot} /></div>
}

export function DigitalLabPanel() {
	const digitalLab = useToolView<DigitalLabState>('digitalLab')
	const driveTool = useTHRAXStore((state) => state.driveTool)
	const pressKey = (key: number | null) => driveTool('digitalLab', (tool) => { (tool as DigitalLabSim).pressKey(key) })
	return <div className="dock-panel"><DigitalLabView state={digitalLab} onPressKey={pressKey} /></div>
}

export function ScavengerHuntPanel() {
	const scavengerHunt = useToolView<ScavengerHuntSnapshot>('scavengerHunt')
	return <div className="dock-panel"><ScavengerHuntView scavengerHunt={scavengerHunt} /></div>
}
