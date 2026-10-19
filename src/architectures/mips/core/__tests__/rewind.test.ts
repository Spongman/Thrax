import { mipsHistorySchema } from '../../history/schema'
import { describe, expect, it } from 'vitest'
import { assembleMips } from '../../assembler'
import { firstError } from '../../../../core/diagnostics'
import { BLOCK_SIZE } from '../effectStore'
import { MipsSimulator } from '../simulator'

function build(source: string) {
	const { program, machineCode, diagnostics } = assembleMips(source)
	expect(firstError(diagnostics)?.message).toBeUndefined()
	return new MipsSimulator(machineCode, program, undefined, { historySchema: mipsHistorySchema })
}

/** Runs until the machine asks for input, answers it, and carries on. */
function runAnswering(simulator: MipsSimulator, answers: string[]) {
	let asked = 0
	for (let guard = 0; guard < 200 && !simulator.halted; guard++) {
		simulator.step()
		if (simulator.pendingInput) {
			asked++
			simulator.provideInput(answers.shift() ?? '')
		}
	}
	return asked
}

const READS_TWO = `
main:	li $v0, 5
	syscall
	move $t0, $v0
	li $v0, 5
	syscall
	add $t1, $t0, $v0
	li $v0, 10
	syscall
`

describe('an edit leaves the recorded path', () => {
	it('makes the reads past it real again, since that future will not happen', () => {
		const simulator = build(READS_TWO)
		expect(runAnswering(simulator, ['7', '5'])).toBe(2)

		while (simulator.stepBack()) { /* to the start */ }
		// Editing through the API drops what the log held ahead.
		expect(simulator.setRegister('$t3', 1)).toBe(true)
		expect(runAnswering(simulator, ['1', '2'])).toBe(2)
		expect(simulator.registers.$t1).toBe(3)
	})
})

describe('rewinding to a chosen entry', () => {
	it('undoes back to that entry and no further', () => {
		const simulator = build('main:\tli $t0, 1\n\tli $t1, 2\n\tli $t2, 3\n\tli $t3, 4\n')
		for (let index = 0; index < 4; index++) simulator.step()
		expect(simulator.registers.$t3).toBe(4)

		const history = simulator.getExecutionHistory()
		expect(simulator.rewindTo(history.at(1)!.id)).toBe(true)

		// `li $t1, 2` has been undone, and everything before it stands.
		expect(simulator.registers.$t0).toBe(1)
		expect(simulator.registers.$t1).toBe(0)
		expect(simulator.registers.$t3).toBe(0)
		expect(simulator.getHistoryCursor()).toBe(1)
		expect(simulator.instructionCount).toBe(1)
	})

	it('refuses an entry that is not behind the present', () => {
		const simulator = build('main:\tli $t0, 1\n\tli $t1, 2\n')
		simulator.step()
		const first = simulator.getExecutionHistory().at(0)!

		simulator.stepBack()
		// Already ahead of the cursor, so there is nothing to undo.
		expect(simulator.rewindTo(first.id)).toBe(false)
		expect(simulator.rewindTo(-1)).toBe(false)
	})

	it('addresses an entry by id, which outlives the oldest being dropped', () => {
		const simulator = build('main:\tli $t0, 0\nloop:\taddi $t0, $t0, 1\n\tj loop\n')
		simulator.maxHistorySize = BLOCK_SIZE
		const steps = BLOCK_SIZE * 3
		for (let index = 0; index < steps; index++) simulator.step()

		const history = simulator.getExecutionHistory()
		// Ids keep counting, so the oldest still held is not the first that ran;
		// an index would have named a different entry after the drop.
		const oldest = history.at(0)!
		expect(oldest.id).toBeGreaterThan(1)
		expect(history.indexOfId(oldest.id)).toBe(0)
		expect(history.indexOfId(oldest.id - 1)).toBe(-1)
		expect(simulator.getHistoryCursor()).toBe(history.length)
	})
})

describe('editing the machine by hand', () => {
	it('records an edit as its own entry that steps back', () => {
		const simulator = build('main:\tli $t0, 1\n\tadd $t1, $t0, $t0\n')
		simulator.step()

		expect(simulator.setRegister('$t0', 21)).toBe(true)
		simulator.step()
		expect(simulator.registers.$t1).toBe(42)

		const history = simulator.getExecutionHistory()
		expect([...history].map((entry) => entry.kind)).toEqual(['instruction', 'edit', 'instruction'])

		// Undoing the add, then the edit, puts the original value back.
		simulator.stepBack()
		simulator.stepBack()
		expect(simulator.registers.$t0).toBe(1)
		// An edit is not an instruction, so it does not move the count.
		expect(simulator.instructionCount).toBe(1)
	})

	it('leaves $zero alone and refuses an unaligned word', () => {
		const simulator = build('main:\tnop\n')
		expect(simulator.setRegister('$zero', 5)).toBe(false)
		expect(simulator.setRegister('$nope', 5)).toBe(false)
		expect(simulator.setMemoryWord(0x10010002, 1)).toBe(false)
		expect(simulator.getExecutionHistory()).toHaveLength(0)
	})

	it('edits memory, the coprocessors and the program counter', () => {
		const simulator = build('main:\tnop\n\tnop\n')
		expect(simulator.setMemoryWord(0x10010000, 0xabcd)).toBe(true)
		expect(simulator.setFpRegister(3, 0x3f800000)).toBe(true)
		expect(simulator.setCp0Register(12, 7)).toBe(true)
		expect(simulator.setRegister('$pc', 0x00400004)).toBe(true)

		expect(simulator.memory.get(0x10010000 >>> 2)).toBe(0xabcd)
		expect(simulator.fpRegisters[3]).toBe(0x3f800000)
		expect(simulator.cp0Registers[12]).toBe(7)
		expect(simulator.pc).toBe(0x00400004)

		while (simulator.stepBack()) { /* undo every edit */ }
		expect(simulator.memory.get(0x10010000 >>> 2)).toBeUndefined()
		expect(simulator.fpRegisters[3]).toBe(0)
		expect(simulator.pc).toBe(0x00400000)
	})

	it('drops what the log held ahead, since execution leaves that path', () => {
		const simulator = build('main:\tli $t0, 1\n\tli $t1, 2\n\tli $t2, 3\n')
		for (let index = 0; index < 3; index++) simulator.step()
		simulator.stepBack()
		simulator.stepBack()
		expect(simulator.getExecutionHistory()).toHaveLength(3)

		simulator.setRegister('$t0', 9)
		// One executed entry, then the edit; the two undone ones are rebuilt.
		expect([...simulator.getExecutionHistory()].map((entry) => entry.kind)).toEqual(['instruction', 'edit'])
	})
})

describe('running forward applies the log rather than re-running it', () => {
	it('passes a console read a second time without asking', () => {
		const simulator = build(READS_TWO)
		runAnswering(simulator, ['7', '5'])
		expect(simulator.registers.$t1).toBe(12)

		while (simulator.stepBack()) { /* to the start */ }
		// Nothing executes here: the effects are applied straight back on.
		while (!simulator.halted) simulator.step()
		expect(simulator.pendingInput).toBeNull()
		expect(simulator.registers.$t1).toBe(12)
	})

	it('hands the same clock back, so elapsed time does not move under a replay', () => {
		let reading = 1000
		const simulator = build('main:\tli $v0, 30\n\tsyscall\n\tli $v0, 10\n\tsyscall\n')
		simulator.clock = () => (reading += 1000)

		while (!simulator.halted) simulator.step()
		const first = simulator.registers.$a0

		while (simulator.stepBack()) { /* to the start */ }
		while (!simulator.halted) simulator.step()
		// A second reading would have been 1000 higher.
		expect(simulator.registers.$a0).toBe(first)
	})

	it('restores what a syscall printed, both ways', () => {
		const simulator = build(`
	.data
msg:	.asciiz "hello"
	.text
main:	li $v0, 4
	la $a0, msg
	syscall
	li $v0, 10
	syscall
`)
		while (!simulator.halted) simulator.step()
		expect(simulator.console).toBe('hello')

		while (simulator.stepBack()) { /* to the start */ }
		expect(simulator.console).toBe('')

		while (!simulator.halted) simulator.step()
		expect(simulator.console).toBe('hello')
	})

	it('walks a run back and forward repeatedly without drifting', async () => {
		const simulator = build(READS_TWO)
		runAnswering(simulator, ['7', '5'])
		const settled = { t1: simulator.registers.$t1, count: simulator.instructionCount, halted: simulator.halted }

		for (let pass = 0; pass < 3; pass++) {
			while (simulator.stepBack()) { /* back */ }
			expect(simulator.instructionCount).toBe(0)
			while (!simulator.halted) simulator.step()
			expect({ t1: simulator.registers.$t1, count: simulator.instructionCount, halted: simulator.halted }).toEqual(settled)
		}
	})

	it('takes an entry off the log only once execution leaves its path', () => {
		const simulator = build('main:\tli $t0, 1\n\tli $t1, 2\n\tli $t2, 3\n')
		for (let index = 0; index < 3; index++) simulator.step()
		simulator.stepBack()
		simulator.stepBack()

		// Stepping back keeps them, since they hold what those instructions made.
		expect(simulator.getExecutionHistory()).toHaveLength(3)
		expect(simulator.getHistoryCursor()).toBe(1)

		simulator.step()
		expect(simulator.registers.$t1).toBe(2)
		expect(simulator.getExecutionHistory()).toHaveLength(3)
	})
})
