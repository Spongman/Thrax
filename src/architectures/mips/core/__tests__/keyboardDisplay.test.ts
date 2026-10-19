import { mipsHistorySchema } from '../../history/schema'
import { describe, expect, it } from 'vitest'
import { assembleMips } from '../../assembler'
import { firstError } from '../../../../core/diagnostics'
import { MipsSimulator } from '../simulator'

const MMIO = 0xffff0000

function build(source: string) {
	const { program, machineCode, diagnostics } = assembleMips(source)
	expect(firstError(diagnostics)?.message).toBeUndefined()
	return new MipsSimulator(machineCode, program, undefined, { historySchema: mipsHistorySchema })
}

/** Writes `$t1` to the transmitter data register, as a whole word. */
const SEND = `
main:	lui $t0, 0xffff
	sw $t1, 0xc($t0)
	nop
`

function send(word: number) {
	const simulator = build(SEND)
	simulator.registers.$t1 = word | 0
	simulator.step()
	simulator.step()
	return simulator
}

describe('the transmitter', () => {
	it('prints the low byte of the word', () => {
		expect(send('A'.charCodeAt(0)).keyboardDisplay.displayOutput).toBe('A')
	})

	it('clears the display on a form feed', () => {
		const simulator = build(SEND)
		simulator.keyboardDisplay.displayOutput = 'stale'
		simulator.registers.$t1 = 12
		simulator.step()
		simulator.step()
		expect(simulator.keyboardDisplay.displayOutput).toBe('')
	})

	it('places the cursor from the high bits, turning the display into a field', () => {
		// ASCII 7 with column 3 in bits 20-31 and row 1 in bits 8-19.
		const simulator = send((3 << 20) | (1 << 8) | 7)
		const rows = simulator.keyboardDisplay.displayOutput.split('\n')
		expect(rows).toHaveLength(simulator.displayRows)
		expect(rows[0]).toHaveLength(simulator.displayColumns)
	})

	it('writes where the cursor was placed rather than at the end', () => {
		const simulator = build(`
main:	lui $t0, 0xffff
	li $t1, 0x00300107
	sw $t1, 0xc($t0)
	li $t1, 0x5a
	sw $t1, 0xc($t0)
	nop
`)
		// `li` of a 32-bit constant expands to two instructions, so this is more
		// steps than there are source lines.
		for (let index = 0; index < 8; index++) simulator.step()

		const rows = simulator.keyboardDisplay.displayOutput.split('\n')
		// Column 3 of row 1, and nothing anywhere else.
		expect(rows[1][3]).toBe('Z')
		expect(rows[0].trim()).toBe('')
		expect(rows[1].trim()).toBe('Z')
	})
})

describe('the device control registers', () => {
	it('reports the receiver ready only while a character is waiting', () => {
		const simulator = build('main:\tlui $t0, 0xffff\n\tlw $t1, 0($t0)\n\tnop\n')
		simulator.step()
		simulator.step()
		expect(simulator.registers.$t1 & 1).toBe(0)

		simulator.keyboardDisplay.queuedInput = 'a'
		simulator.setProgramCounter(0x00400004)
		simulator.step()
		expect(simulator.registers.$t1 & 1).toBe(1)
	})

	it('remembers the interrupt-enable bit the program wrote', () => {
		const simulator = build('main:\tlui $t0, 0xffff\n\tli $t1, 2\n\tsw $t1, 0($t0)\n\tlw $t2, 0($t0)\n\tnop\n')
		for (let index = 0; index < 4; index++) simulator.step()

		expect(simulator.receiverInterruptEnabled).toBe(true)
		expect(simulator.registers.$t2 & 2).toBe(2)
	})

	it('holds the transmitter busy for the delay it was given', () => {
		const simulator = build(`
main:	lui $t0, 0xffff
	li $t1, 0x41
	sw $t1, 0xc($t0)
	lw $t2, 8($t0)
	nop
	nop
	lw $t3, 8($t0)
`)
		simulator.transmitterDelay = 2
		for (let index = 0; index < 4; index++) simulator.step()
		// Still sending, so not ready.
		expect(simulator.registers.$t2 & 1).toBe(0)

		for (let index = 0; index < 3; index++) simulator.step()
		expect(simulator.registers.$t3 & 1).toBe(1)
	})

	it('is ready at once with no delay set, which is the default', () => {
		const simulator = build('main:\tlui $t0, 0xffff\n\tli $t1, 0x41\n\tsw $t1, 0xc($t0)\n\tlw $t2, 8($t0)\n\tnop\n')
		for (let index = 0; index < 4; index++) simulator.step()
		expect(simulator.registers.$t2 & 1).toBe(1)
	})
})
