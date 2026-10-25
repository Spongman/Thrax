/** The BSim options a program does not set itself, and how the settings dialog shows them. */

import { defineSettings, isBoolean } from '../../core/settings'
import { DEFAULT_MEMORY_BYTES } from './cpu'

export type BetaSettings = {
	/** Bytes of memory, from address 0. */
	memoryBytes: number
	/** Console I/O for a program with no `.options tty` or `notty` of its own. */
	tty: boolean
}

export const DEFAULT_BETA_SETTINGS: BetaSettings = {
	memoryBytes: DEFAULT_MEMORY_BYTES,
	// BSim's default is notty.
	tty: false,
}

const KB = 1 << 10
const MB = 1 << 20

export const BETA_MEMORY_SIZES: readonly { value: number, label: string }[] = [
	{ value: 64 * KB, label: '64 KB' },
	{ value: 256 * KB, label: '256 KB' },
	{ value: MB, label: '1 MB' },
	{ value: 4 * MB, label: '4 MB' },
	{ value: 16 * MB, label: '16 MB' },
]

export const BETA_SETTINGS = defineSettings<BetaSettings>({
	defaults: DEFAULT_BETA_SETTINGS,
	fields: [
		{
			key: 'memoryBytes', group: 'Memory', rebuild: true,
			control: { kind: 'choice', options: BETA_MEMORY_SIZES },
			isValid: (value) => BETA_MEMORY_SIZES.some((size) => size.value === value),
			label: 'Memory size',
			hint: 'One flat memory from address 0; a program has to fit in it',
		},
		{
			key: 'tty', group: 'Execution', control: { kind: 'check' }, isValid: isBoolean, rebuild: true,
			label: 'Console I/O unless the program says .options notty',
			hint: 'Lets RDCHAR and WRCHAR run in a program that names neither tty nor notty',
		},
	],
})
