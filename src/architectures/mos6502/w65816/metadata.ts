import type { ArchitectureVariant } from '../../contracts'
import { examples } from './examples'
import { canonicalExamples } from '../../../core/exampleCatalog'

export const registerNames = ['A', 'X', 'Y', 'S', 'P', 'D', 'DBR', 'PBR', 'E'] as const
export const registers = registerNames.map((name, index) => ({ id: name.toLowerCase(), name, bank: 'integer', bits: index === 8 ? 1 : index === 4 || index === 6 || index === 7 ? 8 : 16, editable: true, ...(index === 3 ? { role: 'stackPointer' as const } : index === 4 ? { role: 'flags' as const } : {}) }))
export const view: ArchitectureVariant = { language: 'thrax-w65816', fileExtensions: ['.asm', '.s'], registers: [...registers, { id: 'PC', name: 'PC', bits: 24, bank: 'cpu', editable: true, role: 'programCounter' }], registerBanks: [{ id: 'integer', label: 'Integer' }, { id: 'cpu', label: 'CPU' }], examples: canonicalExamples(examples) }
