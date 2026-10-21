import { describe, expect, it } from 'vitest'
import {
	DEFAULT_SETTINGS,
	defineSettings,
	isBoolean,
	isValidSettings,
	MAX_BACKSTEP_LIMIT,
	SETTINGS_VALIDATORS,
	validSettings,
	type ThraxSettings,
} from '../settings'

// Defaults, line for line, from Settings.properties, plus BackstepLimit, which
// is a Config.properties key rather than a Settings.properties one.  Every
// value matches the reference except where a comment says why it does not.
// The options only MIPS reads are its own; see its settings test.
describe('DEFAULT_SETTINGS', () => {
	it('matches Settings.properties line for line', () => {
		expect(DEFAULT_SETTINGS).toEqual<ThraxSettings>({
			assembleAll: false, // AssembleAll = false
			displayValuesInHex: true, // DisplayValuesInHex = true
			displayAddressesInHex: true, // DisplayAddressesInHex = true
			// A deliberate departure: MARS keeps 2000 backstep *operations*, where
			// one instruction may push several.  THRAX keeps whole instructions,
			// at about 150 bytes each and no cost to the speed of a run, so the
			// default is what it takes to rewind a small program from its end.
			backstepLimit: 1_000_000,
			hexDimming: 'nibbles', // THRAX's own: how far a hex number's leading zeros are dimmed
			// THRAX's own, and on: a click that moves another panel is worth
			// following, and a value that moved is worth seeing move.
			highlightNavigation: true,
			highlightChanges: true,
			highlightSeconds: 0.3,
			highlightNavigationColor: '#4094ff',
			highlightChangeColor: '#f0a830',
		})
	})
})

describe('SETTINGS_VALIDATORS', () => {
	it('accepts every default value', () => {
		for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof ThraxSettings>) {
			expect(SETTINGS_VALIDATORS[key](DEFAULT_SETTINGS[key])).toBe(true)
		}
	})

	it('rejects wrong-typed values for boolean settings', () => {
		for (const key of ['assembleAll', 'displayValuesInHex', 'displayAddressesInHex'] as const) {
			expect(SETTINGS_VALIDATORS[key]('true')).toBe(false)
			expect(SETTINGS_VALIDATORS[key](1)).toBe(false)
			expect(SETTINGS_VALIDATORS[key](undefined)).toBe(false)
		}
	})

	it('rejects an out-of-range or wrong-typed backstepLimit', () => {
		expect(SETTINGS_VALIDATORS.backstepLimit(2000)).toBe(true)
		expect(SETTINGS_VALIDATORS.backstepLimit(1)).toBe(true)
		expect(SETTINGS_VALIDATORS.backstepLimit(MAX_BACKSTEP_LIMIT)).toBe(true)
		// Bounded, so a mistyped number cannot take the tab with it.
		expect(SETTINGS_VALIDATORS.backstepLimit(MAX_BACKSTEP_LIMIT + 1)).toBe(false)
		expect(SETTINGS_VALIDATORS.backstepLimit(0)).toBe(false)
		expect(SETTINGS_VALIDATORS.backstepLimit(-1)).toBe(false)
		expect(SETTINGS_VALIDATORS.backstepLimit(1.5)).toBe(false)
		expect(SETTINGS_VALIDATORS.backstepLimit('2000')).toBe(false)
	})
})

describe('isValidSettings', () => {
	it('accepts DEFAULT_SETTINGS', () => {
		expect(isValidSettings(DEFAULT_SETTINGS)).toBe(true)
	})

	it('rejects a settings object missing a field', () => {
		const { backstepLimit: _backstepLimit, ...partial } = DEFAULT_SETTINGS
		expect(isValidSettings(partial)).toBe(false)
	})

	it('rejects a settings object with one wrong-typed field', () => {
		expect(isValidSettings({ ...DEFAULT_SETTINGS, backstepLimit: -5 })).toBe(false)
		expect(isValidSettings({ ...DEFAULT_SETTINGS, hexDimming: 'bogus' })).toBe(false)
	})

	it('rejects non-objects', () => {
		expect(isValidSettings(null)).toBe(false)
		expect(isValidSettings(undefined)).toBe(false)
		expect(isValidSettings('settings')).toBe(false)
	})
})

describe('validSettings', () => {
	const schema = defineSettings<{ on: boolean, size: number }>({
		defaults: { on: false, size: 4 },
		fields: [
			{ key: 'on', group: 'Simulator', label: 'On', control: { kind: 'check' }, isValid: isBoolean },
			{ key: 'size', group: 'Simulator', label: 'Size', control: { kind: 'choice', options: [{ value: 4, label: '4' }, { value: 8, label: '8' }] }, isValid: (value) => value === 4 || value === 8 },
		],
	})

	it('keeps each stored value its field accepts', () => {
		expect(validSettings(schema, { on: true, size: 8 })).toEqual({ on: true, size: 8 })
	})

	it('falls back to the default for a missing, invalid or unknown field', () => {
		expect(validSettings(schema, { on: 'yes', extra: 1 })).toEqual({ on: false, size: 4 })
		expect(validSettings(schema, null)).toEqual({ on: false, size: 4 })
	})
})
