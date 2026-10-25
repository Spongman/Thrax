import type { ArchitectureServices, AssembledProgram, Disposable, Machine } from '../architectures/contracts'
import type { TargetSettings } from './settings'
import { DisposableScope } from './disposableScope'
import { hasErrors } from './diagnostics'

type ServiceImplementation<Settings extends TargetSettings> = Omit<ArchitectureServices<Settings>, 'dispose' | 'installEditor' | 'releaseMachine'> & {
	installEditor(...args: Parameters<ArchitectureServices<Settings>['installEditor']>): Disposable | Promise<Disposable>
}

interface ProgramCompatibility<Settings> {
	variant(settings: Settings): string
	/** Native programs assembled outside this service may carry their own model. */
	programVariant?(program: AssembledProgram): string
}

// Weak identity also works when an assembly is loaded through another service.
const programVariants = new WeakMap<AssembledProgram, string>()

function disposeMachine(machine: Machine | undefined) {
	if (!machine) return
	machine.onProgress = null
	try { machine.stop() } finally { machine.dispose() }
}

/** Architecture modules supply factories and configuration; ownership is shared. */
export function createArchitectureServices<Settings extends TargetSettings>(
	build: (lifetime: { check(): void, program(): AssembledProgram | null, onRelease(callback: () => void): void }) => ServiceImplementation<Settings>,
	compatibility?: ProgramCompatibility<Settings>,
): ArchitectureServices<Settings> {
	const editors = new DisposableScope()
	let machine: Machine | undefined
	let disposed = false
	let loaded: AssembledProgram | null = null
	let preview: AssembledProgram | null = null
	const releaseCallbacks: (() => void)[] = []
	const check = () => {
		if (disposed) throw new Error('Architecture services have been disposed')
	}
	const implementation = build({ check, program: () => loaded ?? preview, onRelease: callback => { releaseCallbacks.push(callback) } })
	// Preserve native getters while shared ownership selects the inspection program.
	const services = Object.create(Object.getPrototypeOf(implementation), Object.getOwnPropertyDescriptors(implementation)) as ArchitectureServices<Settings>
	services.assemble = (sources, settings) => {
		check()
		const program = implementation.assemble(sources, settings)
		if (compatibility) programVariants.set(program, compatibility.variant(settings))
		if (!hasErrors(program.diagnostics)) preview = program
		return program
	}
	if (implementation.prepare) services.prepare = async settings => {
		check()
		await implementation.prepare!(settings)
		check()
	}
	services.createMachine = (program, settings, options) => {
		check()
		if (hasErrors(program.diagnostics)) throw new Error('Cannot load a program with assembly errors')
		if (compatibility) {
			const assembledVariant = programVariants.get(program) ?? compatibility.programVariant?.(program)
			const requestedVariant = compatibility.variant(settings)
			if (assembledVariant !== undefined && assembledVariant !== requestedVariant) {
				throw new Error(`Program assembled for ${assembledVariant} cannot run as ${requestedVariant}; reassemble for the selected CPU`)
			}
		}
		const next = implementation.createMachine(program, settings, options)
		try { check() } catch (error) { next.dispose(); throw error }
		const previous = machine
		machine = next
		loaded = program
		disposeMachine(previous)
		return next
	}
	services.installEditor = async (monaco, host): Promise<Disposable> => {
		check()
		const contribution = await implementation.installEditor(monaco, host)
		const owned = editors.add(contribution)
		check()
		return owned
	}
	services.releaseMachine = expected => {
		if (expected && machine !== expected) return
		loaded = preview = null
		const previous = machine
		machine = undefined
		try { disposeMachine(previous) } finally { for (const callback of releaseCallbacks) callback() }
	}
	services.dispose = () => {
		if (disposed) return
		disposed = true
		try { services.releaseMachine() } finally { editors.dispose() }
	}
	return services
}
