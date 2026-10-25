import type { ArchitectureDefinition } from '../architectures/contracts'
import type { CpuConfiguration } from './configuredCpu'
import { createConfiguredArchitecture } from './configuredCpu'
import { defineSettings, type ArchitectureSettings, type TargetSettings } from './settings'
import { variantCatalog, variantSetting } from './variants'
import { createVariantServices } from './variantServices'

/** Configured native CPUs share variant routing, ownership and compatibility too. */
export function createConfiguredFamily(spec: {
	id: string, name: string, defaultModel: string,
	models: Record<string, { label: string, configuration: CpuConfiguration }>,
	settings?: ArchitectureSettings,
	selectModel?(settings: TargetSettings): string,
}): ArchitectureDefinition {
	const catalog = variantCatalog(spec.defaultModel, spec.models)
	const definitions = new Map(Object.entries(spec.models).map(([id, entry]) => [id, createConfiguredArchitecture(entry.configuration)]))
	const idFor = (settings: TargetSettings) => { const id = spec.selectModel?.(settings) ?? settings.cpuModel; return catalog.valid(id) ? id : catalog.defaultId }
	const base = definitions.get(spec.defaultModel)!
	return {
		...base, id: spec.id, name: spec.name,
		settings: spec.settings ?? defineSettings({ defaults: { cpuModel: spec.defaultModel }, fields: [variantSetting('cpuModel', catalog)] }),
		variant: settings => definitions.get(idFor(settings))!,
		createServices: () => createVariantServices({ defaultBackend: spec.defaultModel, backend: idFor, variant: idFor,
			backends: Object.fromEntries([...definitions].map(([id, definition]) => [id, {
				languages: [definition.language!], create: () => definition.createServices(), settings: settings => settings,
			}])),
		}),
	}
}
