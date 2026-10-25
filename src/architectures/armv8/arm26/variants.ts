import { variantCatalog } from '../../../core/variants'
import { ARM3_EXAMPLES, EXAMPLES } from './examples'
import { ARM26_BANKS, ARM26_REGISTERS, ARM3_BANKS, ARM3_REGISTERS } from './registers'

export const ARM26_VARIANTS = variantCatalog('arm3', {
	arm2: { label: 'ARM2 (26-bit)', view: { language: 'arm26', fileExtensions: ['.asm', '.s', '.S', '.armasm'], registers: ARM26_REGISTERS, registerBanks: ARM26_BANKS, examples: EXAMPLES } },
	arm3: { label: 'ARM3 (26-bit, 4 KB cache and CP15)', view: { language: 'arm26', fileExtensions: ['.asm', '.s', '.S', '.armasm'], registers: ARM3_REGISTERS, registerBanks: ARM3_BANKS, examples: ARM3_EXAMPLES } },
})
