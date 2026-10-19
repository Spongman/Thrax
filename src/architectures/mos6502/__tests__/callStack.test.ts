import { describe, expect, it } from 'vitest'
import { assembleMos6502 } from '../assembler'
import { Mos6502Machine } from '../machine'

function machineFor(code: string) {
	const { image, diagnostics } = assembleMos6502({ name: 'test.s', code: `.org $0600\n${code}` })
	expect(diagnostics).toEqual([])
	const machine = new Mos6502Machine()
	machine.load(image!)
	return machine
}

describe('6502 call stack', () => {
	it('pushes a frame per JSR and pops it on RTS', () => {
		const machine = machineFor('jsr outer\nbrk\nouter: jsr inner\nrts\ninner: nop\nrts')
		machine.step()
		machine.step()
		expect(machine.callStack.frames().map(({ callSite, returnAddress, callee }) => [callSite, returnAddress, callee])).toEqual([
			[0x0600, 0x0603, 0x0604],
			[0x0604, 0x0607, 0x0608],
		])
		machine.step()
		machine.step()
		expect(machine.callStack.depth).toBe(1)
		machine.step()
		expect(machine.callStack.depth).toBe(0)
	})

	it('drops a frame whose return address is pulled off by hand', () => {
		const machine = machineFor('jsr sub\nbrk\nsub: pla\npla\njmp $0603')
		machine.run(2)
		expect(machine.callStack.depth).toBe(1)
		machine.step()
		expect(machine.callStack.depth).toBe(0)
	})

	it('keeps frames across an interrupt handler\'s RTI', () => {
		const machine = machineFor('jsr sub\nbrk\nsub: cli\nnop\nnop\nrts\nirq: rti\n.org $FFFE\n.word irq')
		machine.step()
		machine.step()
		machine.nmi()
		machine.cpu.memory[0xFFFA] = machine.cpu.memory[0xFFFE]
		machine.cpu.memory[0xFFFB] = machine.cpu.memory[0xFFFF]
		machine.step()
		machine.step()
		expect(machine.callStack.depth).toBe(1)
	})
})
