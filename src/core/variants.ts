import { offeredOptions, type ArchitectureSettings, type SettingField, type TargetSettings } from './settings'

/** CPU models and optional execution extensions are independent selector axes. */
export function variantConfigurations(schema: ArchitectureSettings): TargetSettings[] {
	let combinations = [schema.defaults]
	for (const field of schema.fields) {
		if (field.role !== 'variant' || field.control.kind !== 'choice') continue
		const options = field.control.options
		combinations = combinations.flatMap(settings => offeredOptions(options, settings).map(option => ({ ...settings, [field.key]: option.value })))
	}
	return combinations
}

/** A family declares each variant once; settings and service wiring read the same catalog. */
export function variantCatalog<const Entries extends Record<string, { label: string }>>(defaultId: keyof Entries & string, entries: Entries) {
	const ids = Object.keys(entries) as (keyof Entries & string)[]
	const valid = (id: unknown): id is keyof Entries & string => typeof id === 'string' && Object.prototype.hasOwnProperty.call(entries, id)
	return {
		defaultId,
		entries,
		options: ids.map(value => ({ value, label: entries[value].label })),
		valid,
		select: (id: unknown): Entries[keyof Entries] => entries[valid(id) ? id : defaultId],
	}
}

export function variantSetting<const Key extends string>(key: Key, catalog: { options: readonly { value: unknown, label: string }[], valid(value: unknown): boolean }, hint?: string): Omit<SettingField, 'key' | 'enabledBy'> & { key: Key } {
	return { key, group: 'CPU', role: 'variant', label: 'CPU variant', hint, rebuild: true, control: { kind: 'choice', options: catalog.options }, isValid: catalog.valid }
}
