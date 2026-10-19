import { describe, expect, it } from 'vitest'
import { faultMessage, R_XP, STEP_FAULT, STEP_HALT, STEP_INTERRUPT, STEP_OK, STEP_WAIT } from '../cpu'
import { EXAMPLES } from '../examples'
import definition from '../index'
import { BetaMachine, CLOCK_PERIOD, IRQ_CLOCK, IRQ_KEYBOARD, KEY_INTERVAL } from '../machine'
import type { BetaRuntime } from '../runtime'
import { DEFAULT_BETA_SETTINGS } from '../settings'
import { assembleUasm } from '../uasm'

const SUPERVISOR = 0x80000000

/**
 * Reset drops to user mode at `user`, which spins. The clock handler counts
 * in R1, the keyboard handler reads into R2 and counts in R4; both return to
 * the interrupted instruction, as TinyOS's ENTER_INTERRUPT does.
 */
const KERNEL = `.include "beta.uasm"
. = VEC_RESET
	BR(reset)
. = VEC_II
	HALT()
. = VEC_SEGFAULT
	HALT()
. = VEC_CLK
	BR(clock)
. = VEC_KBD
	BR(keyboard)
. = VEC_MOUSE
	HALT()
reset:
	CMOVE(user, XP)
	JMP(XP)
clock:
	SUBC(XP, 4, XP)
	ADDC(R1, 1, R1)
	JMP(XP)
keyboard:
	SUBC(XP, 4, XP)
	RDCHAR()
	MOVE(R0, R2)
	ADDC(R4, 1, R4)
	JMP(XP)
user:
	BR(user)
`

function machine(code: string, historyLimit = 0) {
	const { image, diagnostics, directives } = assembleUasm({ name: 'main.uasm', code })
	expect(diagnostics).toEqual([])
	const { tty, clock, segmentation } = directives.options
	const result = new BetaMachine({ memoryBytes: 0x10000, tty, clock, segmentation, historyLimit })
	result.load(image!)
	return { machine: result, labels: new Map(image!.symbols.map(({ name, address }) => [name, address])) }
}

/** Steps `count` times; returns the 1-based steps that took an interrupt. */
function interrupts(m: BetaMachine, count: number): number[] {
	const taken: number[] = []
	for (let step = 1; step <= count; step++) {
		const status = m.step()
		if (status === STEP_INTERRUPT) taken.push(step)
		else expect(status).toBe(STEP_OK)
	}
	return taken
}

describe('Beta clock interrupt (.options clock)', () => {
	it('interrupts every 10,000 cycles in user mode, with XP = PC + 4', () => {
		const { machine: m, labels } = machine(`.options clock\n${KERNEL}`)
		expect(interrupts(m, CLOCK_PERIOD - 1)).toEqual([])
		expect(m.step()).toBe(STEP_INTERRUPT)
		expect(m.cpu.pc).toBe((SUPERVISOR | 12) >>> 0)
		expect(m.cpu.registers[R_XP]).toBe(labels.get('user')! + 4)
		// The cycle that took it counts toward the next period, the handler's three too.
		expect(interrupts(m, CLOCK_PERIOD * 2)).toEqual([CLOCK_PERIOD, CLOCK_PERIOD * 2])
		// The last was taken on the final step, so its handler has not counted it.
		expect(m.cpu.registers[1]).toBe(2)
	})

	it('does not tick without the option', () => {
		const { machine: m } = machine(KERNEL)
		expect(interrupts(m, CLOCK_PERIOD * 3)).toEqual([])
	})

	it('holds a request raised in supervisor mode until user mode', () => {
		const code = KERNEL.replace('reset:\n', 'reset:\n\tCMOVE(6000, R3)\nwait:\n\tSUBC(R3, 1, R3)\n\tBNE(R3, wait)\n')
		const { machine: m, labels } = machine(`.options clock\n${code}`)
		// BR, CMOVE and 6000 rounds of SUBC and BNE run in supervisor mode.
		expect(interrupts(m, 2 + 2 * 6000)).toEqual([])
		expect(m.console.pending).toBe(IRQ_CLOCK)
		expect(interrupts(m, 3)).toEqual([3])
		expect(m.cpu.registers[R_XP]).toBe(labels.get('user')! + 4)
	})
})

describe('Beta keyboard interrupt (.options tty)', () => {
	it('raises one per typed character, KEY_INTERVAL cycles apart, read by RDCHAR', () => {
		const { machine: m } = machine(`.options tty\n${KERNEL}`)
		m.console.feed('ab')
		// The first arrives in the first cycle, and is taken once reset reaches user mode.
		expect(interrupts(m, KEY_INTERVAL + 10)).toEqual([4, KEY_INTERVAL + 2])
		expect(m.cpu.registers[4]).toBe(2)
		expect(m.cpu.registers[2]).toBe('b'.charCodeAt(0))
		expect(m.console.typed).toBe(false)
	})

	it('takes the clock before the keyboard', () => {
		const { machine: m } = machine(`.options tty clock\n${KERNEL}`)
		interrupts(m, 3)
		m.console.pending = IRQ_CLOCK | IRQ_KEYBOARD
		expect(m.step()).toBe(STEP_INTERRUPT)
		expect(m.cpu.pc).toBe((SUPERVISOR | 12) >>> 0)
		expect(m.console.pending).toBe(IRQ_KEYBOARD)
	})

	it('still hands a polling RDCHAR typed text at once', () => {
		const { machine: m } = machine('.include "beta.uasm"\n.options tty\n\tRDCHAR()\n\tRDCHAR()\n\tHALT()\n')
		expect(m.step()).toBe(STEP_WAIT)
		m.console.feed('xy')
		expect(m.run(10)).toBe(STEP_HALT)
		expect(m.cpu.registers[0]).toBe('y'.charCodeAt(0))
	})
})

/** Everything a rewind has to put back. */
function snapshot(m: BetaMachine) {
	const { console: tty, cpu } = m
	return {
		registers: [...cpu.registers], pc: cpu.pc, memory: Buffer.from(cpu.memory).toString('base64'),
		segBase: cpu.segBase, segBounds: cpu.segBounds, tick: m.tick, count: m.instructionCount,
		output: tty.output, inputIndex: tty.inputIndex, key: tty.key, pending: tty.pending, keyWait: tty.keyWait,
	}
}

/** Steps through traps and interrupts until `count` steps or something stops it. */
function steps(m: BetaMachine, count: number) {
	for (let step = 0; step < count; step++) {
		const status = m.step()
		if (status === STEP_WAIT || status === STEP_HALT) return status
		if (status === STEP_FAULT) throw new Error(faultMessage(m.cpu.fault, m.cpu.faultAddress))
	}
	return STEP_OK
}

describe('TinyOS', () => {
	const tinyOs = (historyLimit = 0) => machine(EXAMPLES.tinyosSolved.code, historyLimit).machine

	it('ships the lab version with Design Problem 1 left to the student', () => {
		expect(EXAMPLES.tinyos.code).toContain('[Design Problem 1] your code here...')
		expect(EXAMPLES.tinyosSolved.code).not.toContain('[Design Problem 1] your code here')
		expect(assembleUasm({ name: 'tinyos.uasm', code: EXAMPLES.tinyos.code }).diagnostics).toEqual([])
	})

	it('assembles with clock, tty and segmentation, and lays out its segments', () => {
		const { image, diagnostics, directives, values } = assembleUasm({ name: 'tinyos.uasm', code: EXAMPLES.tinyosSolved.code })
		expect(diagnostics).toEqual([])
		expect(directives.options).toMatchObject({ clock: true, tty: true, segmentation: true })
		const p0 = values.get('P0_base')!
		const p1 = values.get('P1_base')!
		expect(p0 % 4).toBe(0)
		expect(p1).toBe(p0 + values.get('P0_bounds')!)
		// P1 starts at its virtual 0 with CMOVE(Stack, SP): an ADDC from R31 into SP.
		const word = image!.sections.find((section) => section.address === p1)!.bytes
		expect(((word[3] << 24) | (word[2] << 16)) >>> 16).toBe((0x30 << 10) | (29 << 5) | 31)
	})

	it('prompts, then pig-latins a typed line while process 1 counts', () => {
		const m = tinyOs()
		steps(m, 300_000)
		expect(m.console.output).toBe('Start typing, Bunky.\n\n\n> ')
		m.console.feed('hello there\nquick brown fox\n')
		steps(m, 3_000_000)
		expect(m.console.output).toBe('Start typing, Bunky.\n\n\n> hello there\nELLOHAY ERETHAY\n\n> quick brown fox\nUICKQAY OWNBRAY OXFAY\n\n> \n00001000> ')
	})

	it('rewinds through interrupts and replays the same run', () => {
		const m = tinyOs(1 << 20)
		steps(m, 200_000)
		m.console.feed('hi\n')
		// Mid clock period, and between one typed character and the next.
		steps(m, KEY_INTERVAL + 1234)
		const mark = m.history!.length
		const before = snapshot(m)
		expect(before.keyWait).toBeGreaterThan(0)
		expect(before.tick).toBeGreaterThan(0)
		steps(m, 400_003)
		const after = snapshot(m)
		expect(after.output).toContain('IHAY')
		expect([after.tick, after.keyWait]).not.toEqual([before.tick, before.keyWait])

		m.history!.rewindTo(mark)
		expect(snapshot(m)).toEqual(before)
		steps(m, 400_003)
		expect(snapshot(m)).toEqual(after)
	})
})

describe('TinyOS through the machine contract', () => {
	function runtime() {
		const services = definition.createServices()
		const program = services.assemble({ files: [{ name: 'tinyos.uasm', code: EXAMPLES.tinyosSolved.code }], entries: ['tinyos.uasm'] }, DEFAULT_BETA_SETTINGS)
		expect(program.diagnostics).toEqual([])
		return services.createMachine(program, DEFAULT_BETA_SETTINGS, { speed: null, historyLimit: 100_000 }) as BetaRuntime
	}

	it('takes typed lines as keyboard interrupts once user mode has run', () => {
		const machine = runtime()
		expect(machine.pendingInput).toBeNull()
		for (let step = 0; step < 300_000; step++) machine.step()
		expect(machine.pendingInput?.prompt).toMatch(/keyboard/)
		expect(machine.provideInput('hello there')).toBe(true)
		expect(machine.pendingInput).toBeNull()
		for (let step = 0; step < 1_000_000; step++) machine.step()
		expect(machine.console).toContain('ELLOHAY ERETHAY')
		// User-mode addresses reach the editor physically.
		expect(machine.pc).toBe(machine.machine.cpu.fetchAddress())
	})

	it('names interrupts in the history', () => {
		const machine = runtime()
		for (let step = 0; step < 2 * CLOCK_PERIOD; step++) machine.step()
		const records = machine.history.slice(0, machine.history.length)
		const clock = records.filter((record) => machine.historyFormat.instruction(record) === 'clock interrupt')
		expect(clock.length).toBeGreaterThan(0)
		expect(machine.toolConfig().instructions?.decodeExecuted(clock[0])).toBeNull()
	})
})
