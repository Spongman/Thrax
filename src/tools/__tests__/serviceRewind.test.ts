import { describe, expect, it } from 'vitest'
import { Assembler } from '../../core/assembler'
import { firstError } from '../../core/diagnostics'
import { Kind } from '../../core/effectKind'
import { MipsSimulator } from '../../core/simulator'
import { COUNTER_OFFSET, DISPLAY_RIGHT_OFFSET, DigitalLabSim } from '../digitalLab'
import { MarsBot, MARS_BOT_ADDRESSES } from '../marsBot'
import { createToolRegistry } from '../registry'

/**
 * A tool holding state of its own cannot be worked out again from the log the
 * way a tally can: where the bot is depends on every heading it was given along
 * the way.  So it says what it held as an instruction changes it, and the
 * machine hands that back on the way past.  These check that the machine can do
 * that without knowing what any of it means.
 */

const { heading: HEADING, leaveTrack: LEAVE_TRACK, move: MOVE } = MARS_BOT_ADDRESSES

/** Drives the bot: start moving, turn twice, leave a track, then stop. */
const PROGRAM = `
	.text
main:
	li $t0, 1
	li $t1, ${MOVE}
	sw $t0, 0($t1)
	li $t1, ${LEAVE_TRACK}
	sw $t0, 0($t1)
	li $t2, 8
turn:
	li $t1, ${HEADING}
	li $t3, 90
	sw $t3, 0($t1)
	nop
	nop
	nop
	li $t3, 180
	sw $t3, 0($t1)
	nop
	nop
	nop
	addi $t2, $t2, -1
	bgtz $t2, turn
	li $v0, 10
	syscall
`

function build() {
	const { program, machineCode, diagnostics } = new Assembler(PROGRAM).assemble()
	expect(firstError(diagnostics)?.message).toBeUndefined()
	const simulator = new MipsSimulator(machineCode, program)
	const bot = new MarsBot()
	bot.onConfigure({ delayedBranching: false, services: simulator })
	simulator.observers.push(bot)
	return { simulator, bot }
}

const stepTo = (simulator: MipsSimulator, count: number) => {
	while (simulator.instructionCount < count && !simulator.halted) simulator.step()
}

describe('a tool that keeps state of its own', () => {
	it('is driven by the program at all', () => {
		const { simulator, bot } = build()
		stepTo(simulator, 60)
		const view = bot.snapshot()
		expect(view.moving).toBe(true)
		expect(view.leavingTrack).toBe(true)
		expect(view.heading).toBeGreaterThan(0)
		expect(Math.abs(view.x) + Math.abs(view.y)).toBeGreaterThan(0)
	})

	it('comes back to where it was when the machine steps back', () => {
		const { simulator, bot } = build()
		stepTo(simulator, 40)
		const atForty = bot.snapshot()

		stepTo(simulator, 120)
		expect(bot.snapshot()).not.toEqual(atForty)

		while (simulator.instructionCount > 40) simulator.stepBack()
		expect(bot.snapshot()).toEqual(atForty)
	})

	it('agrees with a run that stopped there, not merely with itself', () => {
		const straight = build()
		stepTo(straight.simulator, 45)

		const long = build()
		stepTo(long.simulator, 200)
		while (long.simulator.instructionCount > 45) long.simulator.stepBack()

		expect(long.bot.snapshot()).toEqual(straight.bot.snapshot())
	})

	it('lands on the same place over several passes', () => {
		const { simulator, bot } = build()
		stepTo(simulator, 90)
		const settled = bot.snapshot()

		for (let pass = 0; pass < 3; pass++) {
			while (simulator.stepBack()) { /* to the start */ }
			expect(bot.snapshot().segments).toEqual([])
			stepTo(simulator, 90)
			expect(bot.snapshot()).toEqual(settled)
		}
	})

	it('names itself in the history without the machine knowing what it holds', () => {
		const { simulator } = build()
		stepTo(simulator, 60)
		const named: string[] = []
		for (let index = 0; index < simulator.executionHistory.length; index++) {
			const entry = simulator.executionHistory.at(index)!
			for (let offset = 0; offset < entry.effectCount; offset++) {
				const effect = simulator.effects.materialize(entry.effectStart + offset)
				if (effect.kind === Kind.SERVICE) named.push(effect.name)
			}
		}
		expect(named.length).toBeGreaterThan(0)
		expect(new Set(named)).toEqual(new Set(['Mars Bot']))
	})

	it('costs the machine nothing while no tool is watching', () => {
		const { program, machineCode } = new Assembler(PROGRAM).assemble()
		const simulator = new MipsSimulator(machineCode, program)
		stepTo(simulator, 120)
		// Every effect belongs to the program's own writes; the bot recorded none.
		const entry = simulator.executionHistory.at(50)!
		expect(entry.effectCount).toBeLessThan(4)
	})
})

/** Lights a display and runs the counter, which ticks on every instruction. */
const LAB_PROGRAM = `
	.text
main:
	li $t1, 0xffff0010
	li $t0, 0x7e
	sb $t0, ${DISPLAY_RIGHT_OFFSET - 0x10}($t1)
	li $t0, 1
	sb $t0, ${COUNTER_OFFSET - 0x10}($t1)
	li $t2, 400
spin:
	addi $t2, $t2, -1
	bgtz $t2, spin
	li $v0, 10
	syscall
`

function lab() {
	const { program, machineCode, diagnostics } = new Assembler(LAB_PROGRAM).assemble()
	expect(firstError(diagnostics)?.message).toBeUndefined()
	const simulator = new MipsSimulator(machineCode, program)
	const tool = new DigitalLabSim()
	tool.onConfigure({ delayedBranching: false, device: simulator.devicePort(), services: simulator })
	simulator.observers.push(tool)
	return { simulator, tool }
}

describe('a second service on the same machine', () => {
	it('rolls the digital lab back with everything else', () => {
		const straight = lab()
		stepTo(straight.simulator, 80)
		const atEighty = straight.tool.snapshot()
		expect(atEighty.displays[0]).toBe(0x7e)
		expect(atEighty.counterEnabled).toBe(true)

		const long = lab()
		stepTo(long.simulator, 300)
		expect(long.tool.snapshot().counterRemaining).not.toBe(atEighty.counterRemaining)

		while (long.simulator.instructionCount > 80) long.simulator.stepBack()
		expect(long.tool.snapshot()).toEqual(atEighty)
	})

	it('keeps two services apart', () => {
		const { simulator } = lab()
		const bot = new MarsBot()
		bot.onConfigure({ delayedBranching: false, services: simulator })
		simulator.observers.push(bot)

		stepTo(simulator, 200)
		const settled = simulator.observers.map((observer) => JSON.stringify((observer as { snapshot(): unknown }).snapshot()))
		while (simulator.instructionCount > 40) simulator.stepBack()
		stepTo(simulator, 200)

		expect(simulator.observers.map((observer) => JSON.stringify((observer as { snapshot(): unknown }).snapshot()))).toEqual(settled)
	})
})

describe('a service reaching the panels', () => {
	it('offers a fresh reading after a step back, though nothing told the tool', () => {
		const { program, machineCode } = new Assembler(PROGRAM).assemble()
		const simulator = new MipsSimulator(machineCode, program)
		const tools = createToolRegistry()
		tools.setWanted(new Set(['marsBot']))
		tools.attach(simulator, { delayedBranching: false, device: simulator.devicePort() })

		stepTo(simulator, 120)
		const moved = tools.views().marsBot
		expect(moved.moving).toBe(true)

		while (simulator.instructionCount > 40) simulator.stepBack()
		// The machine rolled the bot back behind the observer seam, so a reading
		// held from before the step back would be of somewhere the bot is not.
		expect(tools.views().marsBot).not.toEqual(moved)
		expect(tools.views().marsBot).toEqual((tools.instance('marsBot') as MarsBot).snapshot())
	})
})
