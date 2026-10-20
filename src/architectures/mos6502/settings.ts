/** The 6502's options, and how the settings dialog shows them. */

import { defineSettings, isBoolean } from '../../core/settings'

export type Mos6502Settings = {
	cpuModel?: 'nmos6502' | 'w65c02'
	/** ADC and SBC honour D; off models the NES 2A03, whose D does nothing. */
	decimalMode: boolean
}

export const DEFAULT_MOS6502_SETTINGS: Mos6502Settings = {
	cpuModel: 'nmos6502',
	decimalMode: true,
}

export const MOS6502_SETTINGS = defineSettings<Mos6502Settings>({
	defaults: DEFAULT_MOS6502_SETTINGS,
	fields: [
		{
			key: 'cpuModel', group: 'CPU', label: 'CPU model', rebuild: true,
			isValid: (value) => value === 'nmos6502' || value === 'w65c02',
			control: {
				kind: 'choice',
				options: [
					{ value: 'nmos6502', label: 'MOS 6502 (NMOS)' },
					{ value: 'w65c02', label: 'WDC W65C02S (CMOS)' },
				],
			},
		},
		{
			key: 'decimalMode', group: 'Simulator', control: { kind: 'check' }, isValid: isBoolean, rebuild: true,
			label: 'Decimal mode',
			hint: 'SED enables BCD arithmetic with flags matching the selected CPU model; off, D is ignored, as on the NES 2A03',
		},
	],
})
