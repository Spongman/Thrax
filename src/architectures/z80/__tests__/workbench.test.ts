/** The Z80 through the workspace store, as the app drives it. */

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
	timer: '12345\n',
}

const examples = () => state().target!.definition.examples

beforeAll(async () => {
	await initializeArchitecture('mips')
	expect(await state().switchArchitecture('z80')).toBe(true)
})

beforeEach(async () => {
	await state().switchArchitecture('z80')
	state().reset()
})

describe('Z80 in the workbench', () => {
	it('is the active target, with its own examples', () => {
		expect(state().architecture).toBe('z80')
		expect(state().target?.definition.name).toBe('Zilog Z80')
		expect(state().target?.definition.language).toBe('z80')
		expect(Object.keys(examples()).sort()).toEqual([...Object.keys(OUTPUT), 'input', 'keyboard'].sort())
		expect(state().pc).toBe(0)
		expect(state().registers.SP).toBe(0xFFFF)
	})

	it.each(Object.keys(OUTPUT))('runs the %s example to its end', async (key) => {
		state().setCode(examples()[key].code)
		await state().run()
		expect(state().diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([])
		expect(state().halted).toBe(true)
		expect(state().console).toBe(OUTPUT[key])
	})

	it('reads a line once it is provided', async () => {
		state().setCode(examples().input.code)
		await state().run()
		expect(state().halted).toBe(false)
		expect(state().pendingInput).not.toBeNull()

		await state().submitInput('hello, z80')
		expect(state().pendingInput).toBeNull()
		expect(state().halted).toBe(true)
		expect(state().console).toBe('hello, z80\n')
	})

	it('echoes typing through keyboard interrupts', async () => {
		state().setCode(examples().keyboard.code)
		await state().run()
		expect(state().halted).toBe(false)
		expect(state().pendingInput?.prompt).toMatch(/Type/)
		await state().submitInput('hi.')
		expect(state().halted).toBe(true)
		expect(state().console).toBe('hi.')
	})

	it('reports diagnostics with file and line', () => {
		state().setCode('\tld a,5\n\tjr nowhere\n\tld (hl),(hl)\n')
		state().assemble()
		const errors = state().diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
		expect(errors.length).toBeGreaterThan(0)
		expect(errors[0].file).toBe(activeTitle())
		expect(errors[0].line).toBe(3)
		expect(state().hasMachine).toBe(false)
	})

	it('steps, edits a register, and steps back through both', () => {
		state().setCode('\tld a,5\n\tadd a,2\n\tld b,a\n\thalt\n')
		state().assemble()
		state().step()
		state().step()
		expect(state().registers.A).toBe(7)
		expect(state().pc).toBe(4)
		expect(state().instructionCount).toBe(2)
		expect(state().registers.T).toBe(14)

		expect(state().setRegisterValue('B', 42)).toBe(true)
		expect(state().registers.B).toBe(42)
		expect(state().registers.BC).toBe(42 << 8)
		expect(state().executionHistory.at(state().executionHistory.length - 1)?.kind).toBe('edit')

		state().stepBack()
		expect(state().registers.B).toBe(0)
		state().stepBack()
		expect(state().registers.A).toBe(5)
		expect(state().pc).toBe(2)
		expect(state().registers.T).toBe(7)
		expect(state().historyFormat?.instruction(state().executionHistory.at(0)!)).toBe('LD A,$05')
	})

	it('edits a flag as a bit of F', () => {
		state().setCode('\tnop\n\thalt\n')
		state().assemble()
		expect(state().setRegisterValue('FZ', 0)).toBe(true)
		expect(Number(state().registers.F) & 0x40).toBe(0)
		expect(state().registers.FC).toBe(1)
	})

	it('stops at a breakpoint on a source line, then continues', async () => {
		const { code } = examples().sum
		state().setCode(code)
		state().assemble()
		const file = activeTitle()
		const line = lineOf(code, 'add a,b')
		state().toggleBreakpointLine(file, line)
		const address = state().sourceIndex.codeAddressForLine(file, line)
		expect(address).toBeDefined()

		await state().run()
		expect(state().halted).toBe(false)
		expect(state().isPaused).toBe(true)
		expect(state().pc).toBe(address)
		expect(state().registers.A).toBe(5)

		await state().continue()
		expect(state().halted).toBe(true)
		expect(state().console).toBe('8\n')
		state().toggleBreakpointLine(file, line)
	})

	it('shows memory, the call stack and each instruction at its own length', async () => {
		const { code } = examples().hello
		state().setCode(code)
		state().assemble()
		const file = activeTitle()
		await state().runToAddress(state().labels.get('print_string')!)
		expect(state().callStack.length).toBe(1)
		expect(state().callStack[0].targetAddress).toBe(state().labels.get('print_string'))
		expect(state().sourceIndex.lineForAddress(state().callStack[0].callAddress)?.line).toBe(lineOf(code, 'call print_string'))
		// LD SP,$FF00 is 31 00 FF.
		expect([0, 1, 2].map((address) => state().memory.byte(address))).toEqual([0x31, 0x00, 0xFF])
		const rows = state().codeWords.get(file)?.get(lineOf(code, 'ld hl,message'))
		const message = state().labels.get('message')!
		expect(rows).toEqual([{ address: 3, instruction: true, bytes: [0x21, message & 0xFF, message >> 8] }])
		expect(state().target!.services.disassembly.row(rows![0])).toBe(`LD HL,$${message.toString(16).toUpperCase().padStart(4, '0')}`)
		const push = state().codeWords.get(file)?.get(lineOf(code, '\tcall print_string'))
		expect(push?.[0].bytes.length).toBe(3)
	})

	it('steps over a call', async () => {
		const { code } = examples().hello
		state().setCode(code)
		state().assemble()
		state().step()
		state().step()
		await state().stepOver()
		expect(state().console).toBe('Hello, THRAX!\n')
		expect(state().pc).toBe(state().sourceIndex.codeAddressForLine(activeTitle(), lineOf(code, '\thalt')))
	})

	it('names a new file .z80', () => {
		state().createDocument()
		expect(activeTitle()).toMatch(/^untitled.*\.z80$/)
	})

	it('hands back to MIPS, whose examples still run', async () => {
		const z80 = examples()
		expect(await state().switchArchitecture('mips')).toBe(true)
		expect(state().architecture).toBe('mips')
		expect(examples()).not.toBe(z80)
		state().setCode('main:\n\tli $a0, 42\n\tli $v0, 1\n\tsyscall\n\tli $v0, 10\n\tsyscall\n')
		await state().run()
		expect(state().console).toBe('42')
		expect(state().halted).toBe(true)
	})
})
