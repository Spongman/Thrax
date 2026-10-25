import { variantSetting } from '../../core/variants'
import { FLOAT_OPTIONS, RISCV_VARIANTS } from './variants'
import { defineSettings } from '../../core/settings'

export type RiscvSettings = { isa: 'rv32im' | 'rv32imc', float: 'none' | 'f' | 'fd' }
export const DEFAULT_RISCV_SETTINGS: RiscvSettings = { isa: 'rv32im', float: 'none' }
export const RISCV_SETTINGS = defineSettings<RiscvSettings>({
	defaults: DEFAULT_RISCV_SETTINGS,
	fields: [
		variantSetting('isa', RISCV_VARIANTS, 'RV32IMC adds 16-bit compressed instructions; both use the same educational console and memory'),
		{
			key: 'float', group: 'CPU', role: 'variant', label: 'Floating point', rebuild: true,
			hint: 'F adds 32 single-precision registers and fcsr; D widens them to 64 bits for double precision',
			control: { kind: 'choice', options: FLOAT_OPTIONS },
			isValid: (value: unknown) => FLOAT_OPTIONS.some(option => option.value === value),
		}
	]
})
