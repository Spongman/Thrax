import type { Disposable } from '../architectures/contracts'

/** Own resources once, release in reverse order, and clean up late arrivals. */
export class DisposableScope implements Disposable {
	private readonly resources = new Set<Disposable>()
	private closed = false
	get disposed() { return this.closed }

	add(resource: Disposable): Disposable {
		let active = true
		const owned = { dispose: () => {
			if (!active) return
			active = false
			this.resources.delete(owned)
			resource.dispose()
		} }
		if (this.closed) owned.dispose()
		else this.resources.add(owned)
		return owned
	}

	dispose() {
		if (this.closed) return
		this.closed = true
		const errors: unknown[] = []
		for (const resource of [...this.resources].reverse()) {
			try { resource.dispose() } catch (error) { errors.push(error) }
		}
		if (errors.length) throw new AggregateError(errors, 'Resource cleanup failed')
	}
}

/** Build several providers atomically; a failed registration releases earlier ones. */
export function disposableGroup(build: (scope: DisposableScope) => void): Disposable {
	const scope = new DisposableScope()
	try { build(scope) } catch (error) { scope.dispose(); throw error }
	return scope
}
