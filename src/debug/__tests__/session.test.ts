import { describe, expect, it } from 'vitest'
import { Assembler } from '../../core/assembler'
import { assemble, check } from '../../core/__tests__/helpers'
import { MipsSimulator } from '../../core/simulator'
import type { SourceIndex } from '../../core/sourceIndex'
import { DebugSession } from '../session'

/**
 * Line 3 is a pseudo-instruction: `li` of a wide constant expands to `lui` and
 * `ori`, so 0x00400004 is a word the editor cannot point at.
 */
const SOURCE = `main:
	# a comment line
	li $t0, 0x12345678
	addi $t1, $zero, 1
	move $a0, $t1
	li $v0, 10
	syscall
`

/** The same program with a line inserted above it and the `move` pushed down. */
const EDITED = `main:
	nop
	# a comment line
	li $t0, 0x12345678

	addi $t1, $zero, 1
	move $a0, $t1
	li $v0, 10
	syscall
`

function build(source: string) {
	const { program, machineCode } = assemble(source)
	return { simulator: new MipsSimulator(machineCode, program), index: program.sourceIndex }
}

function attach(source: string, session = new DebugSession()) {
	const { simulator, index } = build(source)
	session.rebind(simulator, index)
	return { session, simulator, index }
}

const lineAt = (index: SourceIndex, address: number) => index.lineForAddress(address)?.line

describe('debug session stepping', () => {
	it('runs every word a pseudo-instruction expanded to as one step', () => {
		const { session, simulator, index } = attach(SOURCE)
		expect(simulator.pc).toBe(0x00400000)

		session.step()

		expect(simulator.instructionCount).toBe(2)
		expect(simulator.pc).toBe(0x00400008)
		expect(lineAt(index, simulator.pc)).toBe(4)
	})

	it('stops at each machine word while the editor shows word rows', () => {
		const session = new DebugSession()
		session.setWordRows(true)
		const { simulator } = attach(SOURCE, session)

		session.step()

		expect(simulator.instructionCount).toBe(1)
		expect(simulator.pc).toBe(0x00400004)
	})

	it('steps over a pseudo-instruction line the same way', async () => {
		const { session, simulator } = attach(SOURCE)

		await session.stepOver()

		expect(simulator.instructionCount).toBe(2)
		expect(simulator.pc).toBe(0x00400008)
	})

	it('steps back over the words the step forward skipped', () => {
		const { session, simulator } = attach(SOURCE)
		session.step()
		session.step()
		expect(simulator.pc).toBe(0x0040000c)

		session.stepBack()
		expect(simulator.pc).toBe(0x00400008)

		// The tail of the `li` is not a word the editor can point at, so stepping
		// back past it takes both of its words.
		session.stepBack()
		expect(simulator.pc).toBe(0x00400000)
		expect(simulator.instructionCount).toBe(0)
	})

	it('does nothing once the program has halted or history has run out', async () => {
		const { session, simulator } = attach(SOURCE)
		expect(session.stepBack()).toBe(true)
		expect(simulator.pc).toBe(0x00400000)
		expect(simulator.instructionCount).toBe(0)

		await session.continue()
		expect(simulator.halted).toBe(true)
		const finished = simulator.instructionCount

		expect(session.step()).toBe(true)
		expect(simulator.instructionCount).toBe(finished)
		expect(simulator.halted).toBe(true)
	})

	it('assembles once when a control is pressed before there is a program', () => {
		let built = 0
		const session: DebugSession = new DebugSession(() => {
			built += 1
			const { simulator, index } = build(SOURCE)
			session.rebind(simulator, index)
			return simulator
		})

		expect(session.step()).toBe(true)
		expect(session.step()).toBe(true)
		expect(built).toBe(1)
		expect(session.machine?.instructionCount).toBe(3)
	})

	it('drives nothing when the program does not assemble', () => {
		const session = new DebugSession()
		expect(session.step()).toBe(false)
		expect(session.stepBack()).toBe(false)
		expect(session.pause()).toBe(false)
		expect(session.view()).toEqual({ hasMachine: false, breakpointLines: new Map(), breakpointAddresses: new Set(), breakpoints: new Set() })
	})

	it('paces a run over the same addresses stepping stops at', () => {
		const { session, simulator, index } = attach(SOURCE)
		expect(simulator.pacedAddresses).toEqual(index.codeAddresses(index.entryFile))

		session.setWordRows(true)
		expect(simulator.pacedAddresses).toBeNull()
	})
})

describe('debug session breakpoints', () => {
	it('moves a breakpoint asked for on a comment line onto the next line of code', () => {
		const { session, simulator, index } = attach(SOURCE)

		session.toggleBreakpointLine(index.entryFile, 2)

		expect(session.view().breakpointLines).toEqual(new Map([[index.entryFile, new Set([3])]]))
		expect(simulator.getBreakpoints()).toEqual([0x00400000])

		// The line it moved to is the one that takes it away again.
		session.toggleBreakpointLine(index.entryFile, 3)
		expect(session.view().breakpointLines.size).toBe(0)
		expect(simulator.getBreakpoints()).toEqual([])
	})

	it('refuses a line past the last one that holds code', () => {
		const { session, simulator, index } = attach(SOURCE)

		expect(session.toggleBreakpointLine(index.entryFile, 20)).toBe(false)

		expect(session.view().breakpointLines.size).toBe(0)
		expect(simulator.getBreakpoints()).toEqual([])
	})

	it('carries breakpoints across a rebuild, re-resolving the lines they sit on', () => {
		const { session, index } = attach(SOURCE)
		session.toggleBreakpointLine(index.entryFile, 4)
		session.toggleBreakpointLine(index.entryFile, 5)
		expect(session.view().breakpoints).toEqual(new Set([0x00400008, 0x0040000c]))

		const rebuilt = build(EDITED)
		session.rebind(rebuilt.simulator, rebuilt.index)

		// Line 4 now holds the `li`, and line 5 is blank, so its breakpoint moves
		// down to the `addi` that follows it.
		expect(session.view().breakpointLines).toEqual(new Map([[rebuilt.index.entryFile, new Set([4, 6])]]))
		expect(session.view().breakpoints).toEqual(new Set([0x00400004, 0x0040000c]))
		expect(rebuilt.simulator.getBreakpoints().sort()).toEqual([0x00400004, 0x0040000c])
	})

	it('keeps a breakpoint on a word with no line of its own', () => {
		const { session } = attach(SOURCE)

		session.toggleBreakpointAddress(0x00400004)
		expect(session.view().breakpointAddresses).toEqual(new Set([0x00400004]))

		const rebuilt = build(SOURCE)
		session.rebind(rebuilt.simulator, rebuilt.index)
		expect(rebuilt.simulator.getBreakpoints()).toEqual([0x00400004])

		// A word the editor can point at is a word stepping stops on.
		const { session: stepper, simulator } = attach(SOURCE)
		stepper.toggleBreakpointAddress(0x00400004)
		stepper.step()
		expect(simulator.pc).toBe(0x00400004)
	})

	it('leaves the breakpoints alone while running to an address', async () => {
		const { session, simulator, index } = attach(SOURCE)
		session.toggleBreakpointLine(index.entryFile, 7)

		await session.runTo(0x0040000c)

		expect(simulator.pc).toBe(0x0040000c)
		expect(session.view().breakpoints).toEqual(new Set([0x00400014]))
		expect(simulator.getBreakpoints()).toEqual([0x00400014])
	})

	it('takes the lines the editor reports as they moved', () => {
		const { session, simulator, index } = attach(SOURCE)

		session.setBreakpointLines(index.entryFile, [4, 0, 1.5, 5])

		expect(session.view().breakpointLines).toEqual(new Map([[index.entryFile, new Set([4, 5])]]))
		expect(simulator.getBreakpoints().sort()).toEqual([0x00400008, 0x0040000c])
	})
})

/** A program that runs across two files, which is what `assembleAll` builds. */
const MULTI_FILES = [
	{ name: 'main.asm', code: 'main:\n\tjal helper\n\tli $v0, 10\n\tsyscall\n' },
	{ name: 'lib.asm', code: 'helper:\n\taddi $t0, $t0, 1\n\tjr $ra\n\t.globl helper\n' },
]

function buildFiles(files = MULTI_FILES) {
	const { program, machineCode } = check(new Assembler(files, files.map((file) => file.name)).assemble())
	return { simulator: new MipsSimulator(machineCode, program), index: program.sourceIndex }
}

describe('debug session over several files', () => {
	it('stops at a line of every assembled file, not only the entry file', () => {
		const session = new DebugSession()
		const { simulator, index } = buildFiles()
		session.rebind(simulator, index)

		// `jal helper` lands on the first line of the library, which is a line the
		// editor can point at, so the step ends there rather than running through it.
		session.step()

		expect(simulator.instructionCount).toBe(1)
		expect(simulator.pc).toBe(index.codeAddressForLine('lib.asm', 2))
	})

	it('paces a run over the addresses of every assembled file', () => {
		const session = new DebugSession()
		const { simulator, index } = buildFiles()
		session.rebind(simulator, index)

		const everyFile = new Set([...index.codeAddresses('main.asm'), ...index.codeAddresses('lib.asm')])
		expect(simulator.pacedAddresses).toEqual(everyFile)
	})

	it('keeps the same line of two files as two breakpoints', () => {
		const session = new DebugSession()
		const { simulator, index } = buildFiles()
		session.rebind(simulator, index)

		session.toggleBreakpointLine('main.asm', 2)
		session.toggleBreakpointLine('lib.asm', 2)

		expect(session.view().breakpointLines).toEqual(new Map([['main.asm', new Set([2])], ['lib.asm', new Set([2])]]))
		expect(session.view().breakpoints).toEqual(new Set([index.codeAddressForLine('main.asm', 2), index.codeAddressForLine('lib.asm', 2)]))

		session.toggleBreakpointLine('lib.asm', 2)
		expect(session.view().breakpointLines).toEqual(new Map([['main.asm', new Set([2])]]))
		expect(simulator.getBreakpoints()).toEqual([index.codeAddressForLine('main.asm', 2)])
	})

	it('leaves the breakpoints of a file the next build left out alone', () => {
		const session = new DebugSession()
		const built = buildFiles()
		session.rebind(built.simulator, built.index)
		session.toggleBreakpointLine('lib.asm', 2)

		// The single-file mode assembles the entry file alone; the library's
		// breakpoint waits rather than being thrown away.
		const alone = buildFiles([{ name: 'main.asm', code: 'main:\n\tli $v0, 10\n\tsyscall\n' }])
		session.rebind(alone.simulator, alone.index)
		expect(session.view().breakpointLines).toEqual(new Map([['lib.asm', new Set([2])]]))
		expect(alone.simulator.getBreakpoints()).toEqual([])

		const again = buildFiles()
		session.rebind(again.simulator, again.index)
		expect(again.simulator.getBreakpoints()).toEqual([again.index.codeAddressForLine('lib.asm', 2)])
	})
})
