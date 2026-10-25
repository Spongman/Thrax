import { describe, expect, it } from 'vitest'
import type { MachineStopReason } from '../../architectures/contracts'
import { debugControls } from '../controlAvailability'

const idle = { hasMachine: true, isRunning: false, isPaused: false, halted: false, stopReason: null, historyCursor: 3 }

describe('shared debugger control availability', () => {
	it.each<MachineStopReason>([{ kind: 'halt' }, { kind: 'stop' }, { kind: 'fault', message: 'native fault', address: 12 }])('allows rewind after $kind regardless of the pause flag', stopReason => {
		const controls = debugControls({ ...idle, halted: true, stopReason })
		expect(controls.canStepBack).toBe(true)
		expect(controls.runAction).toBe('run')
		expect(controls.canStop).toBe(false)
		expect(debugControls({ ...idle, halted: true, isPaused: true, stopReason }).runAction).toBe('run')
	})

	it('does not offer rewind without a machine or retained past', () => {
		expect(debugControls({ ...idle, hasMachine: false }).canStepBack).toBe(false)
		expect(debugControls({ ...idle, historyCursor: 0 }).canStepBack).toBe(false)
	})

	it('offers Pause while running and prevents overlapping step controls', () => {
		expect(debugControls({ ...idle, isRunning: true })).toEqual({ runAction: 'pause', canStep: false, canStepBack: false, canStop: true })
	})

	it('offers Continue for resumable pauses and Run before execution', () => {
		expect(debugControls({ ...idle, isPaused: true }).runAction).toBe('continue')
		expect(debugControls({ ...idle, hasMachine: false, historyCursor: 0 })).toEqual({ runAction: 'run', canStep: true, canStepBack: false, canStop: false })
	})
})
