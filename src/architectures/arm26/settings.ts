/** The 26-bit machine's settings, and how the settings dialog shows them. */

import { defineSettings, isString } from '../../core/settings'
import { DIALECT_IDS, DIALECT_NAMES } from '../arm/assembler/dialect'

export type Arm26Settings = {
	/** Bytes of RAM, from address 0. */
	memoryBytes: number
	/** The dialect of a file its name and content leave open, as `gnu` or `armasm`. */
	dialect: string
}

const KB = 1 << 10
const MB = 1 << 20

export const ARM26_MEMORY_SIZES: readonly { value: number, label: string }[] = [
	{ value: 512 * KB, label: '512 KB' },
	{ value: MB, label: '1 MB' },
	{ value: 2 * MB, label: '2 MB' },
	{ value: 4 * MB, label: '4 MB' },
	{ value: 16 * MB, label: '16 MB' },
]

export const DEFAULT_ARM26_SETTINGS: Arm26Settings = {
	memoryBytes: MB,
	dialect: 'gnu',
}

export const ARM26_SETTINGS = defineSettings<Arm26Settings>({
	defaults: DEFAULT_ARM26_SETTINGS,
	fields: [
		{
			key: 'memoryBytes', group: 'Simulator', rebuild: true,
			control: { kind: 'choice', options: ARM26_MEMORY_SIZES },
			isValid: (value) => ARM26_MEMORY_SIZES.some((size) => size.value === value),
			label: 'Memory size',
			hint: 'RAM from address 0; the user stack starts at its top',
		},
		{
			key: 'dialect', group: 'Assembler', rebuild: true,
			control: { kind: 'choice', options: DIALECT_IDS.map((id, index) => ({ value: id, label: DIALECT_NAMES[index] })) },
			isValid: (value) => isString(value) && DIALECT_IDS.includes(value),
			label: 'Dialect of new and .asm files',
			hint: '.s and .S files are always GNU as and .armasm files armasm; a file with AREA, or with GNU directives, says which it is',
		},
	],
})
