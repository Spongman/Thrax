import { describe, expect, it } from 'vitest'
import { build, output, run, withExit } from './helpers'

describe('arithmetic and logic', () => {
	it('adds and prints', async () => {
		expect(await output(withExit('li $t0, 5\nli $t1, 3\nadd $a0, $t0, $t1\nli $v0, 1\nsyscall'))).toBe('8')
	})

	it('wraps signed arithmetic to 32 bits', async () => {
		const simulator = await run(withExit('li $t0, 0x7fffffff\naddiu $t0, $t0, 1'))
		expect(simulator.registers.$t0 | 0).toBe(-0x80000000)
	})

	it('shifts logically and arithmetically', async () => {
		const simulator = await run(withExit('li $t0, -16\nsrl $t1, $t0, 4\nsra $t2, $t0, 4'))
		expect(simulator.registers.$t1 >>> 0).toBe(0x0fffffff)
		expect(simulator.registers.$t2 | 0).toBe(-1)
	})

	it('compares signed and unsigned differently', async () => {
		const simulator = await run(withExit('li $t0, -1\nli $t1, 1\nslt $t2, $t0, $t1\nsltu $t3, $t0, $t1'))
		expect(simulator.registers.$t2).toBe(1)
		expect(simulator.registers.$t3).toBe(0)
	})

	it('multiplies into hi and lo', async () => {
		const simulator = await run(withExit('li $t0, 0x10000\nli $t1, 0x10000\nmult $t0, $t1\nmfhi $t2\nmflo $t3'))
		expect(simulator.registers.$t2).toBe(1)
		expect(simulator.registers.$t3).toBe(0)
	})

	it('divides into lo with the remainder in hi', async () => {
		const simulator = await run(withExit('li $t0, 17\nli $t1, 5\ndiv $t0, $t1\nmflo $t2\nmfhi $t3'))
		expect(simulator.registers.$t2).toBe(3)
		expect(simulator.registers.$t3).toBe(2)
	})

	it('never writes $zero', async () => {
		const simulator = await run(withExit('li $zero, 42\naddi $zero, $zero, 7'))
		expect(simulator.registers.$zero).toBe(0)
	})
})

describe('memory', () => {
	it('round-trips a word', async () => {
		const simulator = await run(withExit('li $t0, 0x12345678\nsw $t0, 0($sp)\nlw $t1, 0($sp)'))
		expect(simulator.registers.$t1 >>> 0).toBe(0x12345678)
	})

	it('sign-extends byte and half loads', async () => {
		const simulator = await run(withExit('li $t0, 0xff\nsb $t0, 0($sp)\nlb $t1, 0($sp)\nlbu $t2, 0($sp)'))
		expect(simulator.registers.$t1 | 0).toBe(-1)
		expect(simulator.registers.$t2).toBe(0xff)
	})

	it('stores little-endian bytes', async () => {
		const simulator = await run(withExit('li $t0, 0x12345678\nsw $t0, 0($sp)\nlbu $t1, 0($sp)\nlbu $t2, 3($sp)'))
		expect(simulator.registers.$t1).toBe(0x78)
		expect(simulator.registers.$t2).toBe(0x12)
	})

	it('loads initialized data through la', async () => {
		const source = withExit('.data\nvalue: .word 1234\n.text\nla $t0, value\nlw $a0, 0($t0)\nli $v0, 1\nsyscall')
		expect(await output(source)).toBe('1234')
	})

	it('honours .byte, .half, and .space layout', async () => {
		const source = withExit(`
.data
first: .byte 1, 2
gap: .space 2
third: .half 0x0304
.text
la $t0, first
lbu $a0, 0($t0)
li $v0, 1
syscall
lbu $a0, 1($t0)
syscall
lhu $a0, 4($t0)
syscall
`)
		expect(await output(source)).toBe('12772')
	})
})

describe('control flow', () => {
	it('runs a counted loop', async () => {
		const source = withExit(`
li $t0, 1
loop:
li $t1, 6
beq $t0, $t1, done
move $a0, $t0
li $v0, 1
syscall
addi $t0, $t0, 1
j loop
done:
`)
		expect(await output(source)).toBe('12345')
	})

	it('branches on the sign of a register', async () => {
		const source = withExit('li $t0, -1\nbltz $t0, taken\nli $a0, 0\nj print\ntaken:\nli $a0, 1\nprint:\nli $v0, 1\nsyscall')
		expect(await output(source)).toBe('1')
	})

	it('distinguishes bgez from bltz', async () => {
		const source = withExit('li $t0, 5\nbgez $t0, taken\nli $a0, 0\nj print\ntaken:\nli $a0, 1\nprint:\nli $v0, 1\nsyscall')
		expect(await output(source)).toBe('1')
	})

	it('calls and returns through jal/jr', async () => {
		const source = withExit(`
li $a0, 7
jal double
li $v0, 1
syscall
j end
double:
add $a0, $a0, $a0
jr $ra
end:
`)
		expect(await output(source)).toBe('14')
	})

	it('links $ra on a one-operand jalr', async () => {
		const source = withExit(`
la $t0, target
jalr $t0
li $v0, 1
syscall
j end
target:
li $a0, 99
jr $ra
end:
`)
		expect(await output(source)).toBe('99')
	})

	it('tracks the call stack while inside a subroutine', () => {
		// The subroutine is called `sub`, which is also a mnemonic: an
		// instruction name may label a location, so this has to assemble.
		const simulator = build(withExit('jal sub\nj end\nsub:\njr $ra\nend:'))
		simulator.step()
		expect(simulator.getCallStack()).toHaveLength(1)
		simulator.step()
		expect(simulator.getCallStack()).toHaveLength(0)
	})
})

describe('syscalls', () => {
	it('prints a null-terminated string', async () => {
		const source = withExit('.data\nmsg: .asciiz "hi"\n.text\nla $a0, msg\nli $v0, 4\nsyscall')
		expect(await output(source)).toBe('hi')
	})

	it('prints characters and formatted integers', async () => {
		const source = withExit(`
li $a0, 65
li $v0, 11
syscall
li $a0, 255
li $v0, 34
syscall
li $v0, 36
syscall
`)
		expect(await output(source)).toBe('A0x000000ff255')
	})

	it('allocates distinct heap blocks', async () => {
		const simulator = await run(withExit('li $v0, 9\nli $a0, 8\nsyscall\nmove $t0, $v0\nli $v0, 9\nli $a0, 8\nsyscall\nmove $t1, $v0'))
		expect(simulator.registers.$t1 - simulator.registers.$t0).toBe(8)
	})

	it('pauses for input and resumes', async () => {
		const simulator = build(withExit('li $v0, 5\nsyscall\nmove $a0, $v0\nli $v0, 1\nsyscall'))
		await simulator.run()
		expect(simulator.pendingInput).toEqual({ type: 'integer' })
		simulator.provideInput('42')
		await simulator.run()
		expect(simulator.console).toBe('42')
	})
})

describe('floating point', () => {
	it('adds single-precision values', async () => {
		const simulator = await run(withExit('li.s $f0, 1.5\nli.s $f1, 2.25\nadd.s $f2, $f0, $f1'))
		expect(simulator.readFpSingle(2)).toBeCloseTo(3.75)
	})

	it('branches on a floating-point comparison', async () => {
		const source = withExit(`
li.s $f0, 1.0
li.s $f1, 2.0
c.lt.s $f0, $f1
bc1t taken
li $a0, 0
j print
taken:
li $a0, 1
print:
li $v0, 1
syscall
`)
		expect(await output(source)).toBe('1')
	})

	it('converts single to word', async () => {
		const simulator = await run(withExit('li.s $f0, 3.7\ncvt.w.s $f1, $f0\nmfc1 $t0, $f1'))
		expect(simulator.registers.$t0).toBe(4)
	})
})

describe('debugging', () => {
	it('stops at a breakpoint', async () => {
		const simulator = build(withExit('li $t0, 1\nli $t1, 2\nli $t2, 3'))
		simulator.addBreakpoint(0x00400008)
		await simulator.run()
		expect(simulator.pc).toBe(0x00400008)
		expect(simulator.registers.$t2).toBe(0)
	})

	it('continues past the breakpoint it stopped on', async () => {
		const simulator = build(withExit('li $t0, 1\nli $t1, 2\nli $t2, 3'))
		simulator.addBreakpoint(0x00400004)
		await simulator.run()
		expect(simulator.pc).toBe(0x00400004)

		// Continuing steps off the breakpoint under the pc instead of re-stopping
		// on it, or the debugger's continue button would do nothing.
		await simulator.continue()
		expect(simulator.halted).toBe(true)
		expect(simulator.registers.$t2).toBe(3)
	})

	it('restores state on step back', () => {
		const simulator = build(withExit('li $t0, 1\nli $t0, 2'))
		simulator.step()
		simulator.step()
		expect(simulator.registers.$t0).toBe(2)
		simulator.stepBack()
		expect(simulator.registers.$t0).toBe(1)
		expect(simulator.pc).toBe(0x00400004)
	})

	it('halts after running off the end of the program', async () => {
		const simulator = await run('li $t0, 1')
		expect(simulator.halted).toBe(true)
		expect(simulator.instructionCount).toBeLessThan(100)
	})
})

describe('machine state seen by the debugger', () => {
	it('reports hi and lo after a multiply', async () => {
		const simulator = await run(withExit('li $t0, 0x10000\nli $t1, 0x10000\nmult $t0, $t1'))
		const { registers } = simulator.getState()
		expect(registers.$hi).toBe(1)
		expect(registers.$lo).toBe(0)
	})

	it('reports hi and lo after a divide', async () => {
		const simulator = await run(withExit('li $t0, 17\nli $t1, 5\ndiv $t0, $t1'))
		const { registers } = simulator.getState()
		expect(registers.$lo).toBe(3)
		expect(registers.$hi).toBe(2)
	})

	it('reports hi and lo written by mthi and mtlo', async () => {
		const simulator = await run(withExit('li $t0, 7\nli $t1, 9\nmthi $t0\nmtlo $t1'))
		const { registers } = simulator.getState()
		expect(registers.$hi).toBe(7)
		expect(registers.$lo).toBe(9)
	})

	it('restores hi and lo together on step back', () => {
		const simulator = build(withExit('li $t0, -1\nli $t1, 2\nmult $t0, $t1\nli $t2, 5\nmthi $t2'))
		for (let index = 0; index < 5; index += 1) simulator.step()
		expect(simulator.getState().registers.$hi).toBe(5)
		simulator.stepBack()
		const { registers, hi, lo } = simulator.getState()
		expect(hi).toBe(-1)
		expect(lo).toBe(-2)
		expect(registers.$hi).toBe(hi)
		expect(registers.$lo).toBe(lo)
	})

	it('shows a moved program counter in the register file', () => {
		const simulator = build(withExit('li $t0, 1\nli $t1, 2'))
		simulator.step()
		simulator.setProgramCounter(0x00400000)
		expect(simulator.pc).toBe(0x00400000)
		expect(simulator.getState().registers.$pc).toBe(0x00400000)
		expect(simulator.halted).toBe(false)
	})

	it('pauses a run without halting it', () => {
		const simulator = build(withExit('nop'))
		simulator.running = true
		simulator.pause()
		expect(simulator.paused).toBe(true)
		expect(simulator.running).toBe(false)
		expect(simulator.halted).toBe(false)
	})

	it('takes its pacing settings from configure', () => {
		const simulator = build(withExit('nop'))
		simulator.configure({ speed: 10 })
		expect(simulator.speed).toBe(10)
		expect(simulator.pacedAddresses).toBeNull()
		const addresses = new Set([0x00400000])
		simulator.configure({ pacedAddresses: addresses })
		expect(simulator.speed).toBe(10)
		expect(simulator.pacedAddresses).toBe(addresses)
	})
})

describe('temporary breakpoints', () => {
	it('runs to an address without keeping a breakpoint there', async () => {
		const simulator = build(withExit('li $t0, 1\nli $t1, 2\nli $t2, 3'))
		await simulator.runTo(0x00400008)
		expect(simulator.pc).toBe(0x00400008)
		expect(simulator.registers.$t1).toBe(2)
		expect(simulator.registers.$t2).toBe(0)
		expect(simulator.getBreakpoints()).toEqual([])
	})

	it('keeps a breakpoint that was already on the address it runs to', async () => {
		const simulator = build(withExit('li $t0, 1\nli $t1, 2\nli $t2, 3'))
		simulator.addBreakpoint(0x00400008)
		await simulator.runTo(0x00400008)
		expect(simulator.getBreakpoints()).toEqual([0x00400008])
	})

	it('leaves the breakpoint set alone when stepping over a call', async () => {
		const source = withExit(`jal fn
li $t1, 2
li $v0, 10
syscall
fn:
li $t0, 1
jr $ra`)
		const simulator = build(source)
		// A breakpoint on the instruction stepOver returns to must survive the step.
		simulator.addBreakpoint(0x00400004)
		await simulator.stepOver()
		expect(simulator.pc).toBe(0x00400004)
		expect(simulator.registers.$t0).toBe(1)
		expect(simulator.getBreakpoints()).toEqual([0x00400004])
	})

	it('restores a breakpoint on the call it steps over', async () => {
		const source = withExit(`jal fn
li $t1, 2
li $v0, 10
syscall
fn:
li $t0, 1
jr $ra`)
		const simulator = build(source)
		simulator.addBreakpoint(0x00400000)
		await simulator.stepOver()
		expect(simulator.getBreakpoints()).toEqual([0x00400000])
	})
})

describe('label addressing', () => {
	it('reads the word a label names, past the first 64KB of the data segment', async () => {
		const source = withExit('.data\n.space 0x1000\nvalue: .word 1234\n.text\nlw $a0, value\nli $v0, 1\nsyscall')
		expect(await output(source)).toBe('1234')
	})

	it('loads a float a label names', async () => {
		const simulator = await run(withExit('.data\n.space 0x1000\nvalue: .float 2.5\n.text\nl.s $f0, value'))
		expect(simulator.readFpSingle(0)).toBe(2.5)
	})

	it('stores through a label', async () => {
		const source = withExit('.data\nslot: .word 0\n.text\nli $t0, 99\nsw $t0, slot\nlw $a0, slot\nli $v0, 1\nsyscall')
		expect(await output(source)).toBe('99')
	})
})

describe('run pacing', () => {
	it('runs flat out by default', () => {
		const simulator = build(withExit('nop'))
		expect(simulator.speed).toBeNull()
		expect(simulator.batchDelayMs(simulator.batchSize())).toBe(0)
	})

	it('steps one instruction at a time at slow speeds', () => {
		const simulator = build(withExit('nop'))
		simulator.speed = 10
		expect(simulator.batchSize()).toBe(1)
		// One instruction every tenth of a second.
		expect(simulator.batchDelayMs(1)).toBeCloseTo(100)
	})

	it('batches faster speeds to keep a steady redraw rate', () => {
		const simulator = build(withExit('nop'))
		simulator.speed = 3000
		expect(simulator.batchSize()).toBe(100)
		expect(simulator.batchDelayMs(100)).toBeCloseTo(33.3, 1)
	})

	it('reports progress between batches so a paced run can be watched', async () => {
		const simulator = build(withExit('li $t0, 1\nli $t1, 2\nli $t2, 3'))
		simulator.speed = 2000
		let updates = 0
		simulator.onProgress = () => { updates += 1 }
		await simulator.run()
		expect(updates).toBeGreaterThan(0)
		expect(simulator.halted).toBe(true)
	})
})
