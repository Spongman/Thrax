import { describe, expect, it } from 'vitest'
import { variantOf, type ArchitectureDefinition, type ArchitectureVariant } from '../contracts'
import { defineSettings } from '../../core/settings'

const register = (id: string) => ({ id, name: id, bank: 'main', bits: 32, editable: true })

const WIDE: ArchitectureVariant = { language: 'wide', registers: [register('W0')], examples: {} }

function definition(variant?: ArchitectureDefinition['variant']): ArchitectureDefinition {
	return {
		id: 'test',
		name: 'Test',
		language: 'narrow',
		registers: [register('N0')],
		examples: {},
		settings: defineSettings<{ wide: boolean }>({ defaults: { wide: false }, fields: [] }),
		variant,
		createServices: () => { throw new Error('not used') },
	}
}

describe('an architecture variant', () => {
	it('is the definition itself when the definition does not vary', () => {
		const plain = definition()
		expect(variantOf(plain, { wide: true })).toBe(plain)
	})

	it('follows the settings when the definition varies', () => {
		const varying = definition((settings) => settings.wide ? WIDE : varying)
		expect(variantOf(varying, { wide: true })).toBe(WIDE)
		expect(variantOf(varying, { wide: false })).toBe(varying)
	})
})
