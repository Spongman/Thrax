import { beforeAll, describe, expect, it, vi } from 'vitest'
import { initializeArchitecture } from '../../architectures/registry'
import { debugControls } from '../../debug/controlAvailability'
import { useTHRAXStore } from '../thraxStore'

const state = () => useTHRAXStore.getState()
beforeAll(async () => { await initializeArchitecture() })

describe('shared execution controls', () => {
	it('keeps a native resumed run active when the paused Run settles', async () => {
		await state().switchArchitecture('mips')
		state().setCode('loop: addi $t0,$t0,1\nj loop\nnop')
		state().setRunSpeed(1)
		let resumed: Promise<void> | undefined
		try {
			const running = state().run()
			state().pause()
			resumed = state().continue()
			const snapshot = state()
			await running
			expect(state().isRunning).toBe(true)
			expect(state().registers).toBe(snapshot.registers)
		} finally {
			state().stop()
			await resumed
			state().setRunSpeed(null)
		}
	})

	it.each(['pause', 'continue', 'stop'] as const)('keeps %s authoritative over a delayed Run completion or rejection', async command => {
		await state().switchArchitecture('mips')
		state().setCode('loop: addi $t0,$t0,1\nj loop\nnop')
		state().setRunSpeed(1)
		const services = state().target!.services
		const nativeCreate = services.createMachine.bind(services)
		for (const rejects of [false, true]) {
			let finish!: () => void, fail!: (error: Error) => void
			const pending = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject })
			const create = vi.spyOn(services, 'createMachine').mockImplementationOnce((...args) => {
				const machine = nativeCreate(...args)
				vi.spyOn(machine, 'run').mockReturnValue(pending)
				return machine
			})
			let resumed: Promise<void> | undefined
			try {
				const oldRun = state().run()
				state().pause()
				if (command === 'continue') resumed = state().continue()
				if (command === 'stop') state().stop()
				const snapshot = state()
				if (rejects) fail(new Error('old execution failure'))
				else finish()
				await oldRun
				expect(state().isRunning).toBe(command === 'continue')
				expect(state().isPaused).toBe(command === 'pause')
				expect(state().diagnostics).toBe(snapshot.diagnostics)
				expect(state().console).toBe(snapshot.console)
			} finally {
				finish()
				state().stop()
				await resumed
				create.mockRestore()
			}
		}
		state().setRunSpeed(null)
	})

	it.each(['run', 'step', 'stepOver', 'input'] as const)('preserves native output and rewind after a fault from %s', async command => {
		await state().switchArchitecture('riscv')
		const input = command === 'input' ? 'li a7,5\necall\n' : ''
		state().setCode(`li a0,42\nli a7,1\necall\n${input}.word 0xffffffff`)
		state().setRunSpeed(null)
		if (command === 'run' || command === 'input') {
			await state().run()
			if (command === 'input') {
				expect(state().pendingInput?.type).toBe('integer')
				await state().submitInput('7')
			}
		} else {
			for (let i = 0; i < 20 && !state().halted; i++) await state()[command]()
		}
		expect(state().halted).toBe(true)
		expect(state().stopReason?.kind).toBe('fault')
		expect(state().console).toBe('42')
		expect(state().diagnostics.some(d => d.severity === 'error' && d.message.includes('Illegal'))).toBe(true)
		expect(debugControls(state()).canStepBack).toBe(true)
		state().stepBack()
		expect(state().stopReason).toBeNull()
		expect(state().historyCursor).toBeGreaterThan(0)
	})

	it('permits Step Back after normal completion and Stop, and blocks it during a run', async () => {
		await state().switchArchitecture('riscv')
		state().setCode(state().targetVariant!.examples.sum.code)
		state().setRunSpeed(null)
		await state().run()
		const cursor = state().historyCursor
		expect(state().stopReason?.kind).toBe('halt')
		expect(state().isPaused).toBe(false)
		expect(debugControls(state()).canStepBack).toBe(true)
		state().stepBack()
		expect(state().historyCursor).toBeLessThan(cursor)
		state().stop()
		expect(state().stopReason?.kind).toBe('stop')
		state().stepBack()
		expect(state().stopReason).toBeNull()
		state().setRunSpeed(1)
		const running = state().continue()
		try {
			const position = state().historyCursor
			expect(state().isRunning).toBe(true)
			state().stepBack()
			expect(state().historyCursor).toBe(position)
			expect(state().isRunning).toBe(true)
		} finally {
			state().stop()
			await running
			state().setRunSpeed(null)
		}
	})
})
