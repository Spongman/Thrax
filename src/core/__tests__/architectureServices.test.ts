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
	const machine = { dispose: vi.fn(), stop: vi.fn() } as unknown as Machine
	const backend = {
		assemble: vi.fn(() => program), createMachine: vi.fn(() => machine),
		profile: vi.fn(), disassembly: { row: () => '', at: () => null },
		installEditor: vi.fn(async () => ({ dispose: vi.fn() })),
	}
	return { machine, backend, services: createArchitectureServices(() => backend) }
}

describe('shared architecture resource ownership', () => {
	it('releases execution, callbacks and inspection together, without releasing a replacement', () => {
		const f = fixture()
		let inspection: () => unknown = () => null
		const released = vi.fn()
		const services = createArchitectureServices(lifetime => { inspection = lifetime.program; lifetime.onRelease(released); return f.backend })
		services.assemble({ files: [], entries: [] }, settings)
		services.createMachine(program, settings, options)
		const next = { stop: vi.fn(), dispose: vi.fn() } as unknown as Machine
		f.backend.createMachine.mockReturnValueOnce(next)
		services.createMachine(program, settings, options)
		services.releaseMachine(f.machine)
		expect(released).not.toHaveBeenCalled()
		expect(next.dispose).not.toHaveBeenCalled()
		expect(inspection()).toBe(program)
		next.onProgress = vi.fn()
		services.releaseMachine()
		expect(released).toHaveBeenCalledOnce()
		expect(next.onProgress).toBeNull()
		expect(next.stop).toHaveBeenCalledOnce()
		expect(next.dispose).toHaveBeenCalledOnce()
		expect(inspection()).toBeNull()
		services.releaseMachine()
		services.dispose()
		expect(next.dispose).toHaveBeenCalledOnce()
	})

	it('checks recorded variants before constructing or replacing a machine', () => {
		const f = fixture()
		const services = createArchitectureServices(() => f.backend, { variant: settings => String(settings.variant) })
		const sources = { files: [], entries: [] }
		services.assemble(sources, { variant: 'nmos' })
		services.createMachine(program, { variant: 'nmos' }, options)
		expect(() => services.createMachine(program, { variant: 'cmos' }, options)).toThrow('assembled for nmos cannot run as cmos')
		expect(f.backend.createMachine).toHaveBeenCalledOnce()
		expect(f.machine.dispose).not.toHaveBeenCalled()
		services.dispose()
	})

	it('rejects assembly errors before loading or disposing the current machine', () => {
		const f = fixture()
		f.services.createMachine(program, settings, options)
		const invalid = new ImageProgram('bad.s', null, [{ severity: 'error', message: 'bad instruction' }], { instructionBytes: 4 })
		expect(() => f.services.createMachine(invalid, settings, options)).toThrow('assembly errors')
		expect(f.backend.createMachine).toHaveBeenCalledOnce()
		expect(f.machine.dispose).not.toHaveBeenCalled()
		f.services.dispose()
	})

	it('pins inspection to the loaded program across successful and failed validation attempts', () => {
		const f = fixture()
		let inspection: () => unknown = () => null
		const services = createArchitectureServices(lifetime => {
			inspection = lifetime.program
			return f.backend
		})
		expect(inspection()).toBeNull()
		services.assemble({ files: [], entries: [] }, settings)
		expect(inspection()).toBe(program)
		services.createMachine(program, settings, options)
		const preview = new ImageProgram('preview.s', null, [], { instructionBytes: 4 })
		f.backend.assemble.mockReturnValueOnce(preview)
		services.assemble({ files: [], entries: [] }, settings)
		expect(inspection()).toBe(program)
		const invalid = new ImageProgram('bad.s', null, [{ severity: 'error', message: 'invalid' }], { instructionBytes: 4 })
		f.backend.assemble.mockReturnValueOnce(invalid)
		services.assemble({ files: [], entries: [] }, settings)
		expect(inspection()).toBe(program)
		f.backend.createMachine.mockImplementationOnce(() => { throw new Error('load failed') })
		expect(() => services.createMachine(preview, settings, options)).toThrow('load failed')
		expect(inspection()).toBe(program)
		f.backend.createMachine.mockReturnValueOnce({ dispose: vi.fn(), stop: vi.fn() } as unknown as Machine)
		services.createMachine(preview, settings, options)
		expect(inspection()).toBe(preview)
		services.dispose()
		expect(inspection()).toBeNull()
	})

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
		const f = fixture(), next = { dispose: vi.fn(), stop: vi.fn() } as unknown as Machine
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
