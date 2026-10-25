import { describe, expect, it } from 'vitest'
import { assembleArm26 } from '../assemble'
import { MODE_IRQ, MODE_USR, PSR_I, STEP_HALT, STEP_INTERRUPT, VECTOR_IRQ } from '../cpu'
import { EXAMPLES } from '../examples'
import { arm26HistoryFormatter, Arm26HistoryView, statusText } from '../historyView'
import { Arm26Machine } from '../machine'

function boot(code: string) {
	const { image, diagnostics } = assembleArm26({ name: 'test.asm', code })
	expect(diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([])
	const machine = new Arm26Machine({ memoryBytes: 1 << 16, historyLimit: 100_000 })
	machine.load(image!)
	return machine
}

/** Everything a step may change. */
function snapshot(machine: Arm26Machine) {
	const { cpu, os, keyboard, callStack } = machine
	return {
		clock: Array.from(cpu.clock.state),
		prefetch: Array.from(cpu.prefetch.words),
		prefetchTimes: Array.from(cpu.prefetch.times),
		registers: Array.from(cpu.registers),
		pc: cpu.pc,
		psr: cpu.psr,
		memory: Array.from(new Int32Array(cpu.memory.buffer)).reduce((sum, word, index) => (sum + Math.imul(word, index + 1)) | 0, 0),
		output: os.output,
		input: os.inputIndex,
		key: keyboard.inputIndex,
		display: keyboard.display,
		interruptEnable: keyboard.interruptEnable,
		depth: callStack.depth,
		halted: machine.halted,
		count: machine.instructionCount,
	}
}

/** Steps to the end recording state, then steps back checking each state returns. */
function roundTrip(machine: Arm26Machine, limit = 100_000) {
	const states = [snapshot(machine)]
	for (let steps = 0; steps < limit && !machine.halted; steps++) {
		machine.step()
		states.push(snapshot(machine))
	}
	expect(machine.halted).toBe(true)
	for (let index = states.length - 2; index >= 0; index--) {
		expect(machine.history!.stepBack()).toBe(true)
		expect(snapshot(machine)).toEqual(states[index])
	}
	expect(machine.history!.stepBack()).toBe(false)
}

describe('ARM26 history', () => {
	it('steps back through every example to where it started', () => {
		for (const key of ['hello', 'fibonacci', 'macros', 'factorialArmasm']) roundTrip(boot(EXAMPLES[key].code))
	})

	it('steps back through IRQs, mode changes and the keyboard', () => {
		const machine = boot(EXAMPLES.keyboard.code)
		machine.keyboard.queue('xy.')
		roundTrip(machine)
	})

	it('steps back through input that was read', () => {
		const machine = boot(EXAMPLES.input.code)
		machine.os.feed('abc\n')
		roundTrip(machine)
	})

	it('describes effects, mode-banked registers by the names they had', () => {
		const machine = boot('\tmov r0, #7\n\tmovs r1, #0\n\tswi OS_WriteC\n\tswi OS_Exit\n')
		expect(machine.run(10)).toBe(STEP_HALT)
		const view = new Arm26HistoryView(machine.history)
		const format = arm26HistoryFormatter(machine.history, machine.os, machine.keyboard, () => machine.cpu.mode)
		expect(view.length).toBe(4)
		expect(format.instruction(view.at(1)!)).toBe('movs r1, #0')
		expect(format.effects(view.at(0)!, false).map((effect) => effect.label)).toEqual(['R0 0x00000000 →', 'PC 0x00008000 →'])
		expect(format.effects(view.at(1)!, false).map((effect) => effect.subject)).toEqual(['R1', 'status', 'PC'])
		expect(format.effects(view.at(2)!, false).find((effect) => effect.subject === 'console')?.detail).toBe('"\\u0007"')
		expect(format.effects(view.at(3)!, false).map((effect) => effect.subject)).toEqual(['halted'])
		expect(statusText(0x6C000003)).toBe('nZCvIF SVC')
	})
})

describe('ARM26 interrupts', () => {
	const vectors = '\t.org 0\n\tb reset\n\tb .\n\t.word 0\n\tb .\n\tb .\n\tb .\n\tb irq\n\tb .\n'

	it('holds IRQ while I is set, and takes it once I clears', () => {
		const machine = boot(`${vectors}reset:\n\tldr r0, =KBD_STATUS\n\tmov r1, #2\n\tstr r1, [r0]\n\tmov r2, #1\n\tteqp pc, #0\nspin:\tb spin\nirq:\tldr r0, =KBD_DATA\n\tldr r3, [r0]\n\tswi OS_Exit\n`)
		machine.keyboard.queue('k')
		// The branch to reset, then four instructions in SVC with I set.
		for (let step = 0; step < 5; step++) expect(machine.step()).not.toBe(STEP_INTERRUPT)
		expect(machine.cpu.psr & PSR_I).toBe(PSR_I)
		// TEQP drops to USR with I clear, so the next step is the interrupt.
		expect(machine.step()).not.toBe(STEP_INTERRUPT)
		expect(machine.cpu.psr & PSR_I).toBe(0)
		expect(machine.step()).toBe(STEP_INTERRUPT)
		expect(machine.cpu.mode).toBe(MODE_IRQ)
		expect(machine.cpu.pc).toBe(VECTOR_IRQ)
		// R14_irq: spin, the instruction it would have run, + 4, with USR's status bits.
		expect(machine.cpu.register(14)).toBe(0x34 + 4)
		expect(machine.run(10)).toBe(STEP_HALT)
		expect(machine.cpu.register(3)).toBe('k'.charCodeAt(0))
	})

	it('ignores the keyboard while the IRQ vector is empty', () => {
		const machine = boot('\tldr r0, =KBD_STATUS\n\tmov r1, #2\n\tstr r1, [r0]\n\tmov r2, #1\n\tswi OS_Exit\n')
		machine.keyboard.queue('k')
		expect(machine.cpu.mode).toBe(MODE_USR)
		expect(machine.run(10)).toBe(STEP_HALT)
		expect(machine.keyboard.inputIndex).toBe(0)
	})
})
