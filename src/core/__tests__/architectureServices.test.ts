import { describe, expect, it, vi } from 'vitest'
import type * as Monaco from 'monaco-editor'
import type { EditorHost, Machine } from '../../architectures/contracts'
import { createArchitectureServices } from '../architectureServices'
import { disposableGroup, DisposableScope } from '../disposableScope'
import { ImageProgram } from '../imageProgram'

const program = new ImageProgram('main.s', null, [], { instructionBytes: 4 })
const settings = {}, options = { speed: null, historyLimit: 1000 }
const monaco = {} as typeof Monaco, host = {} as EditorHost
function fixture() {
	const machine = { dispose: vi.fn() } as unknown as Machine
	const backend = {
		assemble: vi.fn(() => program), createMachine: vi.fn(() => machine),
		profile: vi.fn(), disassembly: { row: () => '', at: () => null },
		installEditor: vi.fn(async () => ({ dispose: vi.fn() })),
	}
	return { machine, backend, services: createArchitectureServices(() => backend) }
}

describe('shared architecture resource ownership', () => {
	it('keeps the current machine when constructing its replacement fails', () => {
		const f = fixture()
		f.services.createMachine(program, settings, options)
		f.backend.createMachine.mockImplementationOnce(() => { throw new Error('bad program') })
		expect(() => f.services.createMachine(program, settings, options)).toThrow('bad program')
		expect(f.machine.dispose).not.toHaveBeenCalled()
		f.services.dispose()
		expect(f.machine.dispose).toHaveBeenCalledOnce()
	})

	it('disposes a replaced machine and releases manually closed providers only once', async () => {
		const f = fixture(), next = { dispose: vi.fn() } as unknown as Machine
		f.services.createMachine(program, settings, options)
		f.backend.createMachine.mockReturnValueOnce(next)
		f.services.createMachine(program, settings, options)
		expect(f.machine.dispose).toHaveBeenCalledOnce()
		const editor = await f.services.installEditor(monaco, host)
		const raw = await f.backend.installEditor.mock.results[0].value
		editor.dispose()
		f.services.dispose()
		f.services.dispose()
		expect(raw.dispose).toHaveBeenCalledOnce()
		expect(next.dispose).toHaveBeenCalledOnce()
	})

	it('disposes an editor that finishes loading after the service is closed', async () => {
		const f = fixture(), contribution = { dispose: vi.fn() }
		let finish!: (value: typeof contribution) => void
		f.backend.installEditor.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
		const pending = f.services.installEditor(monaco, host)
		f.services.dispose()
		finish(contribution)
		await expect(pending).rejects.toThrow('services have been disposed')
		expect(contribution.dispose).toHaveBeenCalledOnce()
		expect(() => f.services.assemble({ files: [], entries: [] }, settings)).toThrow('services have been disposed')
		expect(() => f.services.createMachine(program, settings, options)).toThrow('services have been disposed')
		await expect(f.services.installEditor(monaco, host)).rejects.toThrow('services have been disposed')
	})

	it('preserves dynamic service getters when the selected CPU variant changes', () => {
		const f = fixture(), first = f.backend.disassembly, second = { row: () => 'other', at: () => null }
		let selected = first
		const services = createArchitectureServices(() => ({ ...f.backend, get disassembly() { return selected } }))
		expect(services.disassembly).toBe(first)
		selected = second
		expect(services.disassembly).toBe(second)
		services.dispose()
	})

	it('rolls back partial registrations and attempts every cleanup even if one fails', () => {
		const order: number[] = [], scope = new DisposableScope()
		scope.add({ dispose: () => { order.push(1) } })
		scope.add({ dispose: () => { order.push(2); throw new Error('cleanup') } })
		scope.add({ dispose: () => { order.push(3) } })
		expect(() => scope.dispose()).toThrow('Resource cleanup failed')
		expect(order).toEqual([3, 2, 1])
		const part = { dispose: vi.fn() }
		expect(() => disposableGroup((resources) => { resources.add(part); throw new Error('registration') })).toThrow('registration')
		expect(part.dispose).toHaveBeenCalledOnce()
	})
})
