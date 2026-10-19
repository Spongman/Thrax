import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import beta from '../../architectures/beta'
import mips from '../../architectures/mips'
import { DEFAULT_BETA_SETTINGS } from '../../architectures/beta/settings'
import { DEFAULT_MIPS_SETTINGS } from '../../architectures/mips/settings'
import type { ArchitectureSettings } from '../../core/settings'
import { dialogGroups, TargetFields } from '../SettingsDialog'

const rows = (definition: { settings: ArchitectureSettings }, group: string, values: Record<string, unknown>) =>
	renderToStaticMarkup(<TargetFields schema={definition.settings} group={group} values={values} onChange={() => {}} />)

describe('settings dialog groups', () => {
	it('shows the shared groups, with the MIPS options merged in and its own group added', () => {
		expect(dialogGroups(mips)).toEqual(['Target', 'Assembler', 'Simulator', 'Memory configuration', 'Display', 'Editor'])
		expect(rows(mips, 'Simulator', DEFAULT_MIPS_SETTINGS)).toContain('Delayed branching')
		expect(rows(mips, 'Simulator', DEFAULT_MIPS_SETTINGS)).not.toContain('Memory size')
		// The layout lists what the chosen configuration resolves to.
		expect(rows(mips, 'Memory configuration', { ...DEFAULT_MIPS_SETTINGS, memoryConfiguration: 'textBasedCompact' })).toContain('.text 0x00000000')
	})

	it('drops the assembler group under Beta, which has nothing for it', () => {
		expect(dialogGroups(beta)).toEqual(['Target', 'Simulator', 'Display', 'Editor'])
		const simulator = rows(beta, 'Simulator', DEFAULT_BETA_SETTINGS)
		expect(simulator).toContain('Memory size')
		expect(simulator).toContain('<option value="2" selected="">1 MB</option>')
		expect(simulator).not.toContain('Delayed branching')
	})

	it('keeps only the shared groups before an architecture has loaded', () => {
		expect(dialogGroups(undefined)).toEqual(['Target', 'Simulator', 'Display', 'Editor'])
	})

	it('disables a field while the one it depends on is off', () => {
		expect(rows(mips, 'Simulator', DEFAULT_MIPS_SETTINGS)).toMatch(/<span>Arguments<\/span><input type="text" disabled=""/)
		expect(rows(mips, 'Simulator', { ...DEFAULT_MIPS_SETTINGS, programArguments: true })).not.toMatch(/<span>Arguments<\/span><input type="text" disabled=""/)
	})
})
