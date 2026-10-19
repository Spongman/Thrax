/** The 6502's options, and how the settings dialog shows them. */

import { defineSettings, isBoolean } from '../../core/settings'

export type Mos6502Settings = {
	/** ADC and SBC honour D; off models the NES 2A03, whose D does nothing. */
	decimalMode: boolean
}

export const DEFAULT_MOS6502_SETTINGS: Mos6502Settings = {
	decimalMode: true,
}

export const MOS6502_SETTINGS = defineSettings<Mos6502Settings>({
	defaults: DEFAULT_MOS6502_SETTINGS,
	fields: [
		{
			key: 'decimalMode', group: 'Simulator', control: { kind: 'check' }, isValid: isBoolean, rebuild: true,
			label: 'Decimal mode',
			hint: 'SED makes ADC and SBC work in BCD, as on the NMOS 6502; off, D is ignored, as on the NES 2A03',
		},
	],
})
