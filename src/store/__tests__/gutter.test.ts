import { beforeAll as beforeArchitectureTests } from 'vitest'
import { initializeArchitecture } from '../../architectures/registry'
beforeArchitectureTests(async () => { await initializeArchitecture() })
import { beforeEach, describe, expect, it } from 'vitest'
import { useTHRAXStore } from '../thraxStore'

const state = () => useTHRAXStore.getState()

/** Opens the given files, the first of them active, as the tab bar would. */
const openFiles = (files: { title: string, code: string }[]) => {
	useTHRAXStore.setState({
		documents: files.map((file, index) => ({ id: `doc-${index}`, title: file.title, code: file.code, dirty: false })),
		activeDocumentId: 'doc-0',
		code: files[0].code,
	})
}

/**
 * Writes a zero word over the instruction at `target`, so the word the gutter
 * shows is no longer the one the assembler produced.
 */
const SELF_MODIFYING = `main:
	la $t0, target
	sw $zero, 0($t0)
target:
	addi $t2, $zero, 7
	li $v0, 10
	syscall
`

const wordsOf = (file: string, line: number) => state().codeWords.get(file)?.get(line) ?? []

// Settings outlive a test, so each one starts from the defaults.
beforeEach(() => {
	state().setSetting('assembleAll', false)
	state().setTargetSetting('selfModifyingCode', false)
	state().setTargetSetting('delayedBranching', false)
})

describe('self-modified code', () => {
	it('shows the word memory holds now, not the one that was assembled', async () => {
		openFiles([{ title: 'main.asm', code: SELF_MODIFYING }])
		state().setTargetSetting('selfModifyingCode', true)
		state().assemble()

		// Line 5 is the instruction the program is about to overwrite.
		const assembled = wordsOf('main.asm', 5)[0].bytes
		expect(assembled.some((byte) => byte !== 0)).toBe(true)

		await state().run()
		expect(state().halted).toBe(true)
		// It ran as a nop, so the register the original would have written is untouched.
		expect(state().registers.$t2).toBe(0)

		// The gutter used to read the assembled array, so it kept showing the
		// original word however the program rewrote itself.
		expect(wordsOf('main.asm', 5)[0].bytes).toEqual([0, 0, 0, 0])
	})
})

describe('breakpoints by address', () => {
	it('toggles the line breakpoint the gutter shows, and the address otherwise', () => {
		openFiles([{ title: 'main.asm', code: SELF_MODIFYING }])
		state().assemble()

		// `la` expands to two words: the first belongs to the line, the second to
		// no line of its own.
		const [first, tail] = wordsOf('main.asm', 2)

		state().toggleBreakpointAt('main.asm', 2, first.address)
		expect(state().breakpointLines.get('main.asm')?.has(2)).toBe(true)
		expect(state().breakpoints.has(first.address)).toBe(true)

		state().toggleBreakpointAt('main.asm', 2, first.address)
		expect(state().breakpointLines.size).toBe(0)
		expect(state().breakpoints.size).toBe(0)

		state().toggleBreakpointAt('main.asm', 2, tail.address)
		expect(state().breakpointAddresses.has(tail.address)).toBe(true)
		expect(state().breakpointLines.size).toBe(0)

		state().toggleBreakpointAt('main.asm', 2, tail.address)
		expect(state().breakpointAddresses.size).toBe(0)
	})
})
