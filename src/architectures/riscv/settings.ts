import { defineSettings } from '../../core/settings'

export type RiscvSettings = { isa: 'rv32im' | 'rv32imc' }
export const DEFAULT_RISCV_SETTINGS: RiscvSettings = { isa: 'rv32im' }
export const RISCV_SETTINGS = defineSettings<RiscvSettings>({
	defaults: DEFAULT_RISCV_SETTINGS,
	fields: [
		{
			key: 'isa',
			group: 'Simulator',
			rebuild: true,
			label: 'Instruction set',
			hint: 'RV32IMC adds 16-bit compressed instructions; both use the same educational console and memory',
			control: {
				kind: 'choice',
				options: [
					{ value: 'rv32im', label: 'RV32IM' },
					{ value: 'rv32imc', label: 'RV32IMC (compressed)' }
				]
			},
			isValid: (value) => value === 'rv32im' || value === 'rv32imc'
		}
	]
})
