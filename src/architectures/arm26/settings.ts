/** The 26-bit machine's settings, and how the settings dialog shows them. */

import { defineSettings, isString } from '../../core/settings'
import { DIALECT_IDS, DIALECT_NAMES } from '../arm/assembler/dialect'
import type { Arm26Model } from './arm3'

export type Arm26Settings = {
	cpuModel?: Arm26Model
	sequentialCycles?: number
	latencyCycles?: number
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
	cpuModel: 'arm3',
	sequentialCycles: 1,
	latencyCycles: 1,
	memoryBytes: MB,
	dialect: 'gnu',
}

export const ARM26_SETTINGS = defineSettings<Arm26Settings>({
	defaults: DEFAULT_ARM26_SETTINGS,
	fields: [
		...(['sequentialCycles', 'latencyCycles'] as const).map((key) => ({
			key, group: 'Memory timing', rebuild: true,
			label: key === 'sequentialCycles' ? 'Sequential transfer (A)' : 'Memory latency (L)',
			hint: 'Reference-clock ticks; non-sequential transfers take L + A. ARM3 cache hits use one fast tick.',
			control: { kind: 'choice' as const, options: [1, 2, 3, 4, 8, 16, 32, 64].map((value) => ({ value, label: `${value} tick${value === 1 ? '' : 's'}` })) },
			isValid: (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 64,
		})),
		{
			key: 'cpuModel', group: 'CPU', rebuild: true, label: 'CPU model',
			control: { kind: 'choice', options: [{ value: 'arm2', label: 'ARM2' }, { value: 'arm3', label: 'ARM3 (4 KB cache and CP15)' }] },
			isValid: (value) => value === 'arm2' || value === 'arm3',
			hint: 'ARM3 adds SWP and privileged CP15 cache control; ARM2 rejects them',
		},
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
