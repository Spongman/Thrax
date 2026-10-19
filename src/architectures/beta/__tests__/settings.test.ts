/** The Beta settings, through the services the workbench drives. */

import { describe, expect, it } from 'vitest'
import beta from '..'
import { hasErrors } from '../../../core/diagnostics'
import { DEFAULT_BETA_SETTINGS, type BetaSettings } from '../settings'

const services = beta.createServices()
const sources = (code: string) => ({ files: [{ name: 'main.uasm', code }], entries: ['main.uasm'] })
const OPTIONS = { speed: null, historyLimit: 0 }

/** Runs `code` to its end and returns what it printed. */
async function run(code: string, settings: BetaSettings) {
	const program = services.assemble(sources(code), settings)
	expect(hasErrors(program.diagnostics)).toBe(false)
	const machine = services.createMachine(program, settings, OPTIONS)
	await machine.run()
	return machine.console
}

const PRINT = '.include "beta.uasm"\n\tCMOVE(65, R0)\n\tWRCHAR()\n\tHALT()\n'

describe('Beta settings', () => {
	it('sizes memory, and refuses a program that does not fit', () => {
		const small = { ...DEFAULT_BETA_SETTINGS, memoryBytes: 64 * 1024 }
		expect(services.profile(small).isMappedAddress(64 * 1024 - 4)).toBe(true)
		expect(services.profile(small).isMappedAddress(64 * 1024)).toBe(false)

		const far = '.include "beta.uasm"\n. = 0x20000\n\tHALT()\n'
		expect(hasErrors(services.assemble(sources(far), DEFAULT_BETA_SETTINGS).diagnostics)).toBe(false)
		const program = services.assemble(sources(far), small)
		expect(program.diagnostics.find((one) => one.severity === 'error')?.message).toMatch(/needs .* bytes of memory/)
	})

	it('gives a program that names no tty option the console the setting chooses', async () => {
		expect(await run(PRINT, { ...DEFAULT_BETA_SETTINGS, tty: true })).toBe('A')
		await expect(run(PRINT, DEFAULT_BETA_SETTINGS)).resolves.not.toBe('A')
	})

	it('lets the program\'s own .options win over the setting', async () => {
		expect(await run(`.options tty\n${PRINT}`, DEFAULT_BETA_SETTINGS)).toBe('A')
		await expect(run(`.options notty\n${PRINT}`, { ...DEFAULT_BETA_SETTINGS, tty: true })).resolves.not.toBe('A')
	})
})
