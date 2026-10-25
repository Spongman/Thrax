import { variantSetting } from '../../core/variants'
import { M68K_VARIANTS } from './variants'
import { defineSettings } from '../../core/settings'
import type { Coprocessor } from './fpuIsa'

export type CpuModel = '68000' | '68010' | '68020'
export type M68kSettings = { cpuModel: CpuModel; coprocessor: Coprocessor }
export const DEFAULT_SETTINGS: M68kSettings = { cpuModel: '68000', coprocessor: 'none' }
// The 68020 coprocessor interface talks to a 68881/68882 directly; a 68000 or 68010
// could only drive one as a memory-mapped peripheral, without F-line instructions.
const withInterface = (settings: Record<string, unknown>) => settings.cpuModel === '68020'
export const coprocessorsFor = (model: CpuModel): Coprocessor[] => (model === '68020' ? ['none', '68881', '68882'] : ['none'])
/** A coprocessor the selected CPU cannot take falls back to none. */
export const effectiveCoprocessor = (settings: Partial<M68kSettings>): Coprocessor =>
	coprocessorsFor(settings.cpuModel ?? '68000').includes(settings.coprocessor ?? 'none') ? (settings.coprocessor ?? 'none') : 'none'
export const M68K_SETTINGS = defineSettings<M68kSettings>({
	defaults: DEFAULT_SETTINGS,
	fields: [
		variantSetting('cpuModel', M68K_VARIANTS, 'Integer teaching profile; later models add RTD/BKPT, then long branches, EXTB and scaled brief indexing'),
		{
			key: 'coprocessor',
			group: 'CPU',
			role: 'variant',
			label: 'Math coprocessor',
			hint: 'MC68020 only. The MC68882 runs the same instructions here; its concurrency and speed are not modelled.',
			rebuild: true,
			visibleWhen: withInterface,
			control: {
				kind: 'choice',
				options: [
					{ value: 'none', label: 'None' },
					{ value: '68881', label: 'MC68881', when: withInterface },
					{ value: '68882', label: 'MC68882', when: withInterface }
				]
			},
			isValid: (value: unknown) => value === 'none' || value === '68881' || value === '68882'
		}
	]
})
