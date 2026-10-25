import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import beta from '../../architectures/beta'
import mips from '../../architectures/mips'
import { DEFAULT_BETA_SETTINGS } from '../../architectures/beta/settings'
import { DEFAULT_MIPS_SETTINGS } from '../../architectures/mips/settings'
import { ARM26_SETTINGS } from '../../architectures/armv8/arm26/settings'
import { ARMV8_SETTINGS } from '../../architectures/armv8/settings'
import { M68K_SETTINGS } from '../../architectures/m68k/settings'
import { MOS6502_SETTINGS } from '../../architectures/mos6502/settings'
import { RISCV_SETTINGS } from '../../architectures/riscv/settings'
import type { ArchitectureSettings } from '../../core/settings'
import { ArchitectureOptions, dialogGroups, dialogSections, TargetFields } from '../SettingsDialog'

const rows = (definition: { settings: ArchitectureSettings }, group: string, values: Record<string, unknown>) =>
	renderToStaticMarkup(<TargetFields schema={definition.settings} group={group} values={values} onChange={() => {}} />)

describe('settings dialog groups', () => {
	it('keeps architecture group IDs separate from common groups and display titles', () => {
		const settings = { ...mips.settings, groups: [{ id: 'Display', title: 'Video hardware' }], fields: [{ ...mips.settings.fields[0], group: 'Display' }] }
		const sections = dialogSections({ ...mips, settings })
		expect(sections.filter(section => section.group === 'Display')).toMatchObject([
			{ id: 'architecture:Display', title: 'Video hardware', architecture: true },
			{ id: 'common:Display', title: 'Display', architecture: false },
		])
	})

	it('keeps architecture options ahead of the common settings in a consistent order', () => {
		expect(dialogGroups(mips)).toEqual(['CPU', 'Memory', 'Assembler', 'Execution', 'Common', 'Display', 'Editor'])
		expect(rows(mips, 'Execution', DEFAULT_MIPS_SETTINGS)).toContain('Delayed branching')
		expect(rows(mips, 'Common', DEFAULT_MIPS_SETTINGS)).toBe('')
		// The layout lists what the chosen configuration resolves to.
		expect(rows(mips, 'Memory', { ...DEFAULT_MIPS_SETTINGS, memoryConfiguration: 'textBasedCompact' })).toContain('.text 0x00000000')
	})

	it('drops the assembler group under Beta, which has nothing for it', () => {
		expect(dialogGroups(beta)).toEqual(['CPU', 'Memory', 'Execution', 'Common', 'Display', 'Editor'])
		const memory = rows(beta, 'Memory', DEFAULT_BETA_SETTINGS)
		expect(memory).toContain('Memory size')
		expect(memory).toContain('<option value="2" selected="">1 MB</option>')
		expect(memory).not.toContain('Console I/O')
		expect(rows(beta, 'Execution', DEFAULT_BETA_SETTINGS)).toContain('Console I/O')
	})

	it('keeps only the architecture selector and the shared groups before an architecture has loaded', () => {
		expect(dialogGroups(undefined)).toEqual(['CPU', 'Common', 'Display', 'Editor'])
	})

	it.each([
		['ARM26', ARM26_SETTINGS],
		['ARM', ARMV8_SETTINGS],
		['68k', M68K_SETTINGS],
		['6502', MOS6502_SETTINGS],
		['RISC-V', RISCV_SETTINGS],
	] as const)('puts the %s variant selector in the same first CPU section', (_, settings) => {
		expect(dialogGroups({ ...mips, settings }).slice(0, 1)).toEqual(['CPU'])
		// The variant leads the section; options of that CPU, such as its FPU, follow it.
		const fields = settings.fields.filter((field) => field.group === 'CPU')
		expect(fields[0].label).toBe('CPU variant')
		expect(rows({ settings }, 'CPU', settings.defaults)).toContain('<span>CPU variant</span><select')
		expect(rows({ settings }, 'Common', settings.defaults)).toBe('')
	})

	it('disables a field while the one it depends on is off', () => {
		expect(rows(mips, 'Execution', DEFAULT_MIPS_SETTINGS)).toMatch(/<span>Arguments<\/span><input type="text" disabled=""/)
		expect(rows(mips, 'Execution', { ...DEFAULT_MIPS_SETTINGS, programArguments: true })).not.toMatch(/<span>Arguments<\/span><input type="text" disabled=""/)
	})

	it('marks the declared CPU default even when it is not the first option or the current selection', () => {
		const defaults = ARM26_SETTINGS.defaults
		const html = rows({ settings: ARM26_SETTINGS }, 'CPU', { ...defaults, cpuModel: 'arm2' })
		expect(html).toContain('ARM3 (26-bit, 4 KB cache and CP15) (default)</option>')
		expect(html).toContain('selected="">ARM2 (26-bit)</option>')
		expect(html.match(/\(default\)/g)).toHaveLength(1)
	})
})

describe('architecture selector', () => {
	it('names each architecture without its default variant, its maker set apart to the right', () => {
		const html = renderToStaticMarkup(<select><ArchitectureOptions /></select>)
		expect(html).toContain('<option value="vax"><span>VAX</span><span class="architecture-maker"><span class="architecture-separator"> · </span>DEC</span></option>')
		expect(html).toContain('<option value="mips"><span>MIPS (MARS)</span><span class="architecture-maker"><span class="architecture-separator"> · </span>MIPS Technologies</span></option>')
		expect(html).not.toContain('default:')
	})
})
