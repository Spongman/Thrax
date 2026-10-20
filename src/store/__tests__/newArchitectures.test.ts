import { beforeAll, describe, expect, it } from 'vitest'
import { initializeArchitecture, knownArchitectures } from '../../architectures/registry'
import { useTHRAXStore } from '../thraxStore'

const state = () => useTHRAXStore.getState()

beforeAll(async () => { await initializeArchitecture() })

describe.each([
	{ id: 'avr', code: 'ldi r16, 5\ninc r16\nbreak\n', loop: 'loop: rjmp loop\n' },
	{ id: 'riscv', code: 'addi x5, x0, 5\naddi x5, x5, 1\nebreak\n', loop: 'loop: j loop\n' },
])('$id in the shared workbench', ({ id, code, loop }) => {
	it('loads through the catalog and steps, edits, rewinds and switches away', async () => {
		expect(knownArchitectures()).toContain(id)
		expect(await state().switchArchitecture(id)).toBe(true)
		state().reset()
		state().setCode(code)
		state().assemble()
		expect(state().diagnostics.filter((item) => item.severity === 'error')).toEqual([])
		expect(state().hasMachine).toBe(true)
		const initialPc = state().pc
		state().step()
		state().step()
		expect(state().instructionCount).toBe(2)
		expect(state().pc).toBeGreaterThan(initialPc)
		const register = state().target!.definition.registers.find((item) =>
			item.id.toLowerCase() === (id === 'avr' ? 'r16' : 'x5'))!
		expect(register).toBeDefined()
		expect(state().registers[register.id]).toBe(6)
		expect(state().setRegisterValue(register.id, 42)).toBe(true)
		expect(state().registers[register.id]).toBe(42)
		state().stepBack()
		expect(state().registers[register.id]).toBe(6)
		state().stepBack()
		expect(state().registers[register.id]).toBe(5)
		expect(state().instructionCount).toBe(1)
		await state().continue()
		expect(state().halted).toBe(true)
		expect(state().registers[register.id]).toBe(6)
		expect(state().workspaceSnapshot().architecture).toBe(id)
		expect(await state().switchArchitecture('mips')).toBe(true)
		expect(state().hasMachine).toBe(false)
		expect(state().executionHistory.length).toBe(0)
		expect(state().code).toBe(code)
	})

	it('releases a running machine when switching targets', async () => {
		expect(await state().switchArchitecture(id)).toBe(true)
		state().reset()
		state().setRunSpeed(1000)
		state().setCode(loop)
		const running = state().run()
		await new Promise(resolve => setTimeout(resolve, 20))
		expect(state().isRunning).toBe(true)
		expect(await state().switchArchitecture('mips')).toBe(true)
		await running
		expect(state().isRunning).toBe(false)
		expect(state().hasMachine).toBe(false)
		state().setRunSpeed(null)
	})
})
