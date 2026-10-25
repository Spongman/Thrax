import { beforeAll, describe, expect, it, vi } from 'vitest'
import { initializeArchitecture } from '../../architectures/registry'
import type { Machine } from '../../architectures/contracts'
import { useTHRAXStore } from '../thraxStore'

const state = () => useTHRAXStore.getState()
beforeAll(async () => { await initializeArchitecture() })

describe('shared session teardown', () => {
	it.each(['resolve', 'reject'])('ignores an old Run that completes with %s after a replacement starts', async completion => {
		await state().switchArchitecture('mips')
		state().setCode('loop: addi $t0,$t0,1\nj loop\nnop')
		state().setRunSpeed(1)
		const services = state().target!.services
		const nativeCreate = services.createMachine.bind(services)
		let finish!: () => void, fail!: (error: Error) => void
		const pending = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject })
		const create = vi.spyOn(services, 'createMachine').mockImplementationOnce((...args) => {
			const machine = nativeCreate(...args)
			vi.spyOn(machine, 'run').mockReturnValue(pending)
			return machine
		})
		let replacement: Promise<void> | undefined
		try {
			const oldRun = state().run()
			state().createDocument()
			state().setCode('loop: addi $t1,$t1,1\nj loop\nnop')
			replacement = state().run()
			const snapshot = state()
			expect(snapshot.isRunning).toBe(true)
			if (completion === 'resolve') finish()
			else fail(new Error('stale execution failure'))
			await oldRun
			expect(state().isRunning).toBe(true)
			expect(state().registers).toBe(snapshot.registers)
			expect(state().diagnostics).toBe(snapshot.diagnostics)
		} finally {
			finish()
			state().stop()
			await replacement
			create.mockRestore()
			state().setRunSpeed(null)
		}
	})

	it('publishes native faults from Run through the common controls', async () => {
		await state().switchArchitecture('riscv')
		state().setCode('.word 0xffffffff')
		state().setRunSpeed(null)
		await state().run()
		expect(state().isRunning).toBe(false)
		expect(state().halted).toBe(true)
		expect(state().stopReason?.kind).toBe('fault')
		expect(state().diagnostics.some(d => d.severity === 'error')).toBe(true)
	})

	it.each(['open', 'new', 'rename', 'close', 'reset', 'assembly error'])('%s releases a paced run and ignores its stale callbacks', async operation => {
		await state().switchArchitecture('mips')
		state().setCode('addi $t0,$zero,1\naddi $t1,$zero,2\naddi $t2,$zero,3\naddi $v0,$zero,10\nsyscall')
		state().setRunSpeed(1)
		const services = state().target!.services
		const create = vi.spyOn(services, 'createMachine')
		try {
			const running = state().run()
			const machine = create.mock.results[0].value as Machine
			const progress = machine.onProgress
			expect(machine.instructionCount).toBeGreaterThan(0)
			const id = state().activeDocumentId
			switch (operation) {
				case 'open': state().openFiles([{ title: 'other.asm', code: 'nop' }]); break
				case 'new': state().createDocument(); break
				case 'rename': state().renameDocument(id, 'renamed.asm'); break
				case 'close': state().closeDocument(id); break
				case 'reset': state().reset(); break
				case 'assembly error': state().setCode('    .thrax_unknown 1,2,3'); state().assemble(); break
			}
			const count = machine.instructionCount, snapshot = state()
			expect(machine.onProgress).toBeNull()
			progress?.()
			await running
			expect(machine.instructionCount).toBe(count)
			expect(state().isRunning).toBe(false)
			expect(state().code).toBe(snapshot.code)
			expect(state().registers).toEqual(snapshot.registers)
			if (operation !== 'reset') expect(state().hasMachine).toBe(false)
		} finally { create.mockRestore(); state().setRunSpeed(null) }
	})
})
