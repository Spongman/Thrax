/** ARMv8-A's AArch32 state through the workspace store, as the app drives it. */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { A32_EXAMPLES } from '../a32/examples'
import { A32_REGISTERS } from '../a32/registers'
import { A64_REGISTERS } from '../a64/registers'
import { DATA_BASE, DEFAULT_MEMORY_BYTES, TEXT_BASE } from '../a64/layout'
import { EXAMPLES } from '../examples'

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
const errors = () => state().diagnostics.filter((diagnostic) => diagnostic.severity === 'error')

const examples = () => state().targetVariant!.examples

/** Console output of each example that runs to its exit by itself. */
const A32_OUTPUT: Record<string, string> = {
	hello: 'Hello, THRAX!\n',
	sum: '8\n',
	factorial: '120',
	fibonacci: '55',
	ackermann: 'A(3, 3) = 61',
	loop: '1 2 3 4 5 \n',
	bitwise: '8 14 6',
	bitfields: '86 3 2018915346 1920 16\n',
	bitmap: '',
	macros: 'counting: 12345\n123\n',
	mandelbrot: '',
	helloArmasm: 'Hello, THRAX!\n',
	factorialArmasm: '120',
}

beforeAll(async () => {
	await initializeArchitecture('mips')
	expect(await state().switchArchitecture('armv8')).toBe(true)
})

beforeEach(async () => {
	await state().switchArchitecture('armv8')
	await state().setTargetSetting('executionState', 'aarch32')
	state().reset()
})

describe('the execution state chooses what the workbench shows', () => {
	it('shows AArch64 registers, examples and language by default, and AArch32 when chosen', async () => {
		await state().setTargetSetting('executionState', 'aarch64')
		expect(state().targetVariant?.language).toBe('aarch64')
		expect(state().targetVariant?.registers).toBe(A64_REGISTERS)
		expect(state().targetVariant?.examples).toBe(EXAMPLES)
		expect(state().registers.X0).toBe(0n)

		await state().setTargetSetting('executionState', 'aarch32')
		expect(state().targetVariant?.language).toBe('arm')
		expect(state().targetVariant?.registers).toBe(A32_REGISTERS)
		expect(state().targetVariant?.examples).toBe(A32_EXAMPLES)
		expect(state().registers.R13).toBe(TEXT_BASE + DEFAULT_MEMORY_BYTES)
		expect(state().registers.PC).toBe(TEXT_BASE)
		expect(state().registers.CPSR).toBe(0x10)
		expect(state().registers.X0).toBeUndefined()
	})

	it('leaves an architecture that does not vary with its own definition', async () => {
		expect(await state().switchArchitecture('mips')).toBe(true)
		expect(state().targetVariant).toBe(state().target!.definition)
		expect(await state().switchArchitecture('armv8')).toBe(true)
		// Switching back finds the state as it was left.
		expect(state().targetVariant?.registers).toBe(A32_REGISTERS)
	})
})

describe('AArch32 in the workbench', () => {
	it.each(Object.keys(A32_OUTPUT))('runs the %s example to its exit', async (key) => {
		state().setCode(examples()[key].code)
		await state().run()
		expect(errors()).toEqual([])
		expect(state().halted).toBe(true)
		expect(state().console).toBe(A32_OUTPUT[key])
	})

	it('reads input through read() once it is provided', async () => {
		state().setCode(examples().input.code)
		await state().run()
		expect(state().halted).toBe(false)
		expect(state().pendingInput).not.toBeNull()
		await state().submitInput('hello, arm')
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

	it('reports an A64 instruction as an error with file and line', () => {
		state().setCode('_start:\n\tmov r0, #1\n\tmov x0, #1\n')
		state().assemble()
		expect(errors()[0]).toMatchObject({ file: activeTitle(), line: 3 })
		expect(state().hasMachine).toBe(false)
	})

	it('reports a branch into Thumb as the fault that stopped the program', async () => {
		state().setCode('_start:\n\tmov r0, #1\n\tbx r0\n')
		await state().run()
		expect(state().console).toContain('BX to 0x00000001 would enter Thumb state, which is not supported (A32 only)')
		expect(state().pc).toBe(TEXT_BASE + 4)
	})

	it('steps, edits a register and the flags, and steps back through both', () => {
		state().setCode('_start:\n\tmov r1, #5\n\tadds r2, r1, #2\n\tbkpt #0\n')
		state().assemble()
		state().step()
		state().step()
		expect(state().registers.R1).toBe(5)
		expect(state().registers.R2).toBe(7)
		expect(state().pc).toBe(TEXT_BASE + 8)

		expect(state().setRegisterValue('R3', 0xFFFF_FFFF)).toBe(true)
		expect(state().registers.R3).toBe(0xFFFF_FFFF)
		expect(state().executionHistory.at(state().executionHistory.length - 1)?.kind).toBe('edit')
		expect(state().setRegisterValue('CPSR', 0xF000_001F)).toBe(true)
		// The flags take; the mode stays USR.
		expect(state().registers.CPSR).toBe(0xF000_0010)
		expect(state().registers.Z).toBe(1)

		state().stepBack()
		state().stepBack()
		expect(state().registers.R3).toBe(0)
		expect(state().registers.CPSR).toBe(0x10)
		state().stepBack()
		expect(state().registers.R2).toBe(0)
		expect(state().pc).toBe(TEXT_BASE + 4)
		expect(state().historyFormat?.instruction(state().executionHistory.at(0)!)).toBe('mov r1, #5')
		const [chip] = state().historyFormat!.effects(state().executionHistory.at(0)!, false)
		expect(chip).toMatchObject({ subject: 'R1', register: 'R1', value: 0 })
	})

	it('stops at a breakpoint on a source line, then continues', async () => {
		const { code } = examples().sum
		state().setCode(code)
		state().assemble()
		const file = activeTitle()
		const line = lineOf(code, 'add r0, r4, r5')
		state().toggleBreakpointLine(file, line)
		const address = state().sourceIndex.codeAddressForLine(file, line)
		expect(address).toBeDefined()

		await state().run()
		expect(state().isPaused).toBe(true)
		expect(state().pc).toBe(address)
		expect(state().registers.R4).toBe(5)

		await state().continue()
		expect(state().halted).toBe(true)
		expect(state().console).toBe('8\n')
		state().toggleBreakpointLine(file, line)
	})

	it('shows memory, the call stack and UAL disassembly', async () => {
		const { code } = examples().factorial
		state().setCode(code)
		state().assemble()
		const file = activeTitle()
		await state().runToAddress(state().labels.get('factorial')!)
		expect(state().callStack.length).toBe(1)
		expect(state().callStack[0].targetAddress).toBe(state().labels.get('factorial'))
		expect(state().sourceIndex.lineForAddress(state().callStack[0].callAddress)?.line).toBe(lineOf(code, 'bl factorial'))
		// mov r0, #5.
		expect(state().memory.word(TEXT_BASE)).toBe(0xE3A00005)
		const rows = state().codeWords.get(file)?.get(lineOf(code, 'bxle lr'))
		expect(rows?.length).toBe(1)
		expect(state().target!.services.disassembly.row(rows![0])).toBe('bxle lr')
	})

	it('describes registers and addresses under the pointer', async () => {
		state().setCode(examples().ackermann.code)
		await state().run()
		const inspection = { registers: state().registers, memory: state().memory, labels: state().labels }
		const tip = state().target!.services.describeToken!('\tmov r0, r4', 10, inspection)
		expect(tip?.register).toBe('R4')
		const label = state().target!.services.describeToken!('\tldr r0, =label', 11, inspection)
		expect(label?.address).toBe(DATA_BASE)
	})

	it('names a new file .s, read as GNU as', () => {
		state().createDocument()
		expect(activeTitle()).toMatch(/^untitled.*\.s$/)
		state().setCode(A32_EXAMPLES.helloArmasm.code)
		state().assemble()
		expect(errors().some((error) => /AREA is armasm, so name the file \.armasm/.test(error.message))).toBe(true)
	})

	it('hands back to AArch64, whose examples still run', async () => {
		await state().setTargetSetting('executionState', 'aarch64')
		state().setCode(EXAMPLES.sum.code)
		await state().run()
		expect(state().console).toBe('8\n')
		expect(state().registers.X19).toBe(5n)
	})
})
