import { beforeAll, describe, expect, it, vi } from 'vitest'
import { architectureManifests, initializeArchitecture, knownArchitectures } from '../../architectures/registry'
import { useTHRAXStore, migrateWorkspaceTarget } from '../thraxStore'
import { dialogSections } from '../../components/SettingsDialog'
import { writeStoredSetting, readStoredSetting } from '../../hooks/useStoredState'

const state = () => useTHRAXStore.getState()
vi.hoisted(() => {
	const storage = new Map<string, string>()
	Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: { localStorage: {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => { storage.set(key, value) },
	} } })
})
beforeAll(async () => { await initializeArchitecture() })

describe('grouped architecture families', () => {
	it('lists one family per selector and documents a default for every family', () => {
		expect(knownArchitectures()).not.toContain('arm26')
		expect(knownArchitectures()).not.toContain('w65816')
		for (const manifest of architectureManifests()) expect(manifest.defaultVariant, manifest.id).toBeTruthy()
	})
	it('switches 6502/65C02/65C816 in shared views, hides inapplicable settings and keeps source files', async () => {
		await state().switchArchitecture('mos6502')
		await state().setTargetSetting('cpuModel', 'nmos6502')
		const source = 'lda #42\nsta $10\nbrk'
		state().setCode(source); state().assemble(); state().step()
		expect(state().registers.A).toBe(42)
		await state().setTargetSetting('cpuModel', 'w65816')
		expect(state().architecture).toBe('mos6502')
		expect(state().code).toBe(source)
		expect(state().hasMachine).toBe(false)
		expect(state().targetVariant!.registers.some(r => r.id === 'pbr')).toBe(true)
		expect(dialogSections(state().target!.definition, state().targetSettings).map(s => s.group)).not.toContain('Execution')
		state().loadExample(state().targetVariant!.examples.factorial); state().setRunSpeed(null); await state().run()
		expect(state().console).toBe('120\n')
		await state().setTargetSetting('cpuModel', 'w65c02')
		expect(state().hasMachine).toBe(false)
		expect(state().targetVariant!.registers.some(r => r.id === 'pbr')).toBe(false)
	})
	it('switches modern and 26-bit ARM, updates settings/languages and preserves native pipeline capability', async () => {
		await state().switchArchitecture('armv8')
		await state().setTargetSetting('executionState', 'arm3')
		expect(state().targetVariant!.language).toBe('arm26')
		expect(state().registers.CP15_0).toBe(0x41560300)
		expect(dialogSections(state().target!.definition, state().targetSettings).map(s => s.group)).toContain('Memory timing')
		state().loadExample(state().targetVariant!.examples.cache); state().setRunSpeed(null); await state().run()
		expect(state().console).toBe('5')
		await state().setTargetSetting('executionState', 'cortex-m0')
		expect(state().targetVariant!.language).toBe('thrax-thumb-m0')
		expect(state().hasMachine).toBe(false)
		expect(dialogSections(state().target!.definition, state().targetSettings).map(s => s.group)).not.toContain('Memory timing')
		expect(state().registers.CP15_0).toBeUndefined()
	})
	it('migrates legacy target selections into the corresponding family variant', async () => {
		writeStoredSetting('architecture.arm26', { cpuModel: 'arm2', memoryBytes: 1 << 20, dialect: 'gnu', sequentialCycles: 2, latencyCycles: 3 })
		expect(await state().switchArchitecture('arm26')).toBe(true)
		expect(state().architecture).toBe('armv8')
		expect(state().targetSettings).toMatchObject({ executionState: 'arm2' })
		expect(await state().switchArchitecture('w65816')).toBe(true)
		expect(state().architecture).toBe('mos6502')
		expect(state().targetSettings.cpuModel).toBe('w65816')
		const workspace = migrateWorkspaceTarget({ files: [{ title: 'main.asm', code: 'nop' }], architecture: 'w65816', assembleAll: false })
		expect(workspace.architecture).toBe('mos6502')
		expect(readStoredSetting('architecture.mos6502', {}, () => true)).toMatchObject({ cpuModel: 'w65816' })
	})
})
