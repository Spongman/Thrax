/** ARM26 through the workspace store, as the app drives it. */

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
	prefetch: '12',
	hello: 'Hello, THRAX!\n',
	sum: '8\n',
	factorial: '120',
	fibonacci: '55',
	ackermann: 'A(3, 3) = 61',
	loop: '1 2 3 4 5 \n',
	bitwise: '8 14 6',
	bitmap: '',
	macros: 'counting: 12345\n123\n',
	helloArmasm: 'Hello, THRAX!\n',
	factorialArmasm: '120',
}

const examples = () => state().target!.definition.examples

beforeAll(async () => {
	await initializeArchitecture('mips')
	expect(await state().switchArchitecture('arm26')).toBe(true)
})

beforeEach(async () => {
	await state().switchArchitecture('arm26')
	state().reset()
})

describe('ARM26 in the workbench', () => {
	it('switches ARM2/ARM3 with common views, CP15 registers and rebuild cleanup', async () => {
		state().setTargetSetting('cpuModel', 'arm3')
		expect((state().targetVariant!.registerBanks ?? []).some((bank) => bank.id === 'cp15')).toBe(true)
		expect(state().registers.CP15_0).toBe(0x41560300)
		const code = state().targetVariant!.examples.cache.code
		state().setCode(code)
		await state().run()
		expect(state().diagnostics).toEqual([])
		expect(state().console).toBe('5')
		expect(state().registers.CP15_2).toBe(3)
		expect(Number(state().registers.CYCLES)).toBeGreaterThan(state().instructionCount)
		state().setTargetSetting('cpuModel', 'arm2')
		expect(state().hasMachine).toBe(false)
		expect(state().executionHistory.length).toBe(0)
		expect((state().targetVariant!.registerBanks ?? []).some((bank) => bank.id === 'cp15')).toBe(false)
		expect(state().code).toBe(code)
		state().assemble()
		expect(state().diagnostics.some((diagnostic) => diagnostic.severity === 'error' && diagnostic.message.includes('ARM3'))).toBe(true)
		state().setTargetSetting('cpuModel', 'arm3')
	})

	it('is the active target, with its own examples', () => {
		expect(state().architecture).toBe('arm26')
		expect(state().target?.definition.name).toBe('ARM (26-bit, ARMv2a)')
		expect(state().target?.definition.language).toBe('arm')
		expect(Object.keys(examples()).sort()).toEqual([...Object.keys(OUTPUT), 'input', 'keyboard'].sort())
		// Before a program, the panels show reset: SVC with interrupts off.
		expect(state().registers.PSR).toBe(0x0C000003)
	})

	it.each(Object.keys(OUTPUT))('runs the %s example to OS_Exit', async (key) => {
		state().setCode(examples()[key].code)
		await state().run()
		expect(state().diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([])
		expect(state().halted).toBe(true)
		expect(state().console).toBe(OUTPUT[key])
	})

	it('reads input through OS_ReadC once it is provided', async () => {
		state().setCode(examples().input.code)
		await state().run()
		expect(state().halted).toBe(false)
		expect(state().pendingInput).not.toBeNull()
		await state().submitInput('hello, arm')
		expect(state().pendingInput).toBeNull()
		expect(state().halted).toBe(true)
		expect(state().console).toBe('hello, arm\n')
	})

	it('takes keys from the Keyboard / Display tool as interrupts', async () => {
		state().setCode(examples().keyboard.code)
		state().assemble()
		state().step()
		state().sendKeyboardInput('ab.')
		expect(state().keyboardDisplay?.queuedInput).toBe('ab.')
		await state().continue()
		expect(state().halted).toBe(true)
		expect(state().console).toBe('ab.')
		expect(state().keyboardDisplay?.displayOutput).toBe('ab.')
	})

	it('reports diagnostics with file and line', () => {
		state().setCode('\tmov r0, #1\n\tfrob r1\n')
		state().assemble()
		const errors = state().diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
		expect(errors.length).toBe(1)
		expect(errors[0].file).toBe(activeTitle())
		expect(errors[0].line).toBe(2)
		expect(state().hasMachine).toBe(false)
	})

	it('steps, edits a register, and steps back through both', () => {
		state().setCode('\tmov r1, #5\n\tadds r2, r1, #2\n\tswi OS_Exit\n')
		state().assemble()
		expect(state().pc).toBe(0x8000)
		state().step()
		state().step()
		expect(state().registers.R1).toBe(5)
		expect(state().registers.R2).toBe(7)
		expect(state().pc).toBe(0x8008)
		expect(state().instructionCount).toBe(2)

		expect(state().setRegisterValue('R3', 42)).toBe(true)
		expect(state().registers.R3).toBe(42)
		expect(state().executionHistory.at(state().executionHistory.length - 1)?.kind).toBe('edit')

		state().stepBack()
		expect(state().registers.R3).toBe(0)
		state().stepBack()
		expect(state().registers.R2).toBe(0)
		expect(state().pc).toBe(0x8004)
		expect(state().instructionCount).toBe(1)
		expect(state().historyFormat?.instruction(state().executionHistory.at(0)!)).toBe('mov r1, #5')
	})

	it('shows the flags and steps back over a flag change', () => {
		state().setCode('\tmov r0, #1\n\tsubs r0, r0, #1\n\tswi OS_Exit\n')
		state().assemble()
		state().step()
		state().step()
		expect(state().registers.Z).toBe(1)
		expect(state().registers.C).toBe(1)
		expect(state().registers.N).toBe(0)
		state().stepBack()
		expect(state().registers.Z).toBe(0)
	})

	it('steps back over OS_Exit and the output before it', async () => {
		state().setCode(examples().hello.code)
		await state().run()
		const count = state().instructionCount
		state().stepBack()
		expect(state().halted).toBe(false)
		expect(state().instructionCount).toBe(count - 1)
		state().stepBack()
		expect(state().console).toBe('')
	})

	it('stops at a breakpoint on a source line, then continues', async () => {
		const { code } = examples().sum
		state().setCode(code)
		state().assemble()
		const file = activeTitle()
		const line = lineOf(code, 'add r0, r1, r2')
		state().toggleBreakpointLine(file, line)
		const address = state().sourceIndex.codeAddressForLine(file, line)
		expect(address).toBe(0x8008)

		await state().run()
		expect(state().halted).toBe(false)
		expect(state().isPaused).toBe(true)
		expect(state().pc).toBe(address)
		expect(state().registers.R1).toBe(5)
		expect(state().registers.R0).toBe(0)

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
		await state().runToAddress(state().labels.get('divide')!)
		// Inside divide, called from print_decimal.
		expect(state().callStack.length).toBe(2)
		expect(state().callStack[0].targetAddress).toBe(state().labels.get('print_decimal'))
		expect(state().sourceIndex.lineForAddress(state().callStack[0].callAddress)?.line).toBe(lineOf(code, 'bl print_decimal'))
		expect(state().memory.word(0x8000)).toBe(0xE3A01005)
		const rows = state().codeWords.get(file)?.get(lineOf(code, 'mov r1, #5'))
		expect(rows?.length).toBe(1)
		expect(state().target!.services.disassembly.row(rows![0])).toBe('mov r1, #5')
	})

	it('steps over a BL in one go', async () => {
		state().setCode(examples().sum.code)
		state().assemble()
		for (let step = 0; step < 3; step++) state().step()
		expect(state().pc).toBe(0x800C)
		await state().stepOver()
		expect(state().pc).toBe(0x8010)
		expect(state().console).toBe('8')
		expect(state().callStack.length).toBe(0)
	})

	it('names a new file .asm', () => {
		state().createDocument()
		expect(activeTitle()).toMatch(/^untitled.*\.asm$/)
	})

	it('reads a new file in the dialect the settings choose', async () => {
		const code = 'start\tMOV r0, #1\n\tSWI OS_Exit\n'
		const errors = () => state().diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
		state().setCode(code)
		state().assemble()
		expect(errors().length).toBeGreaterThan(0)
		state().setTargetSetting('dialect', 'armasm')
		state().setCode(code)
		await state().run()
		expect(errors()).toEqual([])
		expect(state().halted).toBe(true)
		expect(state().registers.R0).toBe(1)
		state().setTargetSetting('dialect', 'gnu')
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
