/** ARMv8-A through the workspace store, as the app drives it. */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DATA_BASE, DEFAULT_MEMORY_BYTES, TEXT_BASE } from '../a64/layout'

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
	bigFactorial: '20! = 2432902008176640000\n',
	fibonacci: '55',
	ackermann: 'A(3, 3) = 61',
	loop: '1 2 3 4 5 \n',
	bitwise: '8 14 6',
	bitmap: '',
	macros: 'counting: 12345\n123\n',
	mandelbrot: '',
}

const examples = () => state().target!.definition.examples

beforeAll(async () => {
	await initializeArchitecture('mips')
	expect(await state().switchArchitecture('armv8')).toBe(true)
})

beforeEach(async () => {
	await state().switchArchitecture('armv8')
	state().reset()
})

describe('ARMv8-A in the workbench', () => {
	it('is the active target, with its own examples', () => {
		expect(state().architecture).toBe('armv8')
		expect(state().target?.definition.name).toBe('ARM')
		expect(state().target?.definition.language).toBe('aarch64')
		expect(Object.keys(examples()).sort()).toEqual([...Object.keys(OUTPUT), 'input', 'mmio'].sort())
		expect(state().registers.PC).toBe(BigInt(TEXT_BASE))
		expect(state().registers.SP).toBe(BigInt(TEXT_BASE + DEFAULT_MEMORY_BYTES))
		expect(state().pc).toBe(TEXT_BASE)
	})

	it.each(Object.keys(OUTPUT))('runs the %s example to its exit', async (key) => {
		state().setCode(examples()[key].code)
		await state().run()
		expect(state().diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([])
		expect(state().halted).toBe(true)
		expect(state().console).toBe(OUTPUT[key])
	})

	it('holds 64-bit register values exactly', async () => {
		state().setCode(examples().bigFactorial.code)
		await state().run()
		expect(state().registers.X19).toBe(2432902008176640000n)
		expect(state().registers.W19).toBe(Number(2432902008176640000n & 0xFFFF_FFFFn))
	})

	it('reads input through read() once it is provided', async () => {
		state().setCode(examples().input.code)
		await state().run()
		expect(state().halted).toBe(false)
		expect(state().pendingInput).not.toBeNull()
		await state().submitInput('hello, arm')
		expect(state().pendingInput).toBeNull()
		expect(state().halted).toBe(true)
		expect(state().console).toBe('hello, arm\n')
	})

	it('echoes keys typed into the Keyboard and Display tool', async () => {
		state().setCode(examples().mmio.code)
		state().assemble()
		state().sendKeyboardInput('ok.')
		await state().continue()
		expect(state().halted).toBe(true)
		expect(state().keyboardDisplay?.displayOutput).toBe('ok.')
	})

	it('reports diagnostics with file and line', () => {
		state().setCode('_start:\n\tmov x0, #1\n\tadd x0, w1, #2\n')
		state().assemble()
		const errors = state().diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
		expect(errors.length).toBeGreaterThan(0)
		expect(errors[0].file).toBe(activeTitle())
		expect(errors[0].line).toBe(3)
		expect(state().hasMachine).toBe(false)
	})

	it('steps, edits a 64-bit register, and steps back through both', () => {
		state().setCode('_start:\n\tmov x1, #5\n\tadd x2, x1, #2\n\thlt #0\n')
		state().assemble()
		state().step()
		state().step()
		expect(state().registers.X1).toBe(5n)
		expect(state().registers.X2).toBe(7n)
		expect(state().pc).toBe(TEXT_BASE + 8)

		expect(state().setRegisterValue('X3', 0x8000_0000_0000_0001n)).toBe(true)
		expect(state().registers.X3).toBe(0x8000_0000_0000_0001n)
		expect(state().executionHistory.at(state().executionHistory.length - 1)?.kind).toBe('edit')
		expect(state().setRegisterValue('W4', 0xFFFF_FFFF)).toBe(true)
		expect(state().registers.X4).toBe(0xFFFF_FFFFn)

		state().stepBack()
		state().stepBack()
		expect(state().registers.X3).toBe(0n)
		state().stepBack()
		expect(state().registers.X2).toBe(0n)
		expect(state().pc).toBe(TEXT_BASE + 4)
		expect(state().historyFormat?.instruction(state().executionHistory.at(0)!)).toBe('mov x1, #5')
		const [chip] = state().historyFormat!.effects(state().executionHistory.at(0)!, false)
		expect(chip).toMatchObject({ subject: 'X1', register: 'X1', value: 0n })
	})

	it('stops at a breakpoint on a source line, then continues', async () => {
		const { code } = examples().sum
		state().setCode(code)
		state().assemble()
		const file = activeTitle()
		const line = lineOf(code, 'add x0, x19, x20')
		state().toggleBreakpointLine(file, line)
		const address = state().sourceIndex.codeAddressForLine(file, line)
		expect(address).toBeDefined()

		await state().run()
		expect(state().halted).toBe(false)
		expect(state().isPaused).toBe(true)
		expect(state().pc).toBe(address)
		expect(state().registers.X19).toBe(5n)

		await state().continue()
		expect(state().halted).toBe(true)
		expect(state().console).toBe('8\n')
		state().toggleBreakpointLine(file, line)
	})

	it('shows memory, the call stack and disassembly', async () => {
		const { code } = examples().factorial
		state().setCode(code)
		state().assemble()
		const file = activeTitle()
		await state().runToAddress(state().labels.get('factorial')!)
		expect(state().callStack.length).toBe(1)
		expect(state().callStack[0].targetAddress).toBe(state().labels.get('factorial'))
		expect(state().sourceIndex.lineForAddress(state().callStack[0].callAddress)?.line).toBe(lineOf(code, 'bl factorial'))
		// The first instruction is mov x0, #5: MOVZ.
		expect(state().memory.word(TEXT_BASE)).toBe(0xD28000A0)
		const rows = state().codeWords.get(file)?.get(lineOf(code, 'mov x0, #5'))
		expect(rows?.length).toBe(1)
		expect(state().target!.services.disassembly.row(rows![0])).toBe('mov x0, #5')
	})

	it('describes registers and addresses under the pointer', async () => {
		state().setCode(examples().bigFactorial.code)
		await state().run()
		const inspection = { registers: state().registers, memory: state().memory, labels: state().labels }
		const tip = state().target!.services.describeToken!('\tmov x0, x19', 10, inspection)
		expect(tip?.register).toBe('X19')
		expect(tip?.contents.join('\n')).toContain('2432902008176640000')
		const label = state().target!.services.describeToken!('\tldr x0, =label', 11, inspection)
		expect(label?.address).toBe(DATA_BASE)
	})

	it('names a new file .s', () => {
		state().createDocument()
		expect(activeTitle()).toMatch(/^untitled.*\.s$/)
	})

	it('hands back to MIPS, whose examples still run', async () => {
		expect(await state().switchArchitecture('mips')).toBe(true)
		expect(state().architecture).toBe('mips')
		state().setCode('main:\n\tli $a0, 42\n\tli $v0, 1\n\tsyscall\n\tli $v0, 10\n\tsyscall\n')
		await state().run()
		expect(state().console).toBe('42')
		expect(state().halted).toBe(true)
	})
})
