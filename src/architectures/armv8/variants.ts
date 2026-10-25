import type { ArchitectureVariant } from '../contracts'
import { variantCatalog } from '../../core/variants'
import { A32_REGISTER_BANKS, A32_REGISTERS } from './a32/registers'
import { A32_EXAMPLES, A32_FIXED_EXAMPLES } from './a32/examples'
import { A64_REGISTER_BANKS, A64_REGISTERS } from './a64/registers'
import { EXAMPLES, FIXED_EXAMPLES } from './examples'
import { M0_VARIANT } from './m0/metadata'
import { ARCH_V8 } from './shared/a32/isa'
import { ARM_LANGUAGE_ID } from './shared/language'
import { ARM26_VARIANTS } from './arm26/variants'

export const MODERN_ARM_VARIANTS = variantCatalog('aarch64', {
	aarch64: {
		label: 'AArch64 (A64)', load: () => import('./a64/state').then(module => module.createA64State),
		view: { language: 'aarch64', registers: A64_REGISTERS, registerBanks: A64_REGISTER_BANKS, examples: EXAMPLES },
		loadEditor: () => import('./editor').then(module => module.installEditor),
	},
	aarch32: {
		label: 'AArch32 (A32)', load: () => import('./a32/state').then(module => module.createA32State),
		view: { language: ARM_LANGUAGE_ID, registers: A32_REGISTERS, registerBanks: A32_REGISTER_BANKS, examples: A32_EXAMPLES },
		loadEditor: () => import('./shared/editor').then(module => (monaco: Parameters<typeof module.installEditor>[0], host: Parameters<typeof module.installEditor>[1]) => module.installEditor(monaco, host, ARCH_V8)),
	},
	'cortex-m0': {
		label: 'Cortex-M0 (ARMv6-M Thumb)', load: () => import('./m0/state').then(module => module.createM0State),
		view: M0_VARIANT,
		loadEditor: () => import('./m0/editor').then(module => module.installM0Editor),
	},
})
export const ARM_VARIANTS = variantCatalog('aarch64', { ...MODERN_ARM_VARIANTS.entries, ...ARM26_VARIANTS.entries })

/** The FP states' views with floating point off: the fixed-point examples, the Mandelbrot set among them. */
const FIXED_VIEWS: Readonly<Record<string, ArchitectureVariant>> = {
	aarch64: { ...MODERN_ARM_VARIANTS.entries.aarch64.view, examples: FIXED_EXAMPLES },
	aarch32: { ...MODERN_ARM_VARIANTS.entries.aarch32.view, examples: A32_FIXED_EXAMPLES },
}

/** The view `settings` select from `catalog`, with the fixed-point examples where floating point is off. */
export function armView(catalog: { select(id: unknown): { view: ArchitectureVariant } }, settings: Record<string, unknown>): ArchitectureVariant {
	const { executionState: id } = settings
	if (settings.floatingPoint === false && typeof id === 'string' && Object.prototype.hasOwnProperty.call(FIXED_VIEWS, id)) return FIXED_VIEWS[id]
	return catalog.select(id).view
}
