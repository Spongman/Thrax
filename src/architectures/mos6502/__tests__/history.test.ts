import { describe, expect, it } from 'vitest'
import { assembleMos6502 } from '../assembler'
import { ENTRY_INTERRUPT } from '../history'
import { Mos6502Machine } from '../machine'

function machineFor(code: string) {
	const { image, diagnostics } = assembleMos6502({ name: 'test.s', code })
	expect(diagnostics).toEqual([])
	const machine = new Mos6502Machine({ historyLimit: 1000 })
	machine.load(image!)
	return machine
}

/** Everything the history must put back. */
function snapshot(machine: Mos6502Machine) {
	const { cpu, device, callStack } = machine
	return {
		registers: [cpu.a, cpu.x, cpu.y, cpu.sp, cpu.p, cpu.pc, cpu.cycles],
		memory: Array.from(cpu.memory.subarray(0, 0x0700)),
		device: [device.output, device.inputIndex, device.control, device.period, device.timer, device.timerFlag],
		machine: [machine.halted, machine.exitCode, machine.nmiPending, machine.instructionCount],
		frames: callStack.frames(),
	}
}

describe('6502 history', () => {
	it('rewinds every step to the state before it', () => {
		const machine = machineFor([
			'lda #50', 'sta $F005', 'lda #2', 'sta $F004', 'cli',
			'ldx #0', 'loop: lda text,x', 'beq done', 'sta $F000', 'jsr bump', 'inx', 'bne loop',
			'done: lda $F001', 'lda #7', 'sta $F003',
			'bump: inc $30', 'rts',
			'irq: sta $F002', 'rti',
			'text: .asciiz "hey"',
			'.org $FFFE', '.word irq',
		].join('\n'))
		machine.device.feed('z')
		const states = [snapshot(machine)]
		while (!machine.halted && states.length < 2000) {
			machine.step()
			states.push(snapshot(machine))
		}
		expect(machine.exitCode).toBe(7)
		expect(machine.device.output).toBe('hey')
		const log = machine.history!
		expect(log.length).toBe(states.length - 1)
		const kinds = Array.from({ length: log.length }, (_, index) => log.kindAt(index))
		expect(kinds.filter((kind) => kind === ENTRY_INTERRUPT).length).toBeGreaterThan(1)
		for (let index = states.length - 2; index >= 0; index--) {
			expect(log.stepBack()).toBe(true)
			expect(snapshot(machine)).toEqual(states[index])
		}
		expect(log.stepBack()).toBe(false)
	})

	it('records edits, and a step that waits records nothing', () => {
		const machine = machineFor('lda $F001\nbrk')
		machine.step()
		expect(machine.history!.length).toBe(0)
		expect(machine.device.waiting).toBe(true)
		machine.editRegister((cpu) => { cpu.x = 9 })
		machine.editBytes(0x40, [1, 2])
		expect(machine.history!.length).toBe(2)
		machine.history!.rewindTo(0)
		expect(machine.cpu.x).toBe(0)
		expect([machine.cpu.memory[0x40], machine.cpu.memory[0x41]]).toEqual([0, 0])
	})
})
