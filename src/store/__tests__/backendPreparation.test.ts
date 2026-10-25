import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeArchitecture } from '../../architectures/registry'
import { useTHRAXStore } from '../thraxStore'

const state = () => useTHRAXStore.getState()
beforeAll(async () => { await initializeArchitecture() })
beforeEach(async () => {
	await state().switchArchitecture('mips')
	await state().switchArchitecture('armv8')
	await state().setTargetSetting('executionState', 'aarch64')
})
afterEach(async () => {
	vi.restoreAllMocks()
	await state().switchArchitecture('mips')
})

function heldPreparation() {
	const services = state().target!.services
	const prepare = services.prepare!.bind(services)
	const release = new Map<string, () => void>()
	vi.spyOn(services, 'isPrepared').mockReturnValue(false)
	vi.spyOn(services, 'prepare').mockImplementation(settings => new Promise<void>((resolve, reject) => {
		const id = String(settings.executionState), previous = release.get(id)
		release.set(id, () => { previous?.(); void prepare(settings).then(resolve, reject) })
	}))
	return { release, services }
}

describe('backend preparation in the shared settings flow', () => {
	it('keeps other setting changes made while the selected backend is still loading', async () => {
		const { release } = heldPreparation()
		const first = state().setTargetSetting('executionState', 'cortex-m0')
		const second = state().setTargetSetting('memoryBytes', 1 << 20)
		release.get('cortex-m0')!()
		await Promise.all([first, second])
		expect(state().targetSettings).toMatchObject({ executionState: 'cortex-m0', memoryBytes: 1 << 20 })
		expect(state().targetVariant?.language).toBe('thrax-thumb-m0')
	})

	it('commits only the latest variant request even when imports finish in reverse order', async () => {
		const { release } = heldPreparation()
		const first = state().setTargetSetting('executionState', 'cortex-m0')
		const second = state().setTargetSetting('executionState', 'aarch32')
		expect(state().targetSettings.executionState).toBe('aarch64')
		release.get('aarch32')!()
		await second
		expect(state().targetSettings.executionState).toBe('aarch32')
		expect(state().targetVariant?.language).toBe('arm')
		release.get('cortex-m0')!()
		await first
		expect(state().targetSettings.executionState).toBe('aarch32')
		expect(state().targetVariant?.language).toBe('arm')
	})

	it('does not apply a variant after switching to another architecture', async () => {
		const { release } = heldPreparation()
		const pending = state().setTargetSetting('executionState', 'cortex-m0')
		await state().switchArchitecture('mips')
		release.get('cortex-m0')!()
		await pending
		expect(state().architecture).toBe('mips')
		expect(state().targetSettings).not.toHaveProperty('executionState')
	})

	it('retains the current selection and loaded program when a backend download fails', async () => {
		state().setCode('nop')
		state().assemble()
		expect(state().hasMachine).toBe(true)
		const registers = state().registers, sourceIndex = state().sourceIndex
		const { services } = heldPreparation()
		vi.mocked(services.prepare!).mockRejectedValueOnce(new Error('backend download failed'))
		await state().setTargetSetting('executionState', 'cortex-m0')
		expect(state().targetSettings.executionState).toBe('aarch64')
		expect(state().hasMachine).toBe(true)
		expect(state().registers).toEqual(registers)
		expect(state().sourceIndex).toBe(sourceIndex)
		expect(state().diagnostics.some(d => d.message.includes('backend download failed'))).toBe(true)
	})
})
