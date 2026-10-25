import type { MachineStopReason } from '../architectures/contracts'

interface ControlState {
	hasMachine: boolean
	isRunning: boolean
	isPaused: boolean
	halted: boolean
	stopReason: MachineStopReason | null
	historyCursor: number
}

/** Toolbar, shortcuts and commands use the same workbench rules for every CPU. */
export function debugControls(state: ControlState) {
	return {
		runAction: state.isRunning ? 'pause' : state.isPaused && !state.stopReason ? 'continue' : 'run',
		canStop: state.hasMachine && !state.halted,
		canStep: !state.isRunning,
		canStepBack: state.hasMachine && !state.isRunning && state.historyCursor > 0,
	} as const
}
