/** ARM variant settings, and how the settings dialog shows them. */

import { variantSetting } from '../../core/variants'
import { ARM_VARIANTS } from './variants'
import { defineSettings, type SettingField } from '../../core/settings'
import { DEFAULT_MEMORY_BYTES, MEMORY_SIZES } from './a64/layout'
import { ARM26_SETTINGS, ARM26_MEMORY_SIZES } from './arm26/settings'

/** Execution states this target can run. */
export const EXECUTION_STATES = ARM_VARIANTS.options

export type Armv8Settings = {
	/** Which execution state assembles and runs programs. */
	executionState: string
	/** Bytes of memory from the start of the text. */
	memoryBytes: number
	/** Scalar FP (A64) and VFPv4-D16 (A32); off makes them undefined. */
	floatingPoint?: boolean
	dialect?: string
	sequentialCycles?: number
	latencyCycles?: number
}
const is26Bit = (settings: Record<string, unknown>) => settings.executionState === 'arm2' || settings.executionState === 'arm3'
/** The states with an FPU: A64 and A32. */
export const hasFloatingPoint = (settings: Record<string, unknown>) => settings.executionState === 'aarch64' || settings.executionState === 'aarch32'
/** Whether FP is on for `settings`; on unless switched off. */
export const floatingPointEnabled = (settings: Record<string, unknown>) => hasFloatingPoint(settings) && settings.floatingPoint !== false
const memorySizes = [...new Map([...ARM26_MEMORY_SIZES, ...MEMORY_SIZES].map(option => [option.value, option])).values()]

export const DEFAULT_ARMV8_SETTINGS: Armv8Settings = {
	executionState: 'aarch64',
	memoryBytes: DEFAULT_MEMORY_BYTES,
	floatingPoint: true,
	dialect: 'gnu', sequentialCycles: 1, latencyCycles: 1,
}

export const ARMV8_SETTINGS = defineSettings<Armv8Settings>({
	defaults: DEFAULT_ARMV8_SETTINGS,
	fields: [
		variantSetting('executionState', ARM_VARIANTS, 'A64 (scalar FP), A32 (VFPv4-D16), Cortex-M0 Thumb, ARM2 or ARM3; no NEON'),
		{
			key: 'floatingPoint', group: 'CPU', rebuild: true, visibleWhen: hasFloatingPoint,
			control: { kind: 'check' }, isValid: (value) => typeof value === 'boolean',
			label: 'Floating point',
			hint: 'A64 scalar FP (S/D in V0-V31, FPCR, FPSR) or A32 VFPv4-D16 (S0-S31, D0-D15, FPSCR); off, FP instructions are undefined',
		},
		{
			key: 'memoryBytes', group: 'Memory', rebuild: true,
			control: { kind: 'choice', options: memorySizes },
			isValid: (value) => memorySizes.some((size) => size.value === value),
			label: 'Memory size',
			hint: 'RAM size for the selected CPU: ARM2/ARM3 map from zero; other states use their native teaching/Linux layout',
		},
		...ARM26_SETTINGS.fields.filter(field => !['cpuModel', 'memoryBytes'].includes(field.key)).map(field => ({ ...field, visibleWhen: is26Bit }) as SettingField<Armv8Settings>),
	],
})
