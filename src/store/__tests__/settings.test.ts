import { beforeAll as beforeArchitectureTests } from 'vitest'
import { initializeArchitecture } from '../../architectures/registry'
beforeArchitectureTests(async () => { await initializeArchitecture() })
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../core/settings'
import { DEFAULT_BETA_SETTINGS } from '../../architectures/beta/settings'
import { DEFAULT_MIPS_SETTINGS } from '../../architectures/mips/settings'

const storage = new Map<string, string>()

// The store reads its settings while it is being created, so storage has to
// answer before the module is imported.
Object.defineProperty(globalThis, 'window', {
	value: {
		localStorage: {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => { storage.set(key, value) },
		},
	},
	writable: true,
})

// Settings left from before they were per architecture, under the shared keys
// they had then: one on, one invalid, and one shared setting.
storage.set('thrax-web.settings.assemble.delayedBranching', 'true')
storage.set('thrax-web.settings.memory.configuration', '"compact"')
storage.set('thrax-web.settings.display.valuesInHex', 'false')

const { useTHRAXStore } = await import('../thraxStore')
const state = () => useTHRAXStore.getState()
const stored = (key: string) => JSON.parse(storage.get(`thrax-web.settings.${key}`) ?? 'null') as unknown

describe('settings', () => {
	it('starts at the defaults, apart from what was stored', () => {
		expect(state().settings).toEqual({ ...DEFAULT_SETTINGS, displayValuesInHex: false })
	})

	it('moves the MIPS options stored under the shared keys into its own, dropping invalid ones', () => {
		expect(state().targetSettings).toEqual({ ...DEFAULT_MIPS_SETTINGS, delayedBranching: true })
		expect(stored('architecture.mips')).toEqual({ ...DEFAULT_MIPS_SETTINGS, delayedBranching: true })
		// Once moved, the namespace wins over a legacy key.
		storage.set('thrax-web.settings.assemble.delayedBranching', 'false')
	})

	it('round-trips a setting through the store and its persistence key', () => {
		state().setSetting('backstepLimit', 500)
		expect(state().settings.backstepLimit).toBe(500)
		expect(stored('simulate.backstepLimit')).toBe(500)

		// Kept from when it was a toolbar toggle.
		state().setSetting('assembleAll', true)
		expect(stored('assemble.allFiles')).toBe(true)
		state().setSetting('assembleAll', false)

		state().setTargetSetting('delayedBranching', false)
		expect(stored('architecture.mips')).toMatchObject({ delayedBranching: false })
	})

	it('ignores a value the field refuses, and a key the architecture does not have', () => {
		state().setTargetSetting('memoryConfiguration', 'compact')
		state().setTargetSetting('memoryBytes', 4096)
		expect(state().targetSettings).toEqual(DEFAULT_MIPS_SETTINGS)
	})

	it('keeps the settings of each architecture apart across a switch', async () => {
		state().setTargetSetting('memoryConfiguration', 'textBasedCompact')
		expect(state().targetProfile?.resetPc).toBe(0)

		expect(await state().switchArchitecture('beta')).toBe(true)
		expect(state().targetSettings).toEqual(DEFAULT_BETA_SETTINGS)
		state().setTargetSetting('memoryBytes', 64 * 1024)
		expect(state().targetProfile?.isMappedAddress(64 * 1024)).toBe(false)
		expect(stored('architecture.beta')).toEqual({ ...DEFAULT_BETA_SETTINGS, memoryBytes: 64 * 1024 })
		// Beta has no MIPS options, so the MIPS store is left as it was.
		expect(stored('architecture.mips')).toMatchObject({ memoryConfiguration: 'textBasedCompact' })

		expect(await state().switchArchitecture('mips')).toBe(true)
		expect(state().targetSettings).toEqual({ ...DEFAULT_MIPS_SETTINGS, memoryConfiguration: 'textBasedCompact' })
		expect(state().targetProfile?.resetPc).toBe(0)
		state().setTargetSetting('memoryConfiguration', 'default')
	})

	it('drops the running program when an assembly setting changes', () => {
		useTHRAXStore.getState().assemble()
		useTHRAXStore.getState().step()
		expect(useTHRAXStore.getState().instructionCount).toBe(1)

		// Nothing the assembler reads, so the program keeps running.
		useTHRAXStore.getState().setSetting('displayValuesInHex', false)
		expect(useTHRAXStore.getState().instructionCount).toBe(1)

		useTHRAXStore.getState().setTargetSetting('extendedAssembler', false)
		expect(useTHRAXStore.getState().instructionCount).toBe(0)
		expect(useTHRAXStore.getState().codeWords.size).toBe(0)
		// Put it back: the assembler really reads this one now, so leaving it off
		// would refuse the pseudo-instructions the later cases assemble.
		useTHRAXStore.getState().setTargetSetting('extendedAssembler', true)
	})

	it('reaches the assembler, so the delay slot runs when the setting is on', () => {
		useTHRAXStore.getState().setCode('main:\n\tbeq $zero, $zero, skip\n\taddi $t0, $zero, 7\nskip:\n\tnop\n')

		state().setTargetSetting('delayedBranching', false)
		useTHRAXStore.getState().assemble()
		useTHRAXStore.getState().step()
		useTHRAXStore.getState().step()
		expect(useTHRAXStore.getState().registers.$t0).toBe(0)

		state().setTargetSetting('delayedBranching', true)
		useTHRAXStore.getState().assemble()
		useTHRAXStore.getState().step()
		useTHRAXStore.getState().step()
		expect(useTHRAXStore.getState().registers.$t0).toBe(7)
	})
})

describe('self-modifying code', () => {
	// A store aimed at the first word of .text, which is the program itself.
	const intoText = `li $t0, 0x00400000
sw $zero, 0($t0)
li $v0, 10
syscall
`

	it('reaches the simulator, so a store into text faults when it is off', async () => {
		useTHRAXStore.getState().setTargetSetting('selfModifyingCode', false)
		useTHRAXStore.setState({ code: intoText })
		await useTHRAXStore.getState().run()
		expect(useTHRAXStore.getState().console).toMatch(/text segment/i)
	})

	it('lets the same store through when it is on', async () => {
		useTHRAXStore.getState().setTargetSetting('selfModifyingCode', true)
		useTHRAXStore.setState({ code: intoText })
		await useTHRAXStore.getState().run()
		expect(useTHRAXStore.getState().console).not.toMatch(/text segment/i)
	})
})

describe('extended assembler', () => {
	const pseudo = 'move $t0, $t1'

	it('reaches the assembler, so a pseudo-instruction is refused when it is off', () => {
		useTHRAXStore.getState().setTargetSetting('extendedAssembler', false)
		useTHRAXStore.setState({ code: pseudo })
		useTHRAXStore.getState().assemble()
		expect(useTHRAXStore.getState().diagnostics.some((one) => /not permitted/i.test(one.message))).toBe(true)
	})

	it('assembles the same source when it is on', () => {
		useTHRAXStore.getState().setTargetSetting('extendedAssembler', true)
		useTHRAXStore.setState({ code: pseudo })
		useTHRAXStore.getState().assemble()
		expect(useTHRAXStore.getState().diagnostics.some((one) => /not permitted/i.test(one.message))).toBe(false)
	})
})
