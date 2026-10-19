import { describe, expect, it } from 'vitest'
import { validSettings } from '../../../core/settings'
import definition from '../index'
import { DEFAULT_ARM26_SETTINGS, type Arm26Settings } from '../settings'

const schema = definition.settings

describe('ARM26 settings', () => {
	it('defaults to 1 MB and GNU as', () => {
		expect(validSettings(schema, undefined)).toEqual(DEFAULT_ARM26_SETTINGS)
		expect(DEFAULT_ARM26_SETTINGS).toEqual({ memoryBytes: 1 << 20, dialect: 'gnu' })
	})

	it('keeps valid values and drops the rest', () => {
		expect(validSettings(schema, { memoryBytes: 4 << 20, dialect: 'armasm' })).toEqual({ memoryBytes: 4 << 20, dialect: 'armasm' })
		expect(validSettings(schema, { memoryBytes: 12345, dialect: 'masm' })).toEqual(DEFAULT_ARM26_SETTINGS)
	})

	it('fails a program bigger than memory, with a diagnostic', () => {
		const services = definition.createServices()
		const settings: Arm26Settings = { memoryBytes: 512 << 10, dialect: 'gnu' }
		const program = services.assemble({ files: [{ name: 'a.s', code: '\t.org 0x80000\n\t.word 1\n' }], entries: ['a.s'] }, settings)
		expect(program.diagnostics[0].message).toMatch(/needs \d+ bytes of memory/)
		services.dispose()
	})
})
