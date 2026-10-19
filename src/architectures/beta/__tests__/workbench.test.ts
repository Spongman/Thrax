/** Beta through the workspace store, as the app drives it. */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

const storage = new Map<string, string>()

// The store reads its settings while it is being created.
Object.defineProperty(globalThis, 'window', {
	value: {
		localStorage: {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => { storage.set(key, value) },
		},
	},
	writable: true,
})

const { initializeArchitecture } = await import('../../registry')
const { useTHRAXStore } = await import('../../../store/thraxStore')

const state = () => useTHRAXStore.getState()
const activeTitle = () => state().documents.find((document) => document.id === state().activeDocumentId)!.title
/** 1-based line of the first line of `code` containing `text`. */
const lineOf = (code: string, text: string) => code.split('\n').findIndex((line) => line.includes(text)) + 1

const OUTPUT: Record<string, string> = {
	hello: 'Hello, THRAX!\n',
	sum: '8\n',
	factorial: '120',
	fibonacci: '55',
	ackermann: 'A(3, 3) = 61',
	loop: '1 2 3 4 5 \n',
	bitwise: '8 14 6',
	bitmap: '',
	macros: 'counting: 12345\n123\n',
}

const examples = () => state().target!.definition.examples

beforeAll(async () => {
	await initializeArchitecture('mips')
	expect(await state().switchArchitecture('beta')).toBe(true)
})

beforeEach(async () => {
	await state().switchArchitecture('beta')
	state().reset()
})

describe('Beta in the workbench', () => {
	it('is the active target, with its own examples', () => {
		expect(state().architecture).toBe('beta')
		expect(state().target?.definition.language).toBe('uasm')
		expect(Object.keys(examples()).sort()).toEqual([...Object.keys(OUTPUT), 'input', 'tinyos', 'tinyosSolved'].sort())
		// Reset is supervisor mode at address 0.
		expect(state().registers.PC).toBe(0x80000000)
		expect(state().pc).toBe(0)
	})

	it.each(Object.keys(OUTPUT))('runs the %s example to HALT', async (key) => {
		state().setCode(examples()[key].code)
		await state().run()
		expect(state().diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([])
		expect(state().halted).toBe(true)
		expect(state().console).toBe(OUTPUT[key])
	})

	it('reads input through RDCHAR once it is provided', async () => {
		state().setCode(examples().input.code)
		await state().run()
		expect(state().halted).toBe(false)
		expect(state().pendingInput).not.toBeNull()
		expect(state().console).toBe('')

		await state().submitInput('hello, beta')
		expect(state().pendingInput).toBeNull()
		expect(state().halted).toBe(true)
		expect(state().console).toBe('hello, beta\n')
	})

	it('reports diagnostics with file and line', () => {
		state().setCode('.include "beta.uasm"\n\tADDC(R1, 1)\n\tNOPE(3)\n')
		state().assemble()
		const errors = state().diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
		expect(errors.length).toBeGreaterThan(0)
		expect(errors[0].file).toBe(activeTitle())
		expect(errors[0].line).toBe(2)
		expect(state().hasMachine).toBe(false)
	})

	it('steps, edits a register, and steps back through both', () => {
		const code = '.include "beta.uasm"\n\tCMOVE(5, R1)\n\tADDC(R1, 2, R2)\n\tHALT()\n'
		state().setCode(code)
		state().assemble()
		state().step()
		state().step()
		expect(state().registers.R1).toBe(5)
		expect(state().registers.R2).toBe(7)
		expect(state().pc).toBe(8)
		expect(state().instructionCount).toBe(2)

		expect(state().setRegisterValue('R3', 42)).toBe(true)
		expect(state().registers.R3).toBe(42)
		expect(state().executionHistory.at(state().executionHistory.length - 1)?.kind).toBe('edit')

		state().stepBack()
		expect(state().registers.R3).toBe(0)
		state().stepBack()
		expect(state().registers.R2).toBe(0)
		expect(state().pc).toBe(4)
		expect(state().instructionCount).toBe(1)
		expect(state().historyFormat?.instruction(state().executionHistory.at(0)!)).toBe('ADDC(R31, 5, R1)')
	})

	it('steps back over a HALT and the output before it', async () => {
		state().setCode(examples().hello.code)
		await state().run()
		const count = state().instructionCount
		state().stepBack()
		expect(state().halted).toBe(false)
		expect(state().instructionCount).toBe(count - 1)
		// Back past the last WRCHAR, the newline is unwritten.
		while (state().console === OUTPUT.hello) state().stepBack()
		expect(state().console).toBe('Hello, THRAX!')
	})

	it('stops at a breakpoint on a source line, then continues', async () => {
		const { code } = examples().sum
		state().setCode(code)
		state().assemble()
		const file = activeTitle()
		const line = lineOf(code, 'ADD(R1, R2, R3)')
		state().toggleBreakpointLine(file, line)
		const address = state().sourceIndex.codeAddressForLine(file, line)
		expect(address).toBeDefined()

		await state().run()
		expect(state().halted).toBe(false)
		expect(state().isPaused).toBe(true)
		expect(state().pc).toBe(address)
		expect(state().registers.R1).toBe(5)
		expect(state().registers.R3).toBe(0)

		await state().continue()
		expect(state().halted).toBe(true)
		expect(state().console).toBe('8\n')
		state().toggleBreakpointLine(file, line)
	})

	it('shows memory, the call stack and disassembly', async () => {
		const { code } = examples().sum
		state().setCode(code)
		state().assemble()
		const file = activeTitle()
		const call = lineOf(code, 'CALL(print_decimal, 1)')
		// Into print_decimal: the frame is on the stack.
		await state().runToAddress(state().labels.get('print_decimal')!)
		expect(state().callStack.length).toBe(1)
		expect(state().callStack[0].targetAddress).toBe(state().labels.get('print_decimal'))
		expect(state().sourceIndex.lineForAddress(state().callStack[0].callAddress)?.line).toBe(call)
		// The first instruction, CMOVE(stack, SP), is an ADDC from R31.
		expect(state().memory.word(0)! >>> 26).toBe(0x30)
		const rows = state().codeWords.get(file)?.get(lineOf(code, 'CMOVE(5, R1)'))
		expect(rows?.length).toBe(1)
		expect(state().target!.services.disassembly.row(rows![0])).toBe('ADDC(R31, 5, R1)')
	})

	it('names a new file .uasm', () => {
		state().createDocument()
		expect(activeTitle()).toMatch(/^untitled.*\.uasm$/)
	})

	it('stops at a .breakpoint, shown as a line breakpoint', async () => {
		const code = '.include "beta.uasm"\n\tCMOVE(1, R1)\n.breakpoint\n\tCMOVE(2, R1)\n\tHALT()\n'
		state().setCode(code)
		await state().run()
		expect(state().halted).toBe(false)
		expect(state().pc).toBe(4)
		expect(state().registers.R1).toBe(1)
		expect(state().breakpointLines.get(activeTitle())).toEqual(new Set([4]))
		await state().continue()
		expect(state().halted).toBe(true)
	})

	it('persists the target with the workspace', async () => {
		expect(state().workspaceSnapshot().architecture).toBe('beta')
		state().setCode('// saved\n')
		await new Promise((resolve) => setTimeout(resolve, 600))
		expect(JSON.parse(storage.get('thrax-web.autosave')!).architecture).toBe('beta')
	})

	it('hands back to MIPS, whose examples still run', async () => {
		const beta = examples()
		expect(await state().switchArchitecture('mips')).toBe(true)
		expect(state().architecture).toBe('mips')
		expect(state().target?.definition.settings.fields.map((field) => field.key)).toContain('delayedBranching')
		expect(examples()).not.toBe(beta)
		state().setCode('main:\n\tli $a0, 42\n\tli $v0, 1\n\tsyscall\n\tli $v0, 10\n\tsyscall\n')
		await state().run()
		expect(state().console).toBe('42')
		expect(state().halted).toBe(true)
	})
})
