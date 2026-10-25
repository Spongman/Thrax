import { describe, expect, it } from 'vitest'
import definition from '../index'

describe('TMS9900 shared runtime workspace coherence', () => {
	it('fetches an immediate word across the 16-bit boundary and replays it exactly', () => {
		const services = definition.createServices(), settings = definition.settings.defaults
		try {
			const program = services.assemble({ files: [{ name: 'main.asm', code: 'IDLE' }], entries: ['main.asm'] }, settings)
			const machine = services.createMachine(program, settings, { speed: null, historyLimit: 100 })
			for (const [address, value] of [[0xfffe, 0x02], [0xffff, 0x01], [0, 0x12], [1, 0x34]]) expect(machine.writeByte(address, value)).toBe(true)
			machine.setProgramCounter(0xfffe)
			machine.step()
			expect(machine.pc).toBe(2)
			expect(machine.registerValues().r1).toBe(0x1234)
			expect(machine.stepBack()).toBe(true)
			expect(machine.pc).toBe(0xfffe)
			expect(machine.registerValues().r1).toBe(0)
			machine.step()
			expect(machine.pc).toBe(2)
			expect(machine.registerValues().r1).toBe(0x1234)
			machine.stepBack()
			expect(machine.writeByte(0, 0x56)).toBe(true)
			machine.step()
			expect(machine.registerValues().r1).toBe(0x5634)
		} finally { services.dispose() }
	})

	it('fetches both extension words of a six-byte instruction across the boundary', () => {
		const services = definition.createServices(), settings = definition.settings.defaults
		try {
			const program = services.assemble({ files: [{ name: 'main.asm', code: 'IDLE' }], entries: ['main.asm'] }, settings)
			const machine = services.createMachine(program, settings, { speed: null, historyLimit: 100 })
			// MOV @>2000, @>3000; the destination address word wraps to zero.
			for (const [address, value] of [[0xfffc, 0xc8], [0xfffd, 0x20], [0xfffe, 0x20], [0xffff, 0], [0, 0x30], [1, 0], [0x2000, 0xab], [0x2001, 0xcd]]) expect(machine.writeByte(address, value)).toBe(true)
			machine.setProgramCounter(0xfffc)
			machine.step()
			expect(machine.pc).toBe(2)
			expect(machine.inspectMemory().word(0x3000)).toBe(0xabcd)
			machine.stepBack()
			expect(machine.inspectMemory().word(0x3000)).toBe(0)
			machine.step()
			expect(machine.inspectMemory().word(0x3000)).toBe(0xabcd)
		} finally { services.dispose() }
	})

	it('steps over a boundary-straddling BL using its wrapped return address', async () => {
		const services = definition.createServices(), settings = definition.settings.defaults
		try {
			const program = services.assemble({ files: [{ name: 'main.asm', code: 'IDLE' }], entries: ['main.asm'] }, settings)
			const machine = services.createMachine(program, settings, { speed: null, historyLimit: 100 })
			for (const [address, value] of [[0xfffe, 0x06], [0xffff, 0xa0], [0, 0x20], [1, 0], [0x2000, 0x04], [0x2001, 0x5b]]) expect(machine.writeByte(address, value)).toBe(true)
			machine.setProgramCounter(0xfffe)
			await machine.stepOver()
			expect(machine.pc).toBe(2)
			expect(machine.registerValues().r11).toBe(2)
			expect(machine.callStack).toEqual([])
			expect(machine.instructionCount).toBe(2)
		} finally { services.dispose() }
	})

	it('shares debugger register and RAM edits, including undo/redo and workspace switches', () => {
		const services = definition.createServices(), settings = definition.settings.defaults
		try {
			const program = services.assemble({ files: [{ name: 'main.asm', code: 'LI R1, >1234\nLWPI >8300\nLI R1, >5678\nIDLE' }], entries: ['main.asm'] }, settings)
			expect(program.diagnostics).toEqual([])
			const machine = services.createMachine(program, settings, { speed: null, historyLimit: 100 })
			machine.step()
			expect(machine.registerValues().r1).toBe(0x1234)
			expect(machine.inspectMemory().byte(0x8002)).toBe(0x12)
			expect(machine.writeRegister('r1', 0xabcd)).toBe(true)
			expect(machine.inspectMemory().byte(0x8002)).toBe(0xab)
			expect(machine.stepBack()).toBe(true)
			expect(machine.registerValues().r1).toBe(0x1234)
			machine.step()
			expect(machine.registerValues().r1).toBe(0xabcd)
			expect(machine.writeByte(0x8003, 0xef)).toBe(true)
			expect(machine.registerValues().r1).toBe(0xabef)
			const edit = machine.history.at(machine.historyCursor - 1)!
			expect(machine.historyFormat.effects(edit, true).some(effect => effect.register === 'r1')).toBe(true)
			expect(machine.historyFormat.effects(edit, true).some(effect => effect.address === 0x8003)).toBe(true)
			expect(machine.stepBack()).toBe(true)
			expect(machine.registerValues().r1).toBe(0xabcd)
			machine.step()
			machine.step()
			expect(machine.registerValues().wp).toBe(0x8300)
			expect(machine.registerValues().r1).toBe(0)
			const switchWorkspace = machine.history.at(machine.historyCursor - 1)!
			expect(machine.historyFormat.effects(switchWorkspace, true).some(effect => effect.register === 'wp')).toBe(true)
			expect(machine.historyFormat.effects(switchWorkspace, true).some(effect => effect.register === 'r1')).toBe(true)
			machine.step()
			expect(machine.registerValues().r1).toBe(0x5678)
			expect(machine.stepBack()).toBe(true)
			expect(machine.registerValues().r1).toBe(0)
			expect(machine.stepBack()).toBe(true)
			expect(machine.registerValues().wp).toBe(0x8000)
			expect(machine.registerValues().r1).toBe(0xabef)
		} finally { services.dispose() }
	})
})
