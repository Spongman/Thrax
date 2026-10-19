/** ARMv8-A settings, and how the settings dialog shows them. */

import { defineSettings } from '../../core/settings'
import { DEFAULT_MEMORY_BYTES, MEMORY_SIZES } from './a64/layout'

/** Execution states this target can run; AArch32 is to follow. */
export const EXECUTION_STATES: readonly { value: string, label: string }[] = [
	{ value: 'aarch64', label: 'AArch64 (A64)' },
]

export type Armv8Settings = {
	/** Which execution state assembles and runs programs. */
	executionState: string
	/** Bytes of memory from the start of the text. */
	memoryBytes: number
}

export const DEFAULT_ARMV8_SETTINGS: Armv8Settings = {
	executionState: 'aarch64',
	memoryBytes: DEFAULT_MEMORY_BYTES,
}

export const ARMV8_SETTINGS = defineSettings<Armv8Settings>({
	defaults: DEFAULT_ARMV8_SETTINGS,
	fields: [
		{
			key: 'executionState', group: 'Simulator', rebuild: true,
			control: { kind: 'choice', options: EXECUTION_STATES },
			isValid: (value) => EXECUTION_STATES.some((state) => state.value === value),
			label: 'Execution state',
			hint: 'The instruction set programs are written in and run as',
		},
		{
			key: 'memoryBytes', group: 'Simulator', rebuild: true,
			control: { kind: 'choice', options: MEMORY_SIZES },
			isValid: (value) => MEMORY_SIZES.some((size) => size.value === value),
			label: 'Memory size',
			hint: 'Code from 0x00400000, data from 0x00420000, the stack down from the top',
		},
	],
})
