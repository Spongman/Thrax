/** The 6502 through the workspace store, as the app drives it. */

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

/** Examples that run to a halt without input. */
const OUTPUT: Record<string, string> = {
	undocumented: '42',
	hello: 'Hello, THRAX!\n',
	sum: '8\n',
	factorial: '120',
	fibonacci: '55',
	ackermann: 'A(3, 3) = 61',
	loop: '1 2 3 4 5 \n',
	bitwise: '8 14 6',
	bitmap: '',
	macros: 'counting: 12345\n123\n',
	interrupts: '.....\n',
}

const examples = () => state().target!.definition.examples

beforeAll(async () => {
	await initializeArchitecture('mips')
	expect(await state().switchArchitecture('mos6502')).toBe(true)
})

beforeEach(async () => {
	await state().switchArchitecture('mos6502')
	state().reset()
})

describe('6502 in the workbench', () => {
	it('is the active target, with its own examples and reset registers', () => {
		expect(state().architecture).toBe('mos6502')
		expect(state().target?.definition.name).toBe('MOS 6502')
		expect(state().target?.definition.language).toBe('ca65')
		expect(Object.keys(examples()).sort()).toEqual([...Object.keys(OUTPUT), 'input', 'mmio', 'mandelbrot'].sort())
		expect(state().registers.SP).toBe(0xFD)
		expect(state().registers.I).toBe(1)
		expect(state().pc).toBe(0x0600)
	})

	it.each(Object.keys(OUTPUT))('runs the %s example to a halt', async (key) => {
		state().setCode(examples()[key].code)
		await state().run()
		expect(state().diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([])
		expect(state().halted).toBe(true)
		expect(state().console).toBe(OUTPUT[key])
	})

	it('reads input through $F001 once it is provided', async () => {
		state().setCode(examples().input.code)
		await state().run()
		expect(state().halted).toBe(false)
		expect(state().pendingInput?.prompt).toContain('$F001')
		expect(state().console).toBe('')

		await state().submitInput('hello, 6502')
		expect(state().pendingInput).toBeNull()
		expect(state().halted).toBe(true)
		expect(state().console).toBe('hello, 6502\n')
	})

	it('takes keys queued through the Keyboard and Display tool', async () => {
		state().setCode(examples().mmio.code)
		// The program polls until typed to, so the keys arrive while it runs.
		const running = state().run()
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(state().halted).toBe(false)
		expect(state().pendingInput).not.toBeNull()
		state().sendKeyboardInput('ok.')
		await running
		expect(state().halted).toBe(true)
		expect(state().keyboardDisplay).toEqual({ queuedInput: '', displayOutput: 'ok.' })
	})

	it('reports diagnostics with file and line', () => {
		state().setCode('\tlda #1\n\tbne nowhere\n\tnop\n')
		state().assemble()
		const errors = state().diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
		expect(errors.length).toBeGreaterThan(0)
		expect(errors[0].file).toBe(activeTitle())
		expect(errors[0].line).toBe(2)
		expect(state().hasMachine).toBe(false)
	})

	it('steps, edits a register and a flag, and steps back through them', () => {
		state().setCode('\tlda #5\n\tclc\n\tadc #2\n\tbrk\n')
		state().assemble()
		state().step()
		state().step()
		state().step()
		expect(state().registers.A).toBe(7)
		expect(state().pc).toBe(0x0605)
		expect(state().instructionCount).toBe(3)
		expect(state().registers.CYC).toBe(7 + 6)

		expect(state().setRegisterValue('X', 42)).toBe(true)
		expect(state().setRegisterValue('C', 1)).toBe(true)
		expect(state().registers.X).toBe(42)
		expect(state().registers.C).toBe(1)
		expect(Number(state().registers.P) & 1).toBe(1)
		expect(state().executionHistory.at(state().executionHistory.length - 1)?.kind).toBe('edit')

		state().stepBack()
		expect(state().registers.C).toBe(0)
		state().stepBack()
		expect(state().registers.X).toBe(0)
		state().stepBack()
		expect(state().registers.A).toBe(5)
		expect(state().pc).toBe(0x0603)
		expect(state().instructionCount).toBe(2)
		expect(state().historyFormat?.instruction(state().executionHistory.at(0)!)).toBe('LDA #$05')
		// The entry LDA made shows what A held before it.
		expect(state().historyFormat?.effects(state().executionHistory.at(0)!, false).map((effect) => effect.label)).toEqual(['A $00 →'])
	})

	it('steps back over the halt and the output before it', async () => {
		state().setCode(examples().hello.code)
		await state().run()
		const count = state().instructionCount
		state().stepBack()
		expect(state().halted).toBe(false)
		expect(state().instructionCount).toBe(count)
		// Back past the last write to $F000, the newline is unwritten.
		while (state().console === OUTPUT.hello) state().stepBack()
		expect(state().console).toBe('Hello, THRAX!')
	})

	it('stops at a breakpoint on a source line, then continues', async () => {
		const { code } = examples().sum
		state().setCode(code)
		state().assemble()
		const file = activeTitle()
		const line = lineOf(code, 'adc #3')
		state().toggleBreakpointLine(file, line)
		const address = state().sourceIndex.codeAddressForLine(file, line)
		expect(address).toBe(0x0603)

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

	it('steps over a JSR and out of a subroutine', async () => {
		const code = '\tjsr sub\n\tlda #2\n\tbrk\nsub:\n\tldx #1\n\trts\n'
		state().setCode(code)
		state().assemble()
		await state().stepOver()
		expect(state().pc).toBe(0x0603)
		expect(state().registers.X).toBe(1)
		state().reset()
		state().setCode(code)
		state().assemble()
		state().step()
		expect(state().callStack).toEqual([{ callAddress: 0x0600, returnAddress: 0x0603, targetAddress: state().labels.get('sub') }])
		await state().stepToReturn()
		expect(state().pc).toBe(0x0603)
		expect(state().callStack).toEqual([])
	})

	it('shows memory, the call stack and variable-length disassembly', async () => {
		const { code } = examples().sum
		state().setCode(code)
		state().assemble()
		const file = activeTitle()
		await state().runToAddress(state().labels.get('print_decimal')!)
		expect(state().callStack.length).toBe(1)
		expect(state().callStack[0].targetAddress).toBe(state().labels.get('print_decimal'))
		expect(state().sourceIndex.lineForAddress(state().callStack[0].callAddress)?.line).toBe(lineOf(code, 'jsr print_decimal'))
		expect(state().memory.byte(0x0600)).toBe(0xA9)
		const disassembly = state().target!.services.disassembly
		const rows = (text: string) => state().codeWords.get(file)?.get(lineOf(code, text)) ?? []
		expect(rows('lda #5')).toEqual([{ address: 0x0600, instruction: true, bytes: [0xA9, 0x05] }])
		expect(disassembly.row(rows('lda #5')[0])).toBe('LDA #$05')
		expect(rows('jsr print_decimal')[0].bytes.length).toBe(3)
		expect(rows('clc')[0].bytes).toEqual([0x18])
		expect(disassembly.at(state().memory, 0x0602)).toBe('CLC')
	})

	it('names a new file .a65', () => {
		state().createDocument()
		expect(activeTitle()).toMatch(/^untitled.*\.a65$/)
	})

	it('stops at a .breakpoint, shown as a line breakpoint', async () => {
		const code = '\tlda #1\n.breakpoint\n\tlda #2\n\tbrk\n'
		state().setCode(code)
		await state().run()
		expect(state().halted).toBe(false)
		expect(state().pc).toBe(0x0602)
		expect(state().registers.A).toBe(1)
		expect(state().breakpointLines.get(activeTitle())).toEqual(new Set([3]))
		await state().continue()
		expect(state().halted).toBe(true)
	})

	it('jams on an NMOS KIL opcode and can rewind it', async () => {
		state().setCode('\tlda #1\n\t.byte $02\n')
		await state().run()
		expect(state().halted).toBe(true)
		expect(state().console).toBe('')
		expect(state().pc).toBe(0x0602)
		state().stepBack()
		expect(state().halted).toBe(false)
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
