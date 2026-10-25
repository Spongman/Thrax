import type { ArchitectureDefinition } from '../contracts'
import { createVariantServices } from '../../core/variantServices'
import backend from './backend'
import { MOS6502_VARIANTS } from './variants'

const definition: ArchitectureDefinition = {
	...backend, name: '6502 family',
	variant: settings => MOS6502_VARIANTS.select(settings.cpuModel).view,
	createServices: () => createVariantServices({ defaultBackend: '6502', backend: settings => settings.cpuModel === 'w65816' ? '65816' : '6502', variant: settings => MOS6502_VARIANTS.valid(settings.cpuModel) ? settings.cpuModel : MOS6502_VARIANTS.defaultId,
		backends: {
			'6502': { languages: ['ca65', 'ca65-w65c02'], create: () => backend.createServices(), settings: settings => ({ ...backend.settings.defaults, ...settings }) },
			'65816': { languages: ['thrax-w65816'], load: () => import('./w65816').then(module => module.default.createServices()), settings: () => ({}) },
		},
	}),
}
export default definition
