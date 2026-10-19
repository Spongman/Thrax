import type * as Monaco from 'monaco-editor'
import { DEFAULT_ARCHITECTURE } from '../services/workspace'
import type { ArchitectureActivation, ArchitectureDefinition, ArchitectureServices, Disposable, EditorHost } from './contracts'
import { manifest as armv8Manifest } from './armv8/manifest'
import { manifest as betaManifest } from './beta/manifest'
import { manifest as mipsManifest } from './mips/manifest'
import { manifest as mos6502Manifest } from './mos6502/manifest'
import { manifest as z80Manifest } from './z80/manifest'

/** A later request replaced this one before it could commit. */
export class ActivationSuperseded extends Error {
	constructor() {
		super('Architecture activation superseded')
	}
}

type Loader<Services> = () => Promise<{ default: ArchitectureDefinition<Services> }>

/** What is known of an architecture before it loads. */
export interface ArchitectureManifest {
	id: string
	name: string
	/** Ids of the panels its definition contributes. */
	panels: readonly string[]
	/** Source file extensions beyond the shared defaults. */
	fileExtensions?: readonly string[]
}

/** The only common-code location that imports concrete architectures. */
const loaders: Record<string, Loader<ArchitectureServices>> = {
	mips: () => import('./mips'),
	beta: () => import('./beta'),
	mos6502: () => import('./mos6502'),
	z80: () => import('./z80'),
	armv8: () => import('./armv8'),
}

const manifests: Readonly<Record<string, ArchitectureManifest>> = {
	mips: mipsManifest,
	beta: betaManifest,
	mos6502: mos6502Manifest,
	z80: z80Manifest,
	armv8: armv8Manifest,
}

/** Ids of every architecture the catalog can load. */
export const knownArchitectures = (): string[] => Object.keys(loaders)

export const architectureManifests = (): readonly ArchitectureManifest[] => Object.values(manifests)

/** Every panel id some architecture contributes, loaded or not. */
export const contributedPanelIds = (): ReadonlySet<string> => new Set(architectureManifests().flatMap((manifest) => manifest.panels))

/** Stages a replacement before releasing the active services. */
export function createArchitectureRegistry<Services>(catalog: Readonly<Record<string, Loader<Services>>>) {
	let generation = 0
	let active: ArchitectureActivation<Services> | undefined
	const listeners = new Set<(activation: ArchitectureActivation<Services>) => void>()
	return {
		current() {
			if (!active) throw new Error('Architecture has not been initialized')
			return active
		},
		/** The active one, or undefined before the first activation. */
		peek: () => active,
		/** Hears every committed activation; returns the way to stop. */
		subscribe(listener: (activation: ArchitectureActivation<Services>) => void): () => void {
			listeners.add(listener)
			return () => { listeners.delete(listener) }
		},
		async activate(id: string): Promise<ArchitectureActivation<Services>> {
			const request = ++generation
			// Choosing the target in force again cancels a load in progress, and nothing more.
			if (active?.definition.id === id) return active
			const load = catalog[id]
			if (!load) throw new Error(`Unknown architecture: ${id}`)
			const { default: definition } = await load()
			if (request !== generation) throw new ActivationSuperseded()
			if (definition.id !== id || !definition.name || typeof definition.createServices !== 'function') {
				throw new Error(`Invalid architecture module: ${id}`)
			}
			const ids = definition.registers.map((register) => register.id)
			if (new Set(ids).size !== ids.length) throw new Error(`Duplicate register IDs: ${id}`)
			const services = definition.createServices()
			let disposed = false
			const next: ArchitectureActivation<Services> = {
				definition,
				services,
				isCurrent: () => active === next && !disposed,
				dispose() {
					if (disposed) return
					disposed = true
					if (active === next) active = undefined
					services.dispose()
				},
			}
			const previous = active
			active = next
			previous?.dispose()
			for (const listener of listeners) listener(next)
			return next
		},
		dispose() {
			generation++
			active?.dispose()
		},
	}
}

/**
 * The app-facing operations over one catalog.  The app uses the catalog
 * above; tests compose their own to exercise switching.
 */
export function createComposition(catalog: Readonly<Record<string, Loader<ArchitectureServices>>>) {
	const registry = createArchitectureRegistry(catalog)
	let initialization: Promise<ArchitectureActivation> | undefined

	return {
		/** Application startup and store tests explicitly await this before assembling. */
		initializeArchitecture(id = DEFAULT_ARCHITECTURE) {
			initialization ??= registry.activate(id).catch((error: unknown) => {
				initialization = undefined
				throw error
			})
			return initialization
		},

		/**
		 * Replaces the active architecture.  Rejects when superseded by a later
		 * request; the previous activation stays in force when loading fails.
		 */
		async activateArchitecture(id: string) {
			const activation = await registry.activate(id)
			initialization = Promise.resolve(activation)
			return activation
		},

		activeArchitecture: () => registry.current(),
		peekArchitecture: () => registry.peek(),
		onArchitectureActivated: (listener: (activation: ArchitectureActivation) => void) => registry.subscribe(listener),

		/**
		 * Connects the editor once; every activation from then on installs its own
		 * language support, released with the activation.
		 */
		connectEditor(monaco: typeof Monaco, host: EditorHost): Promise<Disposable | undefined> {
			const install = async (activation: ArchitectureActivation) => {
				if (!activation.isCurrent()) return undefined
				return activation.services.installEditor(monaco, host)
			}
			registry.subscribe((activation) => {
				install(activation).catch((error: unknown) => {
					// A replaced activation refuses to install; only the current one matters.
					if (activation.isCurrent()) console.error(error)
				})
			})
			const current = registry.peek()
			return current ? install(current) : Promise.resolve(undefined)
		},
	}
}

export const {
	initializeArchitecture,
	activateArchitecture,
	activeArchitecture,
	peekArchitecture,
	onArchitectureActivated,
	connectEditor,
} = createComposition(loaders)
