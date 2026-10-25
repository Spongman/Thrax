import type { ArchitectureServices, AssembledProgram, Machine } from '../architectures/contracts'
import type { TargetSettings } from './settings'
import { createArchitectureServices } from './architectureServices'
import { DisposableScope } from './disposableScope'
import { lazyLanguageProviders } from '../services/assemblyLanguage'

interface Backend {
	languages: readonly string[]
	create?(): ArchitectureServices
	load?(): Promise<ArchitectureServices>
	settings(settings: TargetSettings): TargetSettings
}

/** Group existing native backends without copying their debugger or editor controllers. */
export function createVariantServices(spec: {
	backends: Record<string, Backend>, defaultBackend: string,
	backend(settings: TargetSettings): string, variant(settings: TargetSettings): string,
}): ArchitectureServices {
	const scope = new DisposableScope(), children = new Map<string, ArchitectureServices>(), loading = new Map<string, Promise<ArchitectureServices>>()
	const owners = new WeakMap<AssembledProgram, ArchitectureServices>()
	let loaded: ArchitectureServices | undefined, machine: Machine | undefined
	for (const [id, backend] of Object.entries(spec.backends)) if (backend.create) { const child = backend.create(); children.set(id, child); scope.add(child) }
	const services = createArchitectureServices(({ check, program }) => {
		const obtain = async (id: string) => {
			check()
			const ready = children.get(id)
			if (ready) return ready
			let pending = loading.get(id)
			if (!pending) {
				pending = spec.backends[id].load!().then(child => { scope.add(child); check(); children.set(id, child); return child }).finally(() => loading.delete(id))
				loading.set(id, pending)
			}
			return pending
		}
		const childFor = (settings: TargetSettings) => { const child = children.get(spec.backend(settings)); if (!child) throw new Error('CPU backend is not prepared; await services.prepare(settings) first'); return child }
		const current = () => (program() && owners.get(program()!)) || children.get(spec.defaultBackend)
		return {
			isPrepared: settings => { const child = children.get(spec.backend(settings)); return !!child && (child.isPrepared?.(spec.backends[spec.backend(settings)].settings(settings)) ?? true) },
			async prepare(settings) { const id = spec.backend(settings), child = await obtain(id); await child.prepare?.(spec.backends[id].settings(settings)); check() },
			assemble(sources, settings) { const id = spec.backend(settings), child = childFor(settings), result = child.assemble(sources, spec.backends[id].settings(settings)); owners.set(result, child); return result },
			createMachine(program, settings, options) {
				const id = spec.backend(settings), child = childFor(settings), next = child.createMachine(program, spec.backends[id].settings(settings), options)
				if (loaded !== child) loaded?.releaseMachine()
				loaded = child; machine = next; owners.set(program, child)
				return next
			},
			profile: settings => childFor(settings).profile(spec.backends[spec.backend(settings)].settings(settings)),
			disassembly: { row: (row, next) => current()?.disassembly.row(row, next) ?? '', at: (memory, address) => current()?.disassembly.at(memory, address) ?? null },
			describeToken: (text, offset, state) => current()?.describeToken?.(text, offset, state) ?? null,
			get exportWords() { return current()?.exportWords ? (program: AssembledProgram) => owners.get(program)!.exportWords!(program) : undefined },
			installEditor(monaco, host) {
				const editors = new Map<string, Promise<import('../architectures/contracts').Disposable>>()
				return lazyLanguageProviders(monaco, Object.entries(spec.backends).flatMap(([id, backend]) => backend.languages.map(language => ({ id: language, load: () => {
					let pending = editors.get(id)
					if (!pending) { pending = obtain(id).then(child => child.installEditor(monaco, host)); editors.set(id, pending) }
					return pending
				} }))))
			},
		}
	}, { variant: spec.variant })
	const release = services.releaseMachine.bind(services), dispose = services.dispose.bind(services)
	services.releaseMachine = expected => { if (expected && expected !== machine) return; release(expected); for (const child of children.values()) child.releaseMachine(); loaded = machine = undefined }
	services.dispose = () => { try { dispose() } finally { scope.dispose() } }
	return services
}
