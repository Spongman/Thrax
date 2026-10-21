import { mipsHistorySchema } from '../../history/schema'
import { describe, expect, it } from 'vitest'
import { assembleMips } from '../../assembler'
import { firstError } from '../../../../core/diagnostics'
import { MipsSimulator } from '../../core/simulator'
import {
	COUNTER_OFFSET,
	COUNTER_PERIOD,
	DISPLAY_LEFT_OFFSET,
	DISPLAY_RIGHT_OFFSET,
	DigitalLabSim,
	KEYPAD_OUT_OFFSET,
	KEYPAD_ROW_OFFSET,
	KEYPAD_INTERRUPT,
	TIMER_INTERRUPT,
	keyInRow,
	keypadCode,
} from '../digitalLab'

const BASE = 0xffff0000

function build({ accept = true } = {}) {
	const written = new Map<number, number>()
	/** Causes handed to the machine, which is where an interrupt actually goes. */
	const raised: number[] = []
	const device = new DigitalLabSim()
	device.onConfigure({
		delayedBranching: false,
		device: {
			read: (address) => written.get(address) ?? 0,
			write: (address, value) => { written.set(address, value) },
			requestInterrupt: (cause) => {
				if (accept) raised.push(cause)
				return accept
			},
		},
	})
	const write = (offset: number, value: number) => device.onMemoryWrite(BASE + offset, 1, value)
	return { device, written, raised, write, answer: () => written.get(BASE + KEYPAD_OUT_OFFSET) ?? 0 }
}

describe('the keypad encoding', () => {
	it('reads a key back as its row and column, as the exercises document', () => {
		// Key 2 sits in column 3 of row 1, which the help text says is 0x41.
		expect(keypadCode(2)).toBe(0x41)
		expect(keypadCode(0)).toBe(0x11)
		expect(keypadCode(15)).toBe(0x88)
	})

	it('places each key in the row a scan of that row finds', () => {
		expect(keyInRow(2, 0x1)).toBe(true)
		expect(keyInRow(2, 0x2)).toBe(false)
		expect(keyInRow(7, 0x2)).toBe(true)
	})
})

describe('the seven-segment displays', () => {
	it('lights the segments the program writes, right and left apart', () => {
		const { device, write } = build()
		write(DISPLAY_RIGHT_OFFSET, 0x3f)
		write(DISPLAY_LEFT_OFFSET, 0x06)
		expect(device.snapshot().displays).toEqual([0x3f, 0x06])
	})
})

describe('scanning the keypad', () => {
	it('answers with the key only while its own row is selected', () => {
		const { device, write, answer } = build()
		device.pressKey(2)

		write(KEYPAD_ROW_OFFSET, 0x2)
		expect(answer()).toBe(0)

		write(KEYPAD_ROW_OFFSET, 0x1)
		expect(answer()).toBe(0x41)
	})

	it('answers with nothing once the key is released', () => {
		const { device, write, answer } = build()
		write(KEYPAD_ROW_OFFSET, 0x1)
		device.pressKey(2)
		expect(answer()).toBe(0x41)

		device.pressKey(null)
		expect(answer()).toBe(0)
	})

	it('raises an interrupt only when the high nibble enabled it', () => {
		const { device, raised, write } = build()
		write(KEYPAD_ROW_OFFSET, 0x01)
		device.pressKey(2)
		expect(raised).toEqual([])

		write(KEYPAD_ROW_OFFSET, 0x81)
		device.pressKey(3)
		expect(raised).toEqual([KEYPAD_INTERRUPT])
		expect(device.snapshot().keypadInterrupts).toBe(1)
	})

	it('counts nothing the machine refused', () => {
		// Refused means the machine is already in a handler, so the program never
		// sees it; counting it would report an interrupt that never arrived.
		const { device, raised, write } = build({ accept: false })
		write(KEYPAD_ROW_OFFSET, 0x81)
		device.pressKey(3)
		expect(raised).toEqual([])
		expect(device.snapshot().keypadInterrupts).toBe(0)
		expect(device.lastInterrupt).toBeNull()
	})
})

describe('the counter', () => {
	it('stays quiet until the program enables it', () => {
		const { device } = build()
		for (let index = 0; index < COUNTER_PERIOD * 2; index++) device.onInstruction()
		expect(device.snapshot().timerInterrupts).toBe(0)
	})

	it('raises a timer interrupt every period once enabled', () => {
		const { device, raised, write } = build()
		write(COUNTER_OFFSET, 1)

		for (let index = 0; index < COUNTER_PERIOD; index++) device.onInstruction()
		expect(device.snapshot().timerInterrupts).toBe(0)

		device.onInstruction()
		expect(device.snapshot().timerInterrupts).toBe(1)
		expect(raised).toEqual([TIMER_INTERRUPT])
	})

	it('is turned off again by a zero', () => {
		const { device, write } = build()
		write(COUNTER_OFFSET, 1)
		write(COUNTER_OFFSET, 0)
		for (let index = 0; index < COUNTER_PERIOD * 2; index++) device.onInstruction()
		expect(device.snapshot().timerInterrupts).toBe(0)
	})
})

describe('an interrupt reaching the machine', () => {
	/**
	 * Enables the counter, then spins.  The handler counts the interrupts it was
	 * given and returns to the instruction that was interrupted.
	 */
	const SOURCE = `
main:	lui $t0, 0xffff
	li $t1, 1
	sb $t1, 0x13($t0)
loop:	addi $s1, $s1, 1
	j loop

	.ktext 0x80000180
	addi $s0, $s0, 1
	eret
`

	function machine() {
		const { program, machineCode, diagnostics } = assembleMips(SOURCE)
		expect(firstError(diagnostics)?.message).toBeUndefined()
		const simulator = new MipsSimulator(machineCode, program, undefined, { historySchema: mipsHistorySchema })
		const device = new DigitalLabSim()
		device.onConfigure({ delayedBranching: false, device: simulator.devicePort() })
		simulator.observers.push(device)
		return { simulator, device }
	}

	it('enters the handler and returns to the instruction it interrupted', () => {
		const { simulator, device } = machine()
		for (let index = 0; index < COUNTER_PERIOD * 3; index++) simulator.step()

		expect(device.snapshot().timerInterrupts).toBeGreaterThan(0)
		expect(simulator.registers.$s0).toBe(device.snapshot().timerInterrupts)
		// An interrupt is not a fault: the exception code stays zero and the
		// device names itself with a pending bit, bit 10 for the timer.
		expect(simulator.cp0Registers[13] & 0x7c).toBe(0)
		expect(simulator.cp0Registers[13] & (TIMER_INTERRUPT << 2)).toBe(TIMER_INTERRUPT << 2)
		// EPC is the interrupted instruction, which the handler returns to rather
		// than skipping: the spin keeps counting across every interrupt.
		expect(simulator.registers.$s1).toBeGreaterThan(0)
		expect(simulator.halted).toBe(false)
	})

	it('leaves the interrupt out of the count while the handler is running', () => {
		// EXL is set for the length of the handler, so a second interrupt raised
		// there is refused rather than overwriting the return address.
		const { simulator, device } = machine()
		for (let index = 0; index < 3; index++) simulator.step()
		simulator.writeCp0(12, simulator.cp0Registers[12] | 0x2)

		for (let index = 0; index < COUNTER_PERIOD * 2; index++) simulator.step()
		expect(device.snapshot().timerInterrupts).toBe(0)
		expect(simulator.registers.$s0).toBe(0)
	})

	it('undoes the handler entry on a step back', () => {
		const { simulator } = machine()
		const status = simulator.cp0Registers[12]
		for (let index = 0; index < COUNTER_PERIOD * 2; index++) simulator.step()
		expect(simulator.registers.$s0).toBe(1)
		expect(simulator.cp0Registers[13] & (TIMER_INTERRUPT << 2)).not.toBe(0)

		// The cause, epc, and exception level the dispatch wrote are effects like
		// any other, so winding the whole run back leaves none of them standing.
		while (simulator.stepBack()) { /* back to the start */ }
		expect(simulator.registers.$s0).toBe(0)
		expect(simulator.cp0Registers[13]).toBe(0)
		expect(simulator.cp0Registers[14]).toBe(0)
		expect(simulator.cp0Registers[12]).toBe(status)
	})
})
