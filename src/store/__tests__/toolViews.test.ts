import { beforeAll as beforeArchitectureTests } from 'vitest'
import { initializeArchitecture } from '../../architectures/registry'
beforeArchitectureTests(async () => { await initializeArchitecture() })
import { describe, expect, it } from 'vitest'
import { DEFAULT_MEMORY_REFERENCE_SETTINGS } from '../../tools/memoryReference'

const storage = new Map<string, string>()

// The store reads its settings while it is being created, so storage has to
// answer before the module is imported.
Object.defineProperty(globalThis, 'window', {
	value: {
		localStorage: {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => { storage.set(key, value) },
		},
	},
	writable: true,
})

const { useTHRAXStore } = await import('../thraxStore')

const PROGRAM = `
	.data
data:	.word 0
	.text
	la $t0, data
	li $t1, 7
	sw $t1, 0($t0)
	lw $t2, 0($t0)
	li $v0, 10
	syscall
`

/**
 * A tool runs only while something is consuming it, so a test that reads one
 * has to open its panel first, exactly as the workspace does.
 */
const view = (key: string) => (useTHRAXStore.getState() as unknown as Record<string, { [field: string]: unknown }>)[key]
const open = (...ids: string[]) => useTHRAXStore.getState().setOpenPanels(ids)

describe('ported tool views', () => {
	it('seeds every ported tool snapshot and its settings', () => {
		const state = useTHRAXStore.getState()
		expect(state.memoryReference.counts).toHaveLength(256)
		expect(state.memoryReferenceSettings).toEqual(DEFAULT_MEMORY_REFERENCE_SETTINGS)
		expect(view('marsBot').segments).toEqual([])
		expect(view('scavengerHunt').players).toHaveLength(22)
	})

	it('publishes the memory reference readings a run takes', async () => {
		open('memoryReference')
		useTHRAXStore.getState().setCode(PROGRAM)
		useTHRAXStore.getState().assemble()
		await useTHRAXStore.getState().run()

		// The store and the load both land in the grid's first cell.
		expect(useTHRAXStore.getState().memoryReference.counts[0]).toBe(2)
		expect(useTHRAXStore.getState().memoryReference.max).toBe(2)
	})

	it('publishes what an MMIO device tool sees a run write', async () => {
		open('marsBot')
		// 0xffff8010 does not fit a signed 16-bit sw offset, so build it in a register.
		useTHRAXStore.getState().setCode(`
			li $t0, 90
			lui $t1, 0xffff
			ori $t1, $t1, 0x8010
			sw $t0, 0($t1)
			li $v0, 10
			syscall
		`)
		useTHRAXStore.getState().assemble()
		await useTHRAXStore.getState().run()

		expect(view('marsBot').heading).toBe(90)
	})

	it('round-trips the memory reference settings through the store and its key', () => {
		const settings = { ...DEFAULT_MEMORY_REFERENCE_SETTINGS, rows: 4, columns: 8, wordsPerUnit: 2 }
		useTHRAXStore.getState().setMemoryReferenceSettings(settings)

		expect(useTHRAXStore.getState().memoryReferenceSettings).toEqual(settings)
		// Resizing the grid clears it, so the panel sees the grid it asked for.
		expect(useTHRAXStore.getState().memoryReference.counts).toHaveLength(32)
		expect(JSON.parse(storage.get('thrax-web.settings.tools.memoryReference')!)).toEqual(settings)
	})
})
