import { describe, expect, it } from 'vitest'
import { SLOT_COUNT } from '../cpu'
import { EXAMPLES } from '../examples'
import { FIELD_COUNT, STEP_HALT, STEP_WAIT, type Z80Machine } from '../machine'
import { machineFor } from './helpers'

/** Everything a step can change, as one comparable value. */
function stateOf(machine: Z80Machine) {
	const { cpu, console, callStack } = machine
	let memory = 0
	for (let address = 0; address < cpu.memory.length; address++) memory = (Math.imul(memory, 31) + cpu.memory[address]) | 0
	return {
		slots: Array.from({ length: SLOT_COUNT }, (_, slot) => cpu.slot(slot)),
		fields: Array.from({ length: FIELD_COUNT }, (_, field) => machine.field(field)),
		cycles: cpu.cycles,
		timerDue: console.timerDue,
		keyDue: console.keyDue,
		output: console.output,
		count: machine.instructionCount,
		frames: callStack.frames(),
		memory,
	}
}

/** Runs to the end recording the state before each step, then steps back through all of them. */
function rewindsExactly(code: string, input: string) {
	const { machine } = machineFor(code, 1_000_000)
	const states = [stateOf(machine)]
	let pending = input
	for (let step = 0; step < 20_000; step++) {
		const status = machine.step()
		if (status === STEP_WAIT) {
			if (!pending) break
			machine.console.feed(pending)
			pending = ''
		}
		if (machine.history!.length === states.length) states.push(stateOf(machine))
		if (status === STEP_HALT) break
	}
	expect(machine.halted).toBe(true)
	while (machine.history!.timeline.index > 0) {
		machine.history!.stepBack()
		const expected = states[machine.history!.timeline.index]
		const actual = stateOf(machine)
		// What was typed stays typed; the rest is as it was.
		expect({ ...actual, input: undefined }).toEqual({ ...expected, input: undefined })
	}
}

describe('Z80 history', () => {
	it('rewinds calls and stack traffic to each earlier state', () => {
		rewindsExactly(EXAMPLES.loop.code, '')
	})

	it('rewinds interrupts, HALT and the timer', () => {
		rewindsExactly(EXAMPLES.timer.code, '')
	})

	it('rewinds keyboard input and its interrupts', () => {
		rewindsExactly(EXAMPLES.keyboard.code, 'ab.')
	})

	it('rewinds a read that waited for input', () => {
		rewindsExactly(EXAMPLES.input.code, 'xyz\n')
	})

	it('records an edit as its own entry', () => {
		const { machine } = machineFor('\tld a,1\n\thalt\n', 100)
		machine.step()
		expect(machine.editSlot(0, 0x4200)).toBe(true)
		expect(machine.cpu.a).toBe(0x42)
		machine.history!.stepBack()
		expect(machine.cpu.a).toBe(1)
		expect(machine.editBytes(0x8000, [1, 2])).toBe(true)
		machine.history!.stepBack()
		expect(machine.cpu.memory[0x8001]).toBe(0)
	})
})

describe('Z80 call stack', () => {
	it('follows CALL, RST, conditional calls and returns', () => {
		const { machine, values } = machineFor([
			'\tld sp,$F000',
			'\tcall first',
			'\thalt',
			'first:',
			'\tscf',
			'\tcall c,second',
			'\tret',
			'second:',
			'\trst $38',
			'\tret',
			'\torg $38',
			'\tret',
		].join('\n'), 100)
		const depths: number[] = []
		for (let step = 0; step < 20 && !machine.halted; step++) {
			machine.step()
			depths.push(machine.callStack.depth)
		}
		expect(depths).toEqual([0, 1, 1, 2, 3, 2, 1, 0, 0])
		const frames = machine.callStack.frames()
		expect(frames).toEqual([])
		expect(values.get('first')).toBeDefined()
	})

	it('names the call site, return address and callee of each frame', () => {
		const { machine, values } = machineFor('\tld sp,$F000\n\tcall routine\n\thalt\nroutine:\tnop\n\tret\n', 100)
		machine.step()
		machine.step()
		expect(machine.callStack.frames()).toEqual([{ callSite: 3, returnAddress: 6, callee: values.get('routine'), stackPointer: 0xEFFE }])
	})
})
