/**
 * Switching between the real MIPS and Beta targets while the workspace is
 * busy: running, waiting for input, loading, or after a failure.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArchitectureDefinition, Machine } from '../../architectures/contracts'

const tracker = vi.hoisted(() => ({
	/** Every machine an activation created, with the id it was created under. */
	machines: [] as { id: string, machine: Machine }[],
	/** Ids of the services disposed, in order. */
	disposed: [] as string[],
	/** Ids whose services were created. */
	created: [] as string[],
	/** Loads held open until the test releases them. */
	release: new Map<string, () => void>(),
	/** How many more times the flaky load fails. */
	flakyFailures: 0,
	/** Editor registrations not yet disposed. */
	live: new Set<object>(),
}))

// Just enough of Monaco for both editor integrations to install and dispose.
vi.mock('monaco-editor', () => {
	const disposable = () => {
		const handle = { dispose: () => { tracker.live.delete(handle) } }
		tracker.live.add(handle)
		return handle
	}
	const languages = {
		register: () => {},
		setLanguageConfiguration: disposable,
		setMonarchTokensProvider: disposable,
		registerCompletionItemProvider: disposable,
		registerHoverProvider: disposable,
		registerDefinitionProvider: disposable,
		CompletionItemKind: { Function: 1, Variable: 4, Keyword: 17, Snippet: 27 },
	}
	const editor = { registerEditorOpener: disposable, getModel: () => null, getModels: () => [], createModel: () => null }
	class Range { constructor(...args: number[]) { Object.assign(this, args) } }
	return { languages, editor, Range, Uri: { from: () => ({}) } }
})

vi.mock('../../architectures/registry', async (importOriginal) => {
	const real = await importOriginal<typeof import('../../architectures/registry')>()
	const { default: mips } = await import('../../architectures/mips')
	const { default: beta } = await import('../../architectures/beta')
	/** `definition` under `id`, reporting the machines and disposals of its services. */
	const tracked = (definition: ArchitectureDefinition, id = definition.id): { default: ArchitectureDefinition } => ({ default: {
		...definition,
		id,
		createServices() {
			tracker.created.push(id)
			const services = definition.createServices()
			return {
				...services,
				createMachine(...args) {
					const machine = services.createMachine(...args)
					tracker.machines.push({ id, machine })
					return machine
				},
				dispose() {
					tracker.disposed.push(id)
					services.dispose()
				},
			}
		},
	} })
	const held = (definition: ArchitectureDefinition, id: string) => () =>
		new Promise<{ default: ArchitectureDefinition }>((resolve) => { tracker.release.set(id, () => resolve(tracked(definition, id))) })
	const catalog = {
		mips: async () => tracked(mips),
		beta: async () => tracked(beta),
		slowBeta: held(beta, 'slowBeta'),
		slowMips: held(mips, 'slowMips'),
		flaky: async () => {
			if (tracker.flakyFailures-- > 0) throw new Error('network error')
			return tracked(beta, 'flaky')
		},
	}
	return { ...real, ...real.createComposition(catalog), knownArchitectures: () => Object.keys(catalog) }
})

/** Timers the machines started and have not yet fired or cleared. */
const machineTimers = new Set<unknown>()
const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
const fromMachine = () => /simulator\.ts|runtime\.ts/.test(new Error().stack ?? '')
globalThis.setTimeout = ((callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
	const owned = fromMachine()
	const handle: unknown = realSetTimeout(() => {
		machineTimers.delete(handle)
		callback(...args)
	}, ms)
	if (owned) machineTimers.add(handle)
	return handle
}) as typeof setTimeout
globalThis.clearTimeout = ((handle: Parameters<typeof clearTimeout>[0]) => {
	machineTimers.delete(handle)
	realClearTimeout(handle)
}) as typeof clearTimeout

const { connectEditor, initializeArchitecture } = await import('../../architectures/registry')
const { useTHRAXStore } = await import('../thraxStore')

const state = () => useTHRAXStore.getState()
const sleep = (ms: number) => new Promise((resolve) => realSetTimeout(resolve, ms))
const lastMachine = () => tracker.machines[tracker.machines.length - 1]
const errors = () => state().diagnostics.filter((diagnostic) => diagnostic.severity === 'error')

const MIPS_LOOP = 'main:\n\taddi $t0, $t0, 1\n\tj main\n'
const MIPS_READ_INT = 'main:\n\tli $v0, 5\n\tsyscall\n\tli $v0, 10\n\tsyscall\n'
const MIPS_FAULT = 'main:\n\tlw $t0, 1($zero)\n\tli $v0, 10\n\tsyscall\n'
const MIPS_EXIT = 'main:\n\taddi $t0, $zero, 5\n\n\taddi $t1, $zero, 7\n\tli $v0, 10\n\tsyscall\n'
const BETA_LOOP = '.include "beta.uasm"\nloop:\n\tADDC(R1, 1, R1)\n\tBR(loop)\n'
const BETA_FAULT = '.include "beta.uasm"\n\tLD(R31, 2, R0)\n\tHALT()\n'
// Line 3 is blank, so a breakpoint there belongs to line 4.
const BETA_PROGRAM = '.include "beta.uasm"\n\tCMOVE(5, R1)\n\n\tCMOVE(7, R2)\n\tADD(R1, R2, R3)\n\tHALT()\n'

/** What installing the editor for the active target left registered. */
const editorRegistrations = () => new Set(tracker.live)

beforeAll(async () => {
	await initializeArchitecture('mips')
	await connectEditor((await import('monaco-editor')) as never, {
		files: () => state().workspaceSnapshot().files,
		active: () => state().workspaceSnapshot().active,
		open: () => {},
		inspection: () => ({ registers: state().registers, memory: state().memory, labels: state().labels }),
	})
})

beforeEach(async () => {
	for (const release of tracker.release.values()) release()
	tracker.release.clear()
	await state().switchArchitecture('mips')
	state().setRunSpeed(null)
	state().reset()
	state().setOpenPanels([])
	state().setCode(MIPS_EXIT)
	tracker.flakyFailures = 0
})

afterEach(async () => {
	// Whatever a test left running must have been stopped by the switch it made.
	await sleep(0)
})

describe('architecture lifecycle', () => {
	it('switches MIPS to Beta to MIPS mid-run, stopping each machine and its timers', async () => {
		// Paced, so each run yields to timers and is still going when the switch comes.
		state().setRunSpeed(30000)
		state().setCode(MIPS_LOOP)
		const mipsRun = state().run()
		await sleep(40)
		const mips = lastMachine()
		expect(mips.id).toBe('mips')
		expect(state().isRunning).toBe(true)
		expect(mips.machine.instructionCount).toBeGreaterThan(0)

		expect(await state().switchArchitecture('beta')).toBe(true)
		await mipsRun
		expect(state().architecture).toBe('beta')
		expect(state().isRunning).toBe(false)
		expect(state().hasMachine).toBe(false)
		expect(tracker.disposed[tracker.disposed.length - 1]).toBe('mips')
		expect(mips.machine.observers).toEqual([])

		state().setCode(BETA_LOOP)
		const betaRun = state().run()
		await sleep(40)
		const beta = lastMachine()
		expect(beta.id).toBe('beta')
		expect(beta.machine.instructionCount).toBeGreaterThan(0)
		expect(state().isRunning).toBe(true)

		expect(await state().switchArchitecture('mips')).toBe(true)
		await betaRun
		expect(state().architecture).toBe('mips')
		expect(tracker.disposed[tracker.disposed.length - 1]).toBe('beta')

		// Neither machine moves again, and nothing either scheduled is still pending.
		const counts = [mips.machine.instructionCount, beta.machine.instructionCount]
		await sleep(80)
		expect([mips.machine.instructionCount, beta.machine.instructionCount]).toEqual(counts)
		expect(machineTimers.size).toBe(0)
		// A late progress callback from either run does not light the new workspace.
		expect(state().isRunning).toBe(false)
		expect(state().hasMachine).toBe(false)

		// The returning target runs normally.
		state().setRunSpeed(null)
		state().setCode(MIPS_EXIT)
		await state().run()
		expect(state().halted).toBe(true)
		expect(state().registers.$t1).toBe(7)
	})

	it('publishes nothing from a control still in flight when the target changes', async () => {
		state().setRunSpeed(30000)
		state().setCode(MIPS_LOOP)
		state().assemble()
		const running = state().runToAddress(0x00400100)
		await sleep(20)
		expect(state().isRunning).toBe(true)

		expect(await state().switchArchitecture('beta')).toBe(true)
		await running
		expect(state().isRunning).toBe(false)
		expect(state().isPaused).toBe(false)
		expect(state().hasMachine).toBe(false)
	})

	it('disposes the editor contributions of each target it leaves', async () => {
		await vi.waitFor(() => expect(tracker.live.size).toBeGreaterThan(0))
		const mips = editorRegistrations()

		expect(await state().switchArchitecture('beta')).toBe(true)
		await vi.waitFor(() => expect([...tracker.live].some((handle) => !mips.has(handle))).toBe(true))
		const beta = editorRegistrations()
		for (const handle of mips) expect(tracker.live.has(handle)).toBe(false)

		expect(await state().switchArchitecture('mips')).toBe(true)
		await vi.waitFor(() => expect(tracker.live.size).toBe(mips.size))
		for (const handle of beta) expect(tracker.live.has(handle)).toBe(false)

		// Leaving before an install finishes leaves nothing of it behind.
		expect(await state().switchArchitecture('beta')).toBe(true)
		expect(await state().switchArchitecture('mips')).toBe(true)
		await sleep(20)
		expect(tracker.live.size).toBe(mips.size)
	})

	it('drops a MIPS syscall read and a Beta RDCHAR wait when the target changes', async () => {
		state().setCode(MIPS_READ_INT)
		await state().run()
		expect(state().pendingInput?.type).toBe('integer')
		const mips = lastMachine().machine

		expect(await state().switchArchitecture('beta')).toBe(true)
		expect(state().pendingInput).toBeNull()
		expect(mips.pendingInput).toBeNull()
		// Input typed for the old request reaches nothing.
		await state().submitInput('42')
		expect(state().hasMachine).toBe(false)
		expect(mips.registerValues().$v0).not.toBe(42)

		state().setCode(state().target!.definition.examples.input.code)
		await state().run()
		expect(state().pendingInput).not.toBeNull()
		const beta = lastMachine().machine

		expect(await state().switchArchitecture('mips')).toBe(true)
		expect(state().pendingInput).toBeNull()
		expect(beta.pendingInput).toBeNull()
		await state().submitInput('hello')
		expect(state().console).toBe('')
		expect(beta.console).toBe('')

		// Both still read input once they are the target again.
		state().setCode(MIPS_READ_INT)
		await state().run()
		await state().submitInput('42')
		expect(state().registers.$v0).toBe(10)
		expect(state().halted).toBe(true)

		expect(await state().switchArchitecture('beta')).toBe(true)
		state().setCode(state().target!.definition.examples.input.code)
		await state().run()
		await state().submitInput('hi')
		expect(state().console).toBe('hi\n')
	})

	it('ignores a slow load superseded by returning to the active target', async () => {
		state().assemble()
		const slow = state().switchArchitecture('slowBeta')
		expect(await state().switchArchitecture('mips')).toBe(true)
		// The view agrees with the machine the first request stopped.
		expect(state().halted).toBe(lastMachine().machine.halted)

		// Work done on the target that was kept.
		state().assemble()
		state().toggleBreakpointAddress(0x00400004)
		state().step()
		expect(state().instructionCount).toBe(1)

		tracker.release.get('slowBeta')!()
		expect(await slow).toBe(false)
		expect(state().architecture).toBe('mips')
		expect(state().target?.definition.id).toBe('mips')
		expect(state().instructionCount).toBe(1)
		expect(state().hasMachine).toBe(true)
		expect(state().breakpointAddresses.has(0x00400004)).toBe(true)
		expect(tracker.created).not.toContain('slowBeta')
	})

	it('ignores a slow load superseded by another target, without creating its services', async () => {
		const slow = state().switchArchitecture('slowMips')
		expect(await state().switchArchitecture('beta')).toBe(true)
		state().setCode(BETA_PROGRAM)
		state().assemble()
		expect(errors()).toEqual([])

		tracker.release.get('slowMips')!()
		expect(await slow).toBe(false)
		expect(state().architecture).toBe('beta')
		expect(state().hasMachine).toBe(true)
		expect(state().diagnostics).toEqual([])
		expect(tracker.created).not.toContain('slowMips')
	})

	it('stops the old run as soon as a slow load is asked for', async () => {
		state().setRunSpeed(30000)
		state().setCode(MIPS_LOOP)
		const running = state().run()
		await sleep(20)
		const slow = state().switchArchitecture('slowBeta')
		await running
		expect(state().isRunning).toBe(false)
		// Still the old target until the load commits.
		expect(state().architecture).toBe('mips')

		tracker.release.get('slowBeta')!()
		expect(await slow).toBe(true)
		expect(state().architecture).toBe('slowBeta')
		expect(machineTimers.size).toBe(0)
	})

	it('leaves no diagnostics from the old target after an assembly failure', async () => {
		state().setCode('main:\n\tbogus $t0\n')
		state().assemble()
		expect(errors().length).toBeGreaterThan(0)

		expect(await state().switchArchitecture('beta')).toBe(true)
		expect(state().diagnostics).toEqual([])

		state().setCode('.include "beta.uasm"\n\tNOSUCH(R1)\n')
		state().assemble()
		expect(errors().length).toBeGreaterThan(0)

		expect(await state().switchArchitecture('mips')).toBe(true)
		expect(state().diagnostics).toEqual([])
		state().setCode(MIPS_EXIT)
		await state().run()
		expect(errors()).toEqual([])
		expect(state().halted).toBe(true)
	})

	it('starts clean after a runtime fault on either target', async () => {
		state().setCode(MIPS_FAULT)
		await state().run()
		expect(state().halted).toBe(true)
		expect(state().console).toMatch(/error|exception/i)

		expect(await state().switchArchitecture('beta')).toBe(true)
		expect(state().console).toBe('')
		expect(state().halted).toBe(false)
		expect(state().instructionCount).toBe(0)

		state().setCode(BETA_FAULT)
		await state().run()
		expect(state().halted).toBe(true)
		expect(state().console).toMatch(/Misaligned/)

		expect(await state().switchArchitecture('mips')).toBe(true)
		expect(state().console).toBe('')
		expect(state().halted).toBe(false)
		state().setCode(MIPS_EXIT)
		await state().run()
		expect(state().registers.$t1).toBe(7)
	})

	it('resolves kept line breakpoints against the program built for the new target', async () => {
		state().assemble()
		// Line 4 of the MIPS program: the second addi.
		state().toggleBreakpointLine('main.asm', 4)
		expect(state().breakpoints).toEqual(new Set([0x00400004]))

		expect(await state().switchArchitecture('beta')).toBe(true)
		expect(state().breakpoints.size).toBe(0)
		state().setCode(BETA_PROGRAM)
		// The file keeps its name, so the breakpoint keeps its line.
		await state().run()
		expect(state().isPaused).toBe(true)
		// CMOVE(5, R1) is one word at 0; line 4 is the next word.
		expect(state().pc).toBe(4)
		expect(state().breakpoints).toEqual(new Set([4]))

		expect(await state().switchArchitecture('mips')).toBe(true)
		state().setCode(MIPS_EXIT)
		await state().run()
		expect(state().isPaused).toBe(true)
		expect(state().pc).toBe(0x00400004)
	})

	it('keeps open panels across targets and gives each its own tools', async () => {
		state().setOpenPanels(['statistics', 'marsBot', 'xray'])
		const before = state() as unknown as Record<string, unknown>
		expect(before.marsBot).toBeDefined()

		expect(await state().switchArchitecture('beta')).toBe(true)
		expect(state().openPanels).toEqual(['statistics', 'marsBot', 'xray'])
		// MIPS device tools are gone with the target that contributed them.
		expect((state() as unknown as Record<string, unknown>).marsBot).toBeUndefined()
		state().setCode(BETA_PROGRAM)
		await state().run()
		expect(state().statistics.total).toBe(state().instructionCount)

		expect(await state().switchArchitecture('mips')).toBe(true)
		expect(state().openPanels).toEqual(['statistics', 'marsBot', 'xray'])
		expect((state() as unknown as Record<string, unknown>).marsBot).toBeDefined()
		expect(state().statistics.total).toBe(0)
		await state().run()
		expect(state().statistics.total).toBe(state().instructionCount)
	})

	it('keeps the target and a usable view after a failed load, and retries', async () => {
		state().assemble()
		state().step()
		const machine = lastMachine().machine
		tracker.flakyFailures = 1

		expect(await state().switchArchitecture('flaky')).toBe(false)
		expect(state().architecture).toBe('mips')
		expect(state().target?.definition.id).toBe('mips')
		expect(state().diagnostics.some((diagnostic) => diagnostic.message.includes('network error'))).toBe(true)
		// What the workspace shows agrees with the machine the request stopped.
		expect(state().halted).toBe(machine.halted)

		expect(await state().switchArchitecture('flaky')).toBe(true)
		expect(state().architecture).toBe('flaky')
		expect(state().diagnostics).toEqual([])
		state().setCode(BETA_PROGRAM)
		await state().run()
		expect(state().halted).toBe(true)
		expect(state().registers.R3).toBe(12)
	})
})
