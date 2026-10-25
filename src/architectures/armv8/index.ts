import type { ArchitectureDefinition } from '../contracts'
import { createVariantServices } from '../../core/variantServices'
import modern from './modern'
import { ARM_VARIANTS, armView, MODERN_ARM_VARIANTS } from './variants'
import { ARM26_SETTINGS } from './arm26/settings'

const legacy = (settings: Record<string, unknown>) => settings.executionState === 'arm2' || settings.executionState === 'arm3'
const definition: ArchitectureDefinition = {
	...modern,
	variant: settings => armView(ARM_VARIANTS, settings),
	createServices: () => createVariantServices({ defaultBackend: 'modern', backend: settings => legacy(settings) ? '26bit' : 'modern', variant: settings => ARM_VARIANTS.valid(settings.executionState) ? settings.executionState : ARM_VARIANTS.defaultId,
		backends: {
			modern: { languages: [...new Set(MODERN_ARM_VARIANTS.options.map(({ value }) => MODERN_ARM_VARIANTS.select(value).view.language).filter((id): id is string => id !== undefined))], create: () => modern.createServices(), settings: settings => ({ ...modern.settings.defaults, ...settings }) },
			'26bit': { languages: ['arm26'], load: () => import('./arm26').then(module => module.default.createServices()), settings: settings => ({ ...ARM26_SETTINGS.defaults, ...settings, cpuModel: settings.executionState }) },
		},
	}),
}
export default definition
