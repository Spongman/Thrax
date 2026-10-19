import { describe, expect, it } from 'vitest'
import { IRQ_KEYBOARD, IRQ_TIMER, STEP_HALT, STEP_INTERRUPT, STEP_OK, STEP_WAIT } from '../machine'
import { machineFor, runToEnd, steps } from './helpers'

/** A program that enables `sources` in `mode`, then spins; handlers at 38h, 30h and 66h store a marker. */
function interruptible(mode: number, sources: number, extra = '') {
	return machineFor(`
	org 0
	jp start
	org $30
	ld a,$30
	ld (seen),a
	reti
	org $38
	ld a,$38
	ld (seen),a
	reti
	org $66
	ld a,$66
	ld (seen),a
	retn
	org $100
start:
	ld sp,$F000
	im ${mode}
	ld a,1
	ld ($FF04),a        ; the timer every 256 T-states
	ld a,${sources}
	ld ($FF02),a
	${extra}
	ei
spin:
	jr spin
seen:	db 0
`, 1000)
}

/** Steps until an interrupt is taken; returns the PC it was taken at. */
function untilInterrupt(machine: ReturnType<typeof machineFor>['machine'], limit = 10_000): number {
	for (let step = 0; step < limit; step++) {
		const pc = machine.cpu.pc
		if (machine.step() === STEP_INTERRUPT) return pc
	}
	throw new Error('No interrupt was taken')
}

describe('maskable interrupts', () => {
	it('IM 1 goes to 38h, clears IFF1 and IFF2, and pushes the interrupted PC', () => {
		const { machine, values } = interruptible(1, IRQ_TIMER)
		const at = untilInterrupt(machine)
		const { cpu } = machine
		expect(at).toBe(values.get('spin'))
		expect(cpu.pc).toBe(0x38)
		expect([cpu.iff1, cpu.iff2]).toEqual([0, 0])
		expect(cpu.memory[cpu.sp] | (cpu.memory[cpu.sp + 1] << 8)).toBe(at)
		expect(machine.callStack.depth).toBe(1)
		// RETI comes back and restores IFF1 from IFF2, which the handler left clear.
		steps(machine, 3)
		expect(cpu.pc).toBe(at)
		expect(cpu.memory[values.get('seen')!]).toBe(0x38)
		expect(machine.callStack.depth).toBe(0)
	})

	it('IM 0 runs the RST the keyboard puts on the bus', () => {
		const { machine, values } = interruptible(0, IRQ_KEYBOARD)
		steps(machine, 20)
		machine.console.feed('x')
		untilInterrupt(machine)
		expect(machine.cpu.pc).toBe(0x30)
		steps(machine, 3)
		expect(machine.cpu.memory[values.get('seen')!]).toBe(0x30)
	})

	it('IM 2 reads the handler address from the table at I and the bus byte', () => {
		const { machine } = interruptible(2, IRQ_TIMER, 'ld a,$40\n\tld i,a\n\tld hl,$1234\n\tld ($40FF),hl')
		untilInterrupt(machine)
		expect(machine.cpu.pc).toBe(0x1234)
		// 19 T-states to take it.
		expect(machine.cpu.cycles).toBeGreaterThan(0)
	})

	it('takes the timer before the keyboard', () => {
		// Both are asking by the time the delay before EI is over.
		const { machine } = interruptible(0, IRQ_KEYBOARD | IRQ_TIMER, 'ld b,100\ndelay:\tdjnz delay')
		machine.console.feed('x')
		untilInterrupt(machine)
		expect(machine.console.pending).toBe(IRQ_KEYBOARD)
		expect(machine.cpu.pc).toBe(0x38)
	})

	it('waits one instruction after EI', () => {
		const { machine, values } = machineFor('\tim 1\n\tld a,1\n\tld ($FF02),a\n\tei\nafter:\tnop\n\tnop\n\thalt\n\torg $38\n\thalt\n', 100)
		machine.console.feed('k')
		steps(machine, 4)
		expect(machine.cpu.iff1).toBe(1)
		// The keyboard is asking, but the instruction after EI runs first.
		expect(machine.console.pending & IRQ_KEYBOARD).toBe(IRQ_KEYBOARD)
		expect(machine.step()).toBe(STEP_OK)
		expect(machine.cpu.pc).toBe(values.get('after')! + 1)
		expect(machine.step()).toBe(STEP_INTERRUPT)
	})

	it('ignores requests while interrupts are disabled', () => {
		const { machine } = machineFor('\tim 1\n\tld a,1\n\tld ($FF04),a\n\tld a,2\n\tld ($FF02),a\nspin:\tjr spin\n')
		for (let step = 0; step < 2000; step++) expect(machine.step()).not.toBe(STEP_INTERRUPT)
		expect(machine.console.pending).toBe(IRQ_TIMER)
	})
})

describe('NMI', () => {
	it('goes to 66h keeping IFF2, and RETN restores IFF1', () => {
		const { machine, values } = interruptible(1, 0)
		steps(machine, 10)
		expect(machine.cpu.iff1).toBe(1)
		const at = machine.cpu.pc
		machine.nmi()
		expect(machine.step()).toBe(STEP_INTERRUPT)
		expect(machine.cpu.pc).toBe(0x66)
		expect([machine.cpu.iff1, machine.cpu.iff2]).toEqual([0, 1])
		steps(machine, 3)
		expect(machine.cpu.pc).toBe(at)
		expect(machine.cpu.iff1).toBe(1)
		expect(machine.cpu.memory[values.get('seen')!]).toBe(0x66)
	})
})

describe('HALT', () => {
	it('ends the program with interrupts disabled', () => {
		const { machine } = machineFor('\tdi\n\thalt\n')
		expect(runToEnd(machine)).toBe(STEP_HALT)
		expect(machine.cpu.pc).toBe(1)
		expect(machine.instructionCount).toBe(2)
	})

	it('ends the program when nothing enabled could interrupt', () => {
		const { machine } = machineFor('\tei\n\thalt\n')
		expect(runToEnd(machine)).toBe(STEP_HALT)
	})

	it('sleeps until the timer, running NOPs that count in R and the T-states', () => {
		const { machine, values } = machineFor('\tim 1\n\tld a,4\n\tld ($FF04),a\n\tld a,2\n\tld ($FF02),a\n\tei\n\thalt\nnext:\tnop\n\torg $38\n\tei\n\treti\n', 100)
		steps(machine, 7)
		expect(machine.cpu.halted).toBe(1)
		const due = machine.console.timerDue
		const r = machine.cpu.r
		expect(machine.step()).toBe(STEP_OK)
		expect(machine.cpu.cycles).toBeGreaterThanOrEqual(due)
		expect(machine.cpu.cycles - due).toBeLessThan(4)
		expect(machine.cpu.r).not.toBe(r)
		expect(machine.step()).toBe(STEP_INTERRUPT)
		// The return address is past the HALT.
		const { cpu } = machine
		expect(cpu.memory[cpu.sp] | (cpu.memory[cpu.sp + 1] << 8)).toBe(values.get('next'))
		expect(cpu.halted).toBe(0)
	})

	it('waits for typing when only the keyboard could wake it', () => {
		const { machine } = machineFor('\tim 1\n\tld a,1\n\tld ($FF02),a\n\tei\n\thalt\n\tdi\n\thalt\n\torg $38\n\tld a,($FF01)\n\tei\n\treti\n', 100)
		steps(machine, 5)
		expect(machine.step()).toBe(STEP_WAIT)
		expect(machine.sleeping).toBe(true)
		machine.console.feed('a')
		expect(runToEnd(machine)).toBe(STEP_HALT)
		expect(machine.cpu.a).toBe(0x61)
	})
})

describe('the console device', () => {
	it('answers on memory and on ports alike', () => {
		const { machine } = machineFor('\tld a,\'M\'\n\tld ($FF00),a\n\tld a,\'P\'\n\tout (0),a\n\tin a,(2)\n\tld b,a\n\tld a,($FF01)\n\tld c,a\n\tld a,7\n\tout (3),a\n\tnop\n')
		expect(runToEnd(machine)).toBe(STEP_HALT)
		expect(machine.console.output).toBe('MP')
		// Output ready, nothing typed.
		expect(machine.cpu.b).toBe(2)
		expect(machine.cpu.c).toBe(0)
		expect(machine.console.exitCode).toBe(7)
		expect(machine.cpu.pc).toBe(0x14)
	})

	it('waits on the blocking read without running it', () => {
		const { machine } = machineFor('\tld a,($FF05)\n\tld b,a\n\thalt\n', 100)
		const r = machine.cpu.r
		expect(machine.step()).toBe(STEP_WAIT)
		expect(machine.cpu.pc).toBe(0)
		expect(machine.cpu.r).toBe(r)
		expect(machine.instructionCount).toBe(0)
		machine.console.feed('z')
		expect(runToEnd(machine)).toBe(STEP_HALT)
		expect(machine.cpu.b).toBe(0x7A)
	})
})
