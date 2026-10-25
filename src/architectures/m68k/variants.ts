import { variantCatalog } from '../../core/variants'
import { EXAMPLES, EXAMPLES_68010, EXAMPLES_68020, EXAMPLES_68020_FPU } from './examples'
import { fpuRegisters, REGISTERS } from './profile'
import type { ArchitectureVariant } from '../contracts'

const banks = [{ id: 'cpu', label: '68000 family' }]

export const M68K_VARIANTS = variantCatalog('68000', {
	'68000': { label: 'MC68000', view: { language: 'thrax-m68k', registers: REGISTERS, registerBanks: banks, examples: EXAMPLES } },
	'68010': { label: 'MC68010', view: { language: 'thrax-m68k', registers: REGISTERS, registerBanks: banks, examples: EXAMPLES_68010 } },
	'68020': { label: 'MC68020', view: { language: 'thrax-m68k', registers: REGISTERS, registerBanks: banks, examples: EXAMPLES_68020 } },
})
const fpuView = (id: '68881' | '68882'): ArchitectureVariant => ({
	language: 'thrax-m68k',
	registers: [...REGISTERS, ...fpuRegisters(id)],
	registerBanks: [...banks, { id, label: `MC${id} FPU` }],
	examples: EXAMPLES_68020_FPU
})
/** MC68020 with a coprocessor adds the FPU bank and its examples; each view is one stable object. */
export const FPU_VIEWS = { '68881': fpuView('68881'), '68882': fpuView('68882') }
