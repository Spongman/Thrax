import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_MIPS_SETTINGS } from './mips/settings'
import type { ArchitectureDefinition } from './contracts'
import { architectureManifests, createArchitectureRegistry, initializeArchitecture } from './registry'

function moduleFor(id: string, dispose = vi.fn()) {
	return { default: {
		id, name: id, registers: [], examples: {}, settings: { defaults: {}, fields: [] },
		createServices: () => ({ value: id, dispose }),
	} }
}

describe('architecture activation', () => {
	it('keeps the old activation usable when loading a replacement fails', async () => {
		const registry = createArchitectureRegistry<{ value: string }>({
			first: async () => moduleFor('first'),
			broken: async () => { throw new Error('load failed') },
		})
		const first = await registry.activate('first')
		await expect(registry.activate('broken')).rejects.toThrow('load failed')
		expect(registry.current()).toBe(first)
		expect(first.isCurrent()).toBe(true)
	})

	it('disposes previous contributions exactly once and invalidates callbacks', async () => {
		const dispose = vi.fn()
		const registry = createArchitectureRegistry<{ value: string }>({
			first: async () => moduleFor('first', dispose),
			second: async () => moduleFor('second'),
		})
		const first = await registry.activate('first')
		const second = await registry.activate('second')
		first.dispose()
		expect(dispose).toHaveBeenCalledTimes(1)
		expect(first.isCurrent()).toBe(false)
		expect(second.isCurrent()).toBe(true)
		registry.dispose()
		expect(second.isCurrent()).toBe(false)
		expect(() => registry.current()).toThrow('not been initialized')
	})

	it('rejects an older load that finishes after the latest selection', async () => {
		let finish!: (module: { default: ArchitectureDefinition<{ value: string }> }) => void
		const registry = createArchitectureRegistry<{ value: string }>({
			slow: () => new Promise((resolve) => { finish = resolve }),
			fast: async () => moduleFor('fast'),
		})
		const slow = registry.activate('slow')
		const rejected = expect(slow).rejects.toThrow('superseded')
		await registry.activate('fast')
		finish(moduleFor('slow'))
		await rejected
		expect(registry.current().definition.id).toBe('fast')
	})

	it('cancels a pending load when the active architecture is chosen again', async () => {
		let finish!: (module: ReturnType<typeof moduleFor>) => void
		const registry = createArchitectureRegistry<{ value: string }>({
			first: async () => moduleFor('first'),
			slow: () => new Promise<ReturnType<typeof moduleFor>>((resolve) => { finish = resolve }),
		})
		const first = await registry.activate('first')
		const slow = registry.activate('slow')
		const rejected = expect(slow).rejects.toThrow('superseded')
		expect(await registry.activate('first')).toBe(first)
		finish(moduleFor('slow'))
		await rejected
		expect(registry.current()).toBe(first)
	})

	it('invalidates pending loads when disposed', async () => {
		let finish!: (module: ReturnType<typeof moduleFor>) => void
		const registry = createArchitectureRegistry<{ value: string }>({ slow: () => new Promise<ReturnType<typeof moduleFor>>((resolve) => { finish = resolve }) })
		const pending = registry.activate('slow')
		const rejected = expect(pending).rejects.toThrow('superseded')
		registry.dispose()
		finish(moduleFor('slow'))
		await rejected
	})

	it('validates module identity before creating services', async () => {
		const module = moduleFor('wrong')
		const registry = createArchitectureRegistry<{ value: string }>({ expected: async () => module })
		await expect(registry.activate('expected')).rejects.toThrow('Invalid architecture')
		await expect(registry.activate('missing')).rejects.toThrow('Unknown architecture')
	})

	it.each(['constructor', 'toString', '__proto__'])('rejects inherited catalog names such as %s without releasing the active CPU', async (id) => {
		const registry = createArchitectureRegistry<{ value: string }>({ first: async () => moduleFor('first') })
		const first = await registry.activate('first')
		await expect(registry.activate(id)).rejects.toThrow(`Unknown architecture: ${id}`)
		expect(registry.current()).toBe(first)
		expect(first.isCurrent()).toBe(true)
	})

	it('names in each manifest exactly the panels its definition contributes', async () => {
		const { default: mips } = await import('./mips')
		const manifest = architectureManifests().find((candidate) => candidate.id === mips.id)
		expect(manifest?.name).toBe(mips.name)
		expect(mips.panels?.map((panel) => panel.id)).toEqual(manifest?.panels)
	})

	it('initializes the bundled adapter once and retains synchronous assembly', async () => {
		const first = await initializeArchitecture()
		expect(await initializeArchitecture()).toBe(first)
		const result = first.services.assemble({ files: [{ name: 'main.asm', code: 'addi $t0, $zero, 5' }], entries: ['main.asm'] }, DEFAULT_MIPS_SETTINGS)
		expect(result.diagnostics).toEqual([])
		expect(first.services.exportWords?.(result)).toEqual([0x20080005])
	})
})
