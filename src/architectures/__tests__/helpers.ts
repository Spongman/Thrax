import { variantOf, type ArchitectureDefinition } from '../contracts'
import type { TargetSettings } from '../../core/settings'

/** Every distinct set of code/registers offered by a registered CPU family. */
export function architectureVariants(definition: ArchitectureDefinition): TargetSettings[] {
	const defaults = definition.settings.defaults
	const seen = new Set([variantOf(definition, defaults)])
	const settings = [defaults]
	for (const field of definition.settings.fields) {
		if (field.control.kind !== 'choice') continue
		for (const option of field.control.options) {
			const value = { ...defaults, [field.key]: option.value }
			const variant = variantOf(definition, value)
			if (seen.has(variant)) continue
			seen.add(variant)
			settings.push(value)
		}
	}
	return settings
}
