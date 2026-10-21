import type { ArchitectureServices, Disposable, Machine } from '../architectures/contracts'
import type { TargetSettings } from './settings'
import { DisposableScope } from './disposableScope'

type ServiceImplementation<Settings extends TargetSettings> = Omit<ArchitectureServices<Settings>, 'dispose' | 'installEditor'> & {
	installEditor(...args: Parameters<ArchitectureServices<Settings>['installEditor']>): Disposable | Promise<Disposable>
}

/** Architecture modules supply factories and configuration; ownership is shared. */
export function createArchitectureServices<Settings extends TargetSettings>(
	build: (lifetime: { check(): void }) => ServiceImplementation<Settings>,
): ArchitectureServices<Settings> {
	const editors = new DisposableScope()
	let machine: Machine | undefined
	let disposed = false
	const check = () => {
		if (disposed) throw new Error('Architecture services have been disposed')
	}
	const implementation = build({ check })
	// Preserve getters such as disassembly following the latest assembled CPU variant.
	const services = Object.create(Object.getPrototypeOf(implementation), Object.getOwnPropertyDescriptors(implementation)) as ArchitectureServices<Settings>
	services.assemble = (sources, settings) => {
		check()
		return implementation.assemble(sources, settings)
	}
	services.createMachine = (program, settings, options) => {
		check()
		const next = implementation.createMachine(program, settings, options)
		try { check() } catch (error) { next.dispose(); throw error }
		const previous = machine
		machine = next
		previous?.dispose()
		return next
	}
	services.installEditor = async (monaco, host): Promise<Disposable> => {
		check()
		const contribution = await implementation.installEditor(monaco, host)
		const owned = editors.add(contribution)
		check()
		return owned
	}
	services.dispose = () => {
		if (disposed) return
		disposed = true
		const previous = machine
		machine = undefined
		try { previous?.dispose() } finally { editors.dispose() }
	}
	return services
}
