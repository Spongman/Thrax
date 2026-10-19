import { beforeAll as beforeArchitectureTests } from 'vitest'
import { initializeArchitecture } from '../../architectures/registry'
beforeArchitectureTests(async () => { await initializeArchitecture() })
import { beforeEach, describe, expect, it } from 'vitest'
import { sourceSignature, useTHRAXStore } from '../thraxStore'

const state = () => useTHRAXStore.getState()

/** `main.asm` calls into `lib.asm`, so one run crosses both files. */
const MAIN = 'main:\n\tjal helper\n\tli $v0, 10\n\tsyscall\n'
const LIB = 'helper:\n\taddi $t0, $t0, 1\n\tjr $ra\n\t.globl helper\n'

/** Two files that assemble on their own, for the single-file mode. */
const ALONE = 'main:\n\taddi $t0, $zero, 1\n\tli $v0, 10\n\tsyscall\n'
const OTHER = 'second:\n\taddi $t1, $zero, 2\n\tli $v0, 10\n\tsyscall\n'

/** Opens the given files, the first of them active, as the tab bar would. */
const openFiles = (files: { title: string, code: string }[]) => {
	useTHRAXStore.setState({
		documents: files.map((file, index) => ({ id: `doc-${index}`, title: file.title, code: file.code, dirty: false })),
		activeDocumentId: 'doc-0',
		entryDocumentId: 'doc-0',
		code: files[0].code,
	})
}

const addressOf = (file: string, line: number) => state().sourceIndex.codeAddressForLine(file, line)

// Settings outlive a test, so each one starts from the MARS defaults.
beforeEach(() => {
	state().reset()
	state().setSetting('assembleAll', false)
	state().setTargetSetting('delayedBranching', false)
})

describe('the entry file and the tab bar', () => {
	it('keeps a running program, its breakpoints and its history when the tab changes', async () => {
		openFiles([{ title: 'main.asm', code: MAIN }, { title: 'lib.asm', code: LIB }])
		state().setSetting('assembleAll', true)
		state().assemble()

		// A breakpoint in the file that is not the one being edited.
		const stop = addressOf('lib.asm', 2)!
		state().toggleBreakpointAt('lib.asm', 2, stop)
		expect(state().breakpointLines.get('lib.asm')).toEqual(new Set([2]))

		await state().run()
		expect(state().pc).toBe(stop)
		const reached = state().instructionCount
		const history = state().executionHistory.length
		expect(reached).toBeGreaterThan(0)

		state().selectDocument('doc-1')

		// Switching tabs used to detach the debugger and reset the machine.
		expect(state().activeDocumentId).toBe('doc-1')
		expect(state().pc).toBe(stop)
		expect(state().instructionCount).toBe(reached)
		expect(state().executionHistory.length).toBe(history)
		expect(state().breakpoints.has(stop)).toBe(true)
		expect(state().breakpointLines.get('lib.asm')).toEqual(new Set([2]))

		// And the program carries on from where it stood.  The step comes first
		// because continuing while the pc sits on a breakpoint stops on it again.
		await state().continue()
		expect(state().halted).toBe(true)
		expect(state().registers.$t0).toBe(1)
	})

	it('follows the tab bar only until the program has started', () => {
		openFiles([{ title: 'main.asm', code: ALONE }, { title: 'other.asm', code: OTHER }])
		state().assemble()
		expect(state().sourceIndex.entryFile).toBe('main.asm')

		// Nothing has run, so the newly selected file becomes the one assembled.
		state().selectDocument('doc-1')
		expect(state().sourceIndex.entryFile).toBe('other.asm')

		state().step()
		expect(state().instructionCount).toBe(1)

		// Once it has, the tab bar is navigation and nothing more.
		state().selectDocument('doc-0')
		expect(state().sourceIndex.entryFile).toBe('other.asm')
		expect(state().instructionCount).toBe(1)
	})
})

describe('breakpoints across files', () => {
	it('stops at a breakpoint in each file', async () => {
		openFiles([{ title: 'main.asm', code: MAIN }, { title: 'lib.asm', code: LIB }])
		state().setSetting('assembleAll', true)
		state().assemble()

		state().toggleBreakpointLine('main.asm', 3)
		state().toggleBreakpointLine('lib.asm', 2)
		const inMain = addressOf('main.asm', 3)!
		const inLib = addressOf('lib.asm', 2)!
		expect(state().breakpoints).toEqual(new Set([inMain, inLib]))

		// `main` calls the helper first, so the breakpoint in the library comes first.
		await state().run()
		expect(state().pc).toBe(inLib)

		await state().continue()
		expect(state().pc).toBe(inMain)

		await state().continue()
		expect(state().halted).toBe(true)
	})

	it('keeps the same line of two files as two breakpoints', () => {
		openFiles([{ title: 'main.asm', code: MAIN }, { title: 'lib.asm', code: LIB }])
		state().setSetting('assembleAll', true)
		state().assemble()

		state().toggleBreakpointLine('main.asm', 2)
		state().toggleBreakpointLine('lib.asm', 2)
		expect(state().breakpoints).toEqual(new Set([addressOf('main.asm', 2), addressOf('lib.asm', 2)]))

		// Taking one away leaves the other where it was.
		state().toggleBreakpointLine('main.asm', 2)
		expect(state().breakpointLines.has('main.asm')).toBe(false)
		expect(state().breakpointLines.get('lib.asm')).toEqual(new Set([2]))
		expect(state().breakpoints).toEqual(new Set([addressOf('lib.asm', 2)]))
	})

	it('holds a breakpoint in a file the single-file mode leaves out', () => {
		openFiles([{ title: 'main.asm', code: ALONE }, { title: 'other.asm', code: OTHER }])
		state().assemble()
		// With `assembleAll` off the program is the active file alone.
		expect([...state().sourceIndex.files()]).toEqual(['main.asm'])

		state().toggleBreakpointLine('other.asm', 2)
		expect(state().breakpointLines.get('other.asm')).toEqual(new Set([2]))
		expect(state().breakpoints.size).toBe(0)

		// It becomes live as soon as that file is part of the program.
		state().setSetting('assembleAll', true)
		state().assemble()
		expect(state().breakpoints).toEqual(new Set([addressOf('other.asm', 2)]))
	})
})

describe('every assembled file', () => {
	it('carries its own machine words', () => {
		openFiles([{ title: 'main.asm', code: MAIN }, { title: 'lib.asm', code: LIB }])
		state().setSetting('assembleAll', true)
		state().assemble()

		expect([...state().codeWords.keys()]).toEqual(['main.asm', 'lib.asm'])
		expect(state().codeWords.get('lib.asm')?.get(2)?.[0].address).toBe(addressOf('lib.asm', 2))
		expect(state().codeWords.get('main.asm')?.get(2)?.[0].address).toBe(addressOf('main.asm', 2))
	})

	it('reassembles when any of them is edited, not only the active one', () => {
		openFiles([{ title: 'main.asm', code: MAIN }, { title: 'lib.asm', code: LIB }])
		const before = sourceSignature(state().documents)

		// The editor watches this, so an edit to an included file has to move it.
		state().setDocumentCode('doc-1', `${LIB}\n# edited\n`)
		expect(sourceSignature(state().documents)).not.toBe(before)

		// Switching tabs assembles nothing new, so it must not move it.
		const edited = sourceSignature(state().documents)
		state().selectDocument('doc-1')
		expect(sourceSignature(state().documents)).toBe(edited)
	})
})

describe('file titles', () => {
	it('stays unique however a file arrives, which is what assembly relies on', () => {
		openFiles([{ title: 'main.asm', code: ALONE }])

		// A new file, and a rename onto a name already taken.
		state().createDocument()
		state().createDocument()
		const titles = state().documents.map((document) => document.title)
		expect(new Set(titles).size).toBe(titles.length)

		state().renameDocument(state().documents[1].id, 'main.asm')
		const renamed = state().documents.map((document) => document.title)
		expect(new Set(renamed).size).toBe(renamed.length)
		expect(renamed).toContain('main.asm')
	})

	it('assembles one file per open tab, with nothing dropped', () => {
		openFiles([{ title: 'main.asm', code: ALONE }, { title: 'other.asm', code: OTHER }])
		state().setSetting('assembleAll', true)
		state().assemble()
		expect([...state().sourceIndex.files()]).toEqual(['main.asm', 'other.asm'])
	})
})
