import { variantCatalog } from '../../core/variants'
import { MOS6502_LANGUAGE_ID } from './editor/grammar'
import { CMOS_EXAMPLES, EXAMPLES } from './examples'
import { MOS6502_REGISTERS } from './registers'
import { NMOS_MODEL, W65C02_MODEL } from './isa'
import { view as w65816View } from './w65816/metadata'

const banks = [{ id: 'cpu', label: 'Registers' }]

export const BASE6502_VARIANTS = variantCatalog('nmos6502', {
	nmos6502: { label: 'MOS 6502 (NMOS)', model: NMOS_MODEL, view: { language: MOS6502_LANGUAGE_ID, registers: MOS6502_REGISTERS, registerBanks: banks, examples: EXAMPLES } },
	w65c02: { label: 'WDC W65C02S (CMOS)', model: W65C02_MODEL, view: { language: 'ca65-w65c02', registers: MOS6502_REGISTERS, registerBanks: banks, examples: CMOS_EXAMPLES } },
})
export const MOS6502_VARIANTS = variantCatalog('nmos6502', { ...BASE6502_VARIANTS.entries,
	w65816: { label: 'WDC W65C816S (16-bit)', view: w65816View },
})
