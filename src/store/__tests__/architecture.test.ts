import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArchitectureDefinition } from '../../architectures/contracts'

/** Lets a test hold a load open until it says so. */
let releaseSlow: (() => void) | null = null

// A second target is MIPS under another id: switching is about what the
// workspace keeps and drops, not about what the target runs.
vi.mock('../../architectures/registry', async (importOriginal) => {
	const real = await importOriginal<typeof import('../../architectures/registry')>()
	const { default: mips } = await import('../../architectures/mips')
	const renamed = (id: string): { default: ArchitectureDefinition } => ({ default: { ...mips, id, name: id } })
	const catalog = {
		mips: async () => ({ default: mips }),
		other: async () => renamed('other'),
		slow: () => new Promise<{ default: ArchitectureDefinition }>((resolve) => { releaseSlow = () => resolve(renamed('slow')) }),
		broken: async (): Promise<{ default: ArchitectureDefinition }> => { throw new Error('load failed') },
	}
	return { ...real, ...real.createComposition(catalog), knownArchitectures: () => Object.keys(catalog) }
})

const { initializeArchitecture } = await import('../../architectures/registry')
const { useTHRAXStore } = await import('../thraxStore')

const state = () => useTHRAXStore.getState()

const PROGRAM = 'main:\n\taddi $t0, $zero, 5\n\taddi $t1, $zero, 7\n\tli $v0, 10\n\tsyscall\n'

beforeAll(async () => { await initializeArchitecture() })

beforeEach(async () => {
	await state().switchArchitecture('mips')
	state().reset()
	state().setCode(PROGRAM)
})

describe('switching architecture', () => {
	it('keeps the files and line breakpoints, and drops the machine and address breakpoints', async () => {
		state().assemble()
		state().toggleBreakpointLine('main.asm', 3)
		state().toggleBreakpointAddress(0x00400000)
		state().step()
		expect(state().instructionCount).toBe(1)

		expect(await state().switchArchitecture('other')).toBe(true)

		expect(state().architecture).toBe('other')
		expect(state().target?.definition.id).toBe('other')
		expect(state().code).toBe(PROGRAM)
		expect(state().hasMachine).toBe(false)
		expect(state().instructionCount).toBe(0)
		expect(state().executionHistory.length).toBe(0)
		expect(state().breakpointLines.get('main.asm')).toEqual(new Set([3]))
		expect(state().breakpointAddresses.size).toBe(0)
		// The workspace is saved for the target it now has.
		expect(state().workspaceSnapshot().architecture).toBe('other')

		// The next build resolves the kept line breakpoint again.
		state().assemble()
		expect(state().breakpoints.size).toBe(1)
	})

	it('keeps the active target when the new one fails to load', async () => {
		state().assemble()
		const before = state().target

		expect(await state().switchArchitecture('broken')).toBe(false)

		expect(state().target).toBe(before)
		expect(state().architecture).toBe('mips')
		expect(state().diagnostics.some((diagnostic) => diagnostic.message.includes('load failed'))).toBe(true)
	})

	it('refuses an id the catalog does not have', async () => {
		expect(await state().switchArchitecture('z80')).toBe(false)
		expect(state().architecture).toBe('mips')
		expect(state().diagnostics.some((diagnostic) => diagnostic.message.includes("'z80'"))).toBe(true)
	})

	it('lets a later request win over a load that finishes after it', async () => {
		const slow = state().switchArchitecture('slow')
		expect(await state().switchArchitecture('other')).toBe(true)
		releaseSlow?.()

		// The superseded load reports nothing and changes nothing.
		expect(await slow).toBe(false)
		expect(state().architecture).toBe('other')
		expect(state().target?.definition.id).toBe('other')
		expect(state().diagnostics).toEqual([])
	})

	it('stops a run in progress before the new target takes over', async () => {
		state().setSetting('backstepLimit', 1000)
		state().setCode('loop:\n\tj loop\n')
		const running = state().run()
		expect(await state().switchArchitecture('other')).toBe(true)
		await running
		expect(state().isRunning).toBe(false)
		expect(state().hasMachine).toBe(false)
	})
})
