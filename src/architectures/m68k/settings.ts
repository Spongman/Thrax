import { defineSettings } from '../../core/settings'

export type CpuModel = '68000' | '68010' | '68020'
export type M68kSettings = { cpuModel: CpuModel }
export const DEFAULT_SETTINGS: M68kSettings = { cpuModel: '68000' }
export const M68K_SETTINGS = defineSettings<M68kSettings>({
	defaults: DEFAULT_SETTINGS,
	fields: [
		{
			key: 'cpuModel',
			group: 'Simulator',
			rebuild: true,
			control: {
				kind: 'choice',
				options: ['68000', '68010', '68020'].map((value) => ({ value, label: `MC${value}` }))
			},
			isValid: (value) => typeof value === 'string' && ['68000', '68010', '68020'].includes(value),
			label: 'CPU model',
			hint: 'Integer teaching profile; later models add RTD/BKPT, then long branches, EXTB and scaled brief indexing'
		}
	]
})
