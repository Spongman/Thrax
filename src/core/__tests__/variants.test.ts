import { expect, it } from 'vitest'
import { variantCatalog, variantSetting, variantConfigurations } from '../variants'

it('uses the same stable entries for selection, validation and settings choices', () => {
	const first = { label: 'First', view: { language: 'one' } }, second = { label: 'Second', view: { language: 'two' } }
	const catalog = variantCatalog('first', { first, second })
		expect(catalog.select('second')).toBe(second)
		expect(catalog.select('unknown')).toBe(first)
		for (const value of ['__proto__', 'constructor', null, 1]) expect(catalog.valid(value)).toBe(false)
		const field = variantSetting('model', catalog)
		expect(field).toMatchObject({ key: 'model', role: 'variant', rebuild: true, control: { kind: 'choice', options: [{ value: 'first', label: 'First' }, { value: 'second', label: 'Second' }] } })
		expect(field.isValid('second')).toBe(true)
		expect(field.isValid('unknown')).toBe(false)
})

it('enumerates CPU and optional extension combinations without varying unrelated settings', () => {
	const cpu = variantCatalog('a', { a: { label: 'A' }, b: { label: 'B' } }), extension = variantCatalog('off', { off: { label: 'None' }, on: { label: 'Extension' } })
	expect(variantConfigurations({ defaults: { cpu: 'a', extension: 'off', memory: 1024 }, fields: [variantSetting('cpu', cpu), variantSetting('extension', extension)] })).toEqual([
		{ cpu: 'a', extension: 'off', memory: 1024 }, { cpu: 'a', extension: 'on', memory: 1024 }, { cpu: 'b', extension: 'off', memory: 1024 }, { cpu: 'b', extension: 'on', memory: 1024 },
	])
})
