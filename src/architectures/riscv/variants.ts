import { variantCatalog } from '../../core/variants'
import type { ArchitectureVariant } from '../contracts'
import { COMPRESSED_EXAMPLES, EXAMPLES, FLOAT_EXAMPLES, DOUBLE_EXAMPLES } from './examples'
import { REGISTERS, floatRegisters } from './profile'

const banks = [{ id: 'cpu', label: 'Integer' }]
const floatBanks = [...banks, { id: 'fpu', label: 'Float' }]

export const RISCV_VARIANTS = variantCatalog('rv32im', {
	rv32im: { label: 'RV32IM', compressed: false, view: { language: 'thrax-riscv', registers: REGISTERS, registerBanks: banks, examples: EXAMPLES } },
	rv32imc: { label: 'RV32IMC (compressed)', compressed: true, view: { language: 'thrax-riscv', registers: REGISTERS, registerBanks: banks, examples: COMPRESSED_EXAMPLES } },
})

export const FLOAT_OPTIONS = [
	{ value: 'none', label: 'None' },
	{ value: 'f', label: 'F (single precision)' },
	{ value: 'fd', label: 'F and D (double precision)' },
] as const

/** One selected ISA: its id names the extensions, as in rv32imfdc. */
export interface RiscvIsa {
	id: string
	compressed: boolean
	/** Float register width: 0, 32 (F) or 64 (D). */
	flen: number
	view: ArchitectureVariant
}

const isas = new Map<string, RiscvIsa>()
export function riscvIsa(settings: { isa?: unknown, float?: unknown }): RiscvIsa {
	const base = RISCV_VARIANTS.select(settings.isa),
		flen = settings.float === 'fd' ? 64 : settings.float === 'f' ? 32 : 0,
		id = `rv32im${flen ? 'f' : ''}${flen === 64 ? 'd' : ''}${base.compressed ? 'c' : ''}`
	let isa = isas.get(id)
	if (!isa) {
		const view = !flen ? base.view : {
			...base.view,
			registers: [...REGISTERS, ...floatRegisters(flen)],
			registerBanks: floatBanks,
			examples: { ...base.view.examples, ...(flen === 64 ? DOUBLE_EXAMPLES : FLOAT_EXAMPLES) },
		}
		isa = { id, compressed: base.compressed, flen, view }
		isas.set(id, isa)
	}
	return isa
}
