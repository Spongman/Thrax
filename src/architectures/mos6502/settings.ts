/** The 6502's options, and how the settings dialog shows them. */

import { variantSetting } from '../../core/variants'
import { MOS6502_VARIANTS } from './variants'
import { defineSettings, isBoolean } from '../../core/settings'

export type Mos6502Settings = {
	cpuModel?: 'nmos6502' | 'w65c02' | 'w65816'
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
		variantSetting('cpuModel', MOS6502_VARIANTS),
		{
			key: 'decimalMode', group: 'Execution', control: { kind: 'check' }, isValid: isBoolean, rebuild: true,
			visibleWhen: settings => settings.cpuModel !== 'w65816',
			label: 'Decimal mode',
			hint: 'SED enables BCD arithmetic with flags matching the selected CPU model; off, D is ignored, as on the NES 2A03',
		},
	],
})
