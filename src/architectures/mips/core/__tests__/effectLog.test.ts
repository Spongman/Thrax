import { mipsHistorySchema } from '../../history/schema'
import { describe, expect, it } from 'vitest'
import { Kind } from '../effectKind'
import { assembleMips } from '../../assembler'
import { firstError } from '../../../../core/diagnostics'
import { MipsSimulator } from '../simulator'
import type { Effect } from '../types'

function build(source: string) {
	const { program, machineCode, diagnostics } = assembleMips(source)
	expect(firstError(diagnostics)?.message).toBeUndefined()
	return new MipsSimulator(machineCode, program, undefined, { historySchema: mipsHistorySchema })
}

/**
 * Everything a step back has to put back, in one comparable shape.  Run control
 * is deliberately left out: pausing is the debugger's state, not the machine's.
 */
function machineState(simulator: MipsSimulator) {
	return {
		registers: { ...simulator.registers },
		memory: [...simulator.memory.entries()].sort((left, right) => left[0] - right[0]),
		console: simulator.console,
		pc: simulator.pc,
		hi: simulator.hi,
		lo: simulator.lo,
		instructionCount: simulator.instructionCount,
		halted: simulator.halted,
		exitCode: simulator.exitCode,
		callStack: simulator.callStack.map((frame) => ({ ...frame })),
		heapPointer: simulator.heapPointer,
		keyboardDisplay: { ...simulator.keyboardDisplay },
		fpRegisters: [...simulator.fpRegisters],
		fpConditionFlags: [...simulator.fpConditionFlags],
		cp0Registers: [...simulator.cp0Registers],
		pendingSleepMs: simulator.pendingSleepMs,
	}
}

/** An entry's effects as objects, which is what the panel would show. */
const effectsOf = (simulator: MipsSimulator): Effect[][] =>
	[...simulator.getExecutionHistory()].map((entry) =>
		Array.from({ length: entry.effectCount }, (unused, offset) => simulator.effects.materialize(entry.effectStart + offset)))

/** Touches a register, memory, the console, the heap, the call stack and the FPU. */
const PROGRAM = `
	.data
buffer:	.space 32
	.text
main:	li $t0, 5
	la $t1, buffer
loop:	sw $t0, 0($t1)
	addi $t1, $t1, 4
	addi $t0, $t0, -1
	bgtz $t0, loop
	li $a0, 16
	li $v0, 9
	syscall
	jal show
	li $v0, 10
	syscall
show:	li $v0, 4
	la $a0, buffer
	syscall
	mtc1 $t0, $f0
	cvt.s.w $f0, $f0
	c.eq.s $f0, $f0
	jr $ra
`

describe('a step back is the exact inverse of an instruction', () => {
	it('returns a whole run to the state a fresh machine starts in', async () => {
		const simulator = build(PROGRAM)
		const fresh = machineState(build(PROGRAM))

		await simulator.run()
		expect(simulator.halted).toBe(true)
		expect(simulator.instructionCount).toBeGreaterThan(20)

		while (simulator.stepBack()) { /* all the way back */ }

		// Field by field, not registers alone: a mutation that records no effect
		// would otherwise leave the machine quietly wrong.
		expect(machineState(simulator)).toEqual(fresh)
	})

	it('returns to the same state after every single step', async () => {
		const simulator = build(PROGRAM)
		const states = [machineState(simulator)]
		for (let index = 0; index < 40 && !simulator.halted; index++) {
			simulator.step()
			states.push(machineState(simulator))
		}

		for (let index = states.length - 1; index > 0; index--) {
			expect(machineState(simulator)).toEqual(states[index])
			expect(simulator.stepBack()).toBe(true)
		}
		expect(machineState(simulator)).toEqual(states[0])
	})
})

describe('the log records only what an instruction touched', () => {
	it('spends a handful of effects on an instruction, not a copy of the machine', () => {
		const simulator = build(PROGRAM)
		for (let index = 0; index < 6; index++) simulator.step()

		// `li $t0, 5` writes one register, and that is the whole entry: where
		// execution stood lives on the entry rather than costing an effect.
		expect(effectsOf(simulator)[0]).toEqual([{ kind: Kind.REGISTER, name: '$t0', value: 0 }])
		for (const effects of effectsOf(simulator)) expect(effects.length).toBeLessThan(5)

		// The entry carries the control state it will hand back on a step back.
		expect(simulator.getExecutionHistory().at(0)).toMatchObject({ pc: 0x00400000, delayState: 'none', delayedTarget: 0 })
	})

	it('covers a contiguous write with one effect rather than one per word', () => {
		// `.asciiz` into a buffer: syscall 8 fills it from a single read.
		const simulator = build(`
	.data
buffer:	.space 16
	.text
main:	la $a0, buffer
	li $a1, 12
	li $v0, 8
	syscall
`)
		while (!simulator.pendingInput && !simulator.halted) simulator.step()
		expect(simulator.pendingInput).not.toBeNull()
		simulator.provideInput('hello world')

		const memory = effectsOf(simulator).flat().filter((effect) => effect.kind === Kind.MEMORY)
		expect(memory).toHaveLength(1)
		// Twelve bytes of buffer, so three words in one run; `.space` zeroed them.
		expect(memory[0]).toMatchObject({ wordAddress: 0x10010000 >>> 2, words: [0, 0, 0] })
	})

	it('keeps what came from outside, which nothing else can reproduce', () => {
		const simulator = build('main:\tli $v0, 5\n\tsyscall\n')
		while (!simulator.pendingInput) simulator.step()
		simulator.provideInput('42')

		expect(simulator.registers.$v0).toBe(42)
		expect(effectsOf(simulator).flat()).toContainEqual({ kind: Kind.INPUT, value: '42' })
	})

	it('puts back a keyboard character a read consumed', () => {
		const simulator = build('main:\tli $t0, 0xffff\n\tsll $t0, $t0, 16\n\tlb $t1, 4($t0)\n')
		simulator.keyboardDisplay.queuedInput = 'ab'
		simulator.step()
		simulator.step()
		simulator.step()

		expect(simulator.registers.$t1).toBe('a'.charCodeAt(0))
		expect(simulator.keyboardDisplay.queuedInput).toBe('b')

		// The read was a write: undoing it hands the character back.
		expect(simulator.stepBack()).toBe(true)
		expect(simulator.keyboardDisplay.queuedInput).toBe('ab')
	})
})

describe('self-modifying code', () => {
	it('drops the decoding of a word a step back restored', () => {
		// `sw` overwrites the `addi` four words along, which then runs as a nop.
		const simulator = build(`
main:	lui $t0, 0x0040
	ori $t0, $t0, 0x000c
	sw $zero, 0($t0)
target:	addi $t2, $zero, 7
	nop
`)
		simulator.selfModifyingCode = true
		for (let index = 0; index < 4; index++) simulator.step()
		expect(simulator.pc).toBe(0x00400010)
		expect(simulator.registers.$t2).toBe(0)

		// Undo the overwritten instruction, then the store that overwrote it.
		expect(simulator.stepBack()).toBe(true)
		expect(simulator.stepBack()).toBe(true)
		expect(simulator.memory.get(0x0040000c >>> 2)).not.toBe(0)

		// Run that word again without redoing the store. A stale decoding would
		// still be the nop, and would leave $t2 alone.
		simulator.setProgramCounter(0x0040000c)
		simulator.step()
		expect(simulator.registers.$t2).toBe(7)
	})
})

describe('the log rolls in blocks', () => {
	/** Programs run forever, so the log spends most of its life full. */
	const SPINNING = 'main:\tli $t0, 0\nloop:\taddi $t0, $t0, 1\n\tj loop\n'

	it('drops a block at a time rather than an entry at a time', () => {
		const simulator = build(SPINNING)
		simulator.maxHistorySize = 1000
		const history = simulator.getExecutionHistory()

		for (let index = 0; index < 20000; index++) {
			simulator.step()
			// Whole blocks go, so the log holds at least the limit and at most one
			// block more.  Taking the oldest off the front one at a time would move
			// every entry behind it, on every instruction.
			expect(history.length).toBeGreaterThanOrEqual(Math.min(1000, index + 1))
			expect(history.blockCount).toBeLessThanOrEqual(Math.ceil(history.length / 62) + 1)
		}
	})

	it('keeps everything while the log is shorter than a block', () => {
		// A block is given up whole or not at all, so a limit below one block
		// evicts nothing: the overshoot is bounded by a block, not by the limit.
		const simulator = build(SPINNING)
		simulator.maxHistorySize = 5
		for (let index = 0; index < 20; index++) simulator.step()
		expect(simulator.getExecutionHistory()).toHaveLength(20)
	})

	it('reaches any entry without walking the blocks', () => {
		const simulator = build(SPINNING)
		simulator.maxHistorySize = 500
		for (let index = 0; index < 2000; index++) simulator.step()

		const history = simulator.getExecutionHistory()
		// Every block but the last is full, so an index divides straight into one.
		const ids = [...history].map((entry) => entry.id)
		for (let index = 0; index < history.length; index++) {
			expect(history.at(index)!.id).toBe(ids[index])
		}
		expect(history.indexOfId(ids[ids.length - 1])).toBe(history.length - 1)
		expect(history.indexOfId(ids[0] - 1)).toBe(-1)
	})
})
