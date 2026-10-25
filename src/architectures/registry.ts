import type * as Monaco from 'monaco-editor'
import { DEFAULT_ARCHITECTURE } from '../services/workspace'
import type { ArchitectureActivation, ArchitectureDefinition, ArchitectureServices, Disposable, EditorHost } from './contracts'
import { manifest as armv8Manifest } from './armv8/manifest'
import { manifest as avrManifest } from './avr/manifest'
import { manifest as betaManifest } from './beta/manifest'
import { manifest as m68kManifest } from './m68k/manifest'
import { manifest as mipsManifest } from './mips/manifest'
import { manifest as mos6502Manifest } from './mos6502/manifest'
import { manifest as riscvManifest } from './riscv/manifest'
import { manifest as z80Manifest } from './z80/manifest'
import { manifest as m6800Manifest } from './m6800/manifest'
import { manifest as i8051Manifest } from './i8051/manifest'
import { manifest as powerpcManifest } from './powerpc/manifest'
import { manifest as alphaManifest } from './alpha/manifest'
import { manifest as i8086Manifest } from './i8086/manifest'
import { manifest as tms9900Manifest } from './tms9900/manifest'
import { manifest as sparcManifest } from './sparc/manifest'
import { manifest as shManifest } from './sh/manifest'
import { manifest as pdp11Manifest } from './pdp11/manifest'
import type { TargetSettings } from '../core/settings'

export type TargetSettingsSelector = (definition: ArchitectureDefinition<unknown>) => TargetSettings
type PreparedServices = Disposable & { prepare?(settings: TargetSettings): Promise<void> }

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
	/** Who designed it, shown beside the name. */
	maker?: string
	/** The native profile selected before any per-family preference is saved. */
	defaultVariant?: string
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
	avr: () => import('./avr'),
	riscv: () => import('./riscv'),
	m68k: () => import('./m68k'),
	m6800: () => import('./m6800'),
	i8051: () => import('./i8051'),
	powerpc: () => import('./powerpc'),
	alpha: () => import('./alpha'),
	i8086: () => import('./i8086'),
	tms9900: () => import('./tms9900'),
	sparc: () => import('./sparc'),
	sh: () => import('./sh'),
	pdp11: () => import('./pdp11'),
}

const manifests: Readonly<Record<string, ArchitectureManifest>> = {
	mips: mipsManifest,
	beta: betaManifest,
	mos6502: mos6502Manifest,
	z80: z80Manifest,
	armv8: armv8Manifest,
	avr: avrManifest,
	riscv: riscvManifest,
	m68k: m68kManifest,
	m6800: m6800Manifest,
	i8051: i8051Manifest,
	powerpc: powerpcManifest,
	alpha: alphaManifest,
	i8086: i8086Manifest,
	tms9900: tms9900Manifest,
	sparc: sparcManifest,
	sh: shManifest,
	pdp11: pdp11Manifest,
}

/** Ids of every architecture the catalog can load. */
export const knownArchitectures = (): string[] => Object.keys(loaders)

/** Legacy saved targets move to family selectors; all CPU wiring stays here. */
export function architectureSelection(id: string, settings: TargetSettings = {}) {
	const aliases: Record<string, { id: string, defaults: TargetSettings, rename?: readonly [string, string] }> = {
		arm26: { id: 'armv8', defaults: { executionState: 'arm3' }, rename: ['cpuModel', 'executionState'] },
		w65816: { id: 'mos6502', defaults: { cpuModel: 'w65816' } },
	}
	const alias = aliases[id]
	if (!alias) return { id, settings }
	const migrated = { ...settings, ...alias.defaults }
	if (alias.rename && settings[alias.rename[0]] !== undefined) migrated[alias.rename[1]] = settings[alias.rename[0]]
	return { id: alias.id, settings: migrated }
}

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
		async activate(id: string, selectSettings?: TargetSettingsSelector): Promise<ArchitectureActivation<Services>> {
			const request = ++generation
			// Choosing the target in force again cancels a load in progress, and nothing more.
			if (active?.definition.id === id) return active
			const load = Object.prototype.hasOwnProperty.call(catalog, id) ? catalog[id] : undefined
			if (!load) throw new Error(`Unknown architecture: ${id}`)
			const { default: definition } = await load()
			if (request !== generation) throw new ActivationSuperseded()
			if (definition.id !== id || !definition.name || typeof definition.createServices !== 'function') {
				throw new Error(`Invalid architecture module: ${id}`)
			}
			const ids = definition.registers.map((register) => register.id)
			if (new Set(ids).size !== ids.length) throw new Error(`Duplicate register IDs: ${id}`)
			const services: Services & PreparedServices = definition.createServices()
			try {
				await services.prepare?.(selectSettings?.(definition) ?? definition.settings.defaults)
				if (request !== generation) throw new ActivationSuperseded()
			} catch (error) {
				services.dispose()
				throw error
			}
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
		initializeArchitecture(id = DEFAULT_ARCHITECTURE, selectSettings?: TargetSettingsSelector) {
			initialization ??= registry.activate(id, selectSettings).catch((error: unknown) => {
				initialization = undefined
				throw error
			})
			return initialization
		},

		/**
		 * Replaces the active architecture.  Rejects when superseded by a later
		 * request; the previous activation stays in force when loading fails.
		 */
		async activateArchitecture(id: string, selectSettings?: TargetSettingsSelector) {
			const activation = await registry.activate(id, selectSettings)
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
