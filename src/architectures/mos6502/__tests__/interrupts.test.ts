import { describe, expect, it } from 'vitest'
import { assembleMos6502 } from '../assembler'
import { FLAG_B, FLAG_I, STEP_INTERRUPT, STEP_OK } from '../cpu'
import { Mos6502Machine } from '../machine'

/** Handlers that count into $20 (IRQ) and $21 (NMI), acknowledging the timer. */
const HANDLERS = `
irq:
	pha
	inc $20
	php                     ; what P the handler sees, B and all
	pla
	sta $22
	tsx
	lda $0102,x             ; the P the interrupt pushed: under PHA's byte
	sta $23
	sta $F002               ; acknowledge the timer
	lda $F001               ; and take a key, if that is the source
	pla
	rti
nmi:
	inc $21
	sta $F002
	rti
.org $FFFA
.word nmi, $0600, irq
`

function machineFor(code: string) {
	const { image, diagnostics } = assembleMos6502({ name: 'test.s', code: `.org $0600\n${code}\n${HANDLERS}` })
	expect(diagnostics).toEqual([])
	const machine = new Mos6502Machine()
	machine.load(image!)
	return machine
}

describe('6502 interrupts', () => {
	it('takes a keyboard IRQ once enabled with I clear, pushing B clear', () => {
		const machine = machineFor('lda #1\nsta $F004\nloop: jmp loop')
		machine.device.feed('k')
		// Reset leaves I set, so the key waits.
		machine.run(10)
		expect(machine.cpu.memory[0x20]).toBe(0)
		machine.cpu.p &= ~FLAG_I
		const before = machine.cpu.cycles
		expect(machine.step()).toBe(STEP_INTERRUPT)
		expect(machine.cpu.cycles - before).toBe(7)
		expect(machine.cpu.pc).toBe(machine.cpu.word(0xFFFE))
		expect(machine.cpu.p & FLAG_I).toBe(FLAG_I)
		machine.run(20)
		expect(machine.cpu.memory[0x20]).toBe(1)
		expect(machine.cpu.memory[0x23] & FLAG_B).toBe(0)
		// PHP inside the handler pushes B set.
		expect(machine.cpu.memory[0x22] & FLAG_B).toBe(FLAG_B)
		// The handler read the key, so the line dropped and the loop runs on.
		expect(machine.device.keyReady).toBe(false)
		expect(machine.cpu.p & FLAG_I).toBe(0)
	})

	it('holds IRQ while I is set and takes it after CLI', () => {
		const machine = machineFor('lda #1\nsta $F004\nnop\nnop\ncli\nnop\nloop: jmp loop')
		machine.device.feed('k')
		machine.run(4)
		expect(machine.cpu.memory[0x20]).toBe(0)
		expect(machine.step()).toBe(STEP_OK) // CLI
		expect(machine.step()).toBe(STEP_INTERRUPT)
		// The return address is the instruction after CLI.
		expect(machine.cpu.memory[0x01FC] | (machine.cpu.memory[0x01FD] << 8)).toBe(0x0608)
	})

	it('raises the timer IRQ every period cycles until acknowledged', () => {
		const machine = machineFor('lda #100\nsta $F005\nlda #2\nsta $F004\ncli\nloop: jmp loop')
		machine.run(500)
		const cycles = machine.cpu.cycles
		expect(machine.cpu.memory[0x20]).toBeGreaterThanOrEqual(Math.floor((cycles - 7 - 20) / 100) - 1)
		expect(machine.cpu.memory[0x20]).toBeLessThanOrEqual(Math.ceil(cycles / 100))
		expect(machine.cpu.memory[0x21]).toBe(0)
	})

	it('sends the timer to NMI when asked, regardless of I', () => {
		const machine = machineFor('lda #100\nsta $F005\nlda #4\nsta $F004\nsei\nloop: jmp loop')
		machine.run(500)
		expect(machine.cpu.memory[0x21]).toBeGreaterThan(5)
		expect(machine.cpu.memory[0x20]).toBe(0)
	})

	it('takes an NMI raised by hand before the next instruction, once', () => {
		const machine = machineFor('loop: jmp loop')
		machine.nmi()
		expect(machine.step()).toBe(STEP_INTERRUPT)
		expect(machine.cpu.pc).toBe(machine.cpu.word(0xFFFA))
		machine.run(20)
		expect(machine.cpu.memory[0x21]).toBe(1)
	})

	it('counts interrupts as no instruction', () => {
		const machine = machineFor('loop: jmp loop')
		machine.nmi()
		machine.step()
		expect(machine.instructionCount).toBe(0)
		machine.step()
		expect(machine.instructionCount).toBe(1)
	})
})
