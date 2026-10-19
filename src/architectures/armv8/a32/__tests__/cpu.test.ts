/** AArch32 semantics, through programs assembled for the ARMv8 profile and run on the machine. */

import { describe, expect, it } from 'vitest'
import { DATA_BASE, TEXT_BASE } from '../../a64/layout'
import { FAULT_ALIGNMENT, FAULT_BREAKPOINT, FAULT_THUMB, FAULT_UNDEFINED, faultMessage, MODE_USR, STEP_FAULT, STEP_HALT } from '../cpu'
import { A32Machine } from '../machine'
import { assembleA32 } from '../state'

const EXIT = '\tmov r7, #1\n\tsvc #0\n'

/** Assembles `code` with an exit after it and loads it. */
function load(code: string, historyLimit = 0): A32Machine {
	const result = assembleA32({ name: 'test.s', code: `${code}\n${EXIT}` })
	expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([])
	const machine = new A32Machine({ memoryBytes: 1 << 20, historyLimit })
	machine.load(result.image!)
	return machine
}

/** Runs `code` to its exit; returns the machine. */
function run(code: string): A32Machine {
	const machine = load(code)
	expect(machine.run(10_000)).toBe(STEP_HALT)
	return machine
}

/** Runs `code` until it faults; returns the machine. */
function fault(code: string): A32Machine {
	const machine = load(code)
	expect(machine.run(10_000)).toBe(STEP_FAULT)
	return machine
}

const r = (machine: A32Machine, index: number) => machine.cpu.r[index] >>> 0
const word = (machine: A32Machine, address: number) => new DataView(machine.cpu.memory.buffer).getUint32(address - TEXT_BASE, true)

describe('AArch32 flags and the CPSR', () => {
	it('starts in User mode with the flags clear', () => {
		const machine = load('')
		expect(machine.cpu.cpsr).toBe(MODE_USR)
		expect(r(machine, 13)).toBe(TEXT_BASE + (1 << 20))
	})

	it('sets NZCV from ADDS and SUBS', () => {
		// 0x7FFFFFFF + 1 overflows to negative: N and V.
		let machine = run('\tmvn r0, #0x80000000\n\tadds r1, r0, #1\n\tmrs r2, apsr')
		expect(r(machine, 2) >>> 28).toBe(0b1001)
		// 1 - 1 is zero with no borrow: Z and C.
		machine = run('\tmov r0, #1\n\tsubs r1, r0, #1\n\tmrs r2, apsr')
		expect(r(machine, 2) >>> 28).toBe(0b0110)
		expect(r(machine, 2) & 0x1F).toBe(MODE_USR)
	})

	it('writes the flags, Q and GE with MSR but never the mode', () => {
		const machine = run('\tmsr apsr_nzcvqg, #0xF8000000\n\tmov r0, #0xF0000\n\tmsr apsr_g, r0\n\tmov r1, #0x1F\n\tmsr cpsr_fc, r1\n\tmrs r2, cpsr')
		// cpsr_fc with 0x1F clears the flags (f) and leaves the mode (c is not User mode's to write).
		expect(r(machine, 2)).toBe(0x000F0010)
	})

	it('keeps C and V through MULS and sets N and Z', () => {
		const machine = run('\tmsr apsr_nzcvq, #0x30000000\n\tmov r0, #0\n\tmuls r1, r0, r0\n\tmrs r2, apsr')
		expect(r(machine, 2) >>> 28).toBe(0b0111)
	})

	it('has no SPSR in User mode', () => {
		const machine = fault('\tmrs r0, spsr')
		expect(machine.cpu.fault).toBe(FAULT_UNDEFINED)
	})
})

describe('AArch32 interworking', () => {
	it('returns with BX LR and calls with BLX', () => {
		const machine = run('\tadr r4, f\n\tblx r4\n\tb done\nf:\tmov r0, #7\n\tbx lr\ndone:')
		expect(r(machine, 0)).toBe(7)
	})

	it.each([
		['BX to an odd address', '\tmov r0, #0x401\n\tbx r0', 'BX to 0x00000401'],
		['BLX to a label', '\tblx there\nthere:\tnop', 'BLX to 0x00400004'],
		['a load into PC', '\tadr r0, odd\n\tldr pc, [r0]\nodd:\t.word 0x00400001', 'Loading 0x00400001 into PC'],
		['a pop into PC', '\tmov r0, #0x401\n\tpush {r0}\n\tpop {pc}', 'Loading 0x00000401 into PC'],
		['an ALU write of PC', '\tmov r0, #0x401\n\tmov pc, r0', 'Writing 0x00000401 into PC'],
	])('refuses Thumb: %s', (_name, code, detail) => {
		const machine = fault(code)
		const { cpu } = machine
		expect(cpu.fault).toBe(FAULT_THUMB)
		expect(faultMessage(cpu.fault, cpu.faultAddress, cpu.faultDetail)).toBe(`${detail} would enter Thumb state, which is not supported (A32 only)`)
		// Nothing changed: the PC is still on the branch, LR untouched.
		expect(cpu.pc).toBe(TEXT_BASE + 4 * (code.split('\n').findIndex((line) => /bx|blx|ldr pc|pop|mov pc/.test(line))))
		expect(r(machine, 14)).toBe(0)
	})
})

describe('AArch32 loads and stores', () => {
	const data = `\t.data\nvalues:\t.word 0x89ABCDEF, 0x01234567\n\t.text\n\tldr r4, =values\n`

	it('loads halfwords and bytes, signed and unsigned', () => {
		const machine = run(`${data}\tldrh r0, [r4]\n\tldrsh r1, [r4]\n\tldrsb r2, [r4, #1]\n\tldrb r3, [r4, #1]`)
		expect(r(machine, 0)).toBe(0xCDEF)
		expect(r(machine, 1)).toBe(0xFFFFCDEF)
		expect(r(machine, 2)).toBe(0xFFFFFFCD)
		expect(r(machine, 3)).toBe(0xCD)
	})

	it('stores halfwords and doublewords', () => {
		const machine = run(`${data}\tmov r0, #0x55\n\tstrh r0, [r4, #2]\n\tmovw r2, #1\n\tmovw r3, #2\n\tstrd r2, r3, [r4, #8]!`)
		expect(word(machine, DATA_BASE)).toBe(0x0055CDEF)
		expect(word(machine, DATA_BASE + 8)).toBe(1)
		expect(word(machine, DATA_BASE + 12)).toBe(2)
		expect(r(machine, 4)).toBe(DATA_BASE + 8)
	})

	it('loads a word unaligned, unrotated, as ARMv8 does', () => {
		const machine = run(`${data}\tldr r0, [r4, #1]\n\tldrh r1, [r4, #3]`)
		expect(r(machine, 0)).toBe(0x6789ABCD)
		expect(r(machine, 1)).toBe(0x6789)
	})

	it('needs LDRD, LDM and LDREX word aligned', () => {
		for (const access of ['ldrd r0, r1, [r4, #2]', 'ldm r5, {r0, r1}', 'ldrex r0, [r5]']) {
			const machine = fault(`${data}\tadd r5, r4, #2\n\t${access}`)
			expect(machine.cpu.fault, access).toBe(FAULT_ALIGNMENT)
			expect(machine.cpu.faultAddress).toBe(DATA_BASE + 2)
			expect(r(machine, 0)).toBe(0)
		}
	})

	it('loads a doubleword in order', () => {
		const machine = run(`${data}\tldrd r0, r1, [r4]`)
		expect([r(machine, 0), r(machine, 1)]).toEqual([0x89ABCDEF, 0x01234567])
	})

	it('stores PC as its address + 8', () => {
		const machine = run(`${data}\tstr pc, [r4]`)
		expect(word(machine, DATA_BASE)).toBe(TEXT_BASE + 4 + 8)
	})

	it('succeeds STREX only after LDREX of the address', () => {
		const machine = run(`${data}\tmov r1, #9\n\tstrex r2, r1, [r4]\n\tldrex r0, [r4]\n\tstrex r3, r1, [r4]\n\tstrex r5, r1, [r4]`)
		expect([r(machine, 2), r(machine, 3), r(machine, 5)]).toEqual([1, 0, 1])
		expect(r(machine, 0)).toBe(0x89ABCDEF)
		expect(word(machine, DATA_BASE)).toBe(9)
	})
})

describe('AArch32 arithmetic', () => {
	it('divides, by zero to zero', () => {
		const machine = run('\tmov r0, #7\n\tmvn r1, #1\n\tsdiv r2, r0, r1\n\tudiv r3, r1, r0\n\tmov r4, #0\n\tsdiv r5, r0, r4\n\tudiv r6, r0, r4\n\tmov r8, #0x80000000\n\tmvn r9, #0\n\tsdiv r10, r8, r9')
		// 7 / -2 truncates to -3; 0xFFFFFFFE / 7 unsigned.
		expect(r(machine, 2)).toBe(-3 >>> 0)
		expect(r(machine, 3)).toBe(Math.floor(0xFFFFFFFE / 7))
		expect([r(machine, 5), r(machine, 6)]).toEqual([0, 0])
		expect(r(machine, 10)).toBe(0x80000000)
	})

	it('multiplies long, signed and unsigned, and accumulates', () => {
		const machine = run('\tmvn r0, #0\n\tmov r1, #2\n\tumull r2, r3, r0, r1\n\tsmull r4, r5, r0, r1\n\tmov r6, #1\n\tmov r11, #0\n\tumlal r6, r11, r0, r0\n\tmov r8, #10\n\tmov r9, #3\n\tmls r10, r8, r9, r8')
		expect([r(machine, 2), r(machine, 3)]).toEqual([0xFFFFFFFE, 1])
		expect([r(machine, 4), r(machine, 5)]).toEqual([0xFFFFFFFE, 0xFFFFFFFF])
		// 1 + 0xFFFFFFFF^2 = 0xFFFFFFFE_00000002.
		expect([r(machine, 6), r(machine, 11)]).toEqual([2, 0xFFFFFFFE])
		expect(r(machine, 10)).toBe((10 - 30) >>> 0)
	})

	it('counts, reverses, extracts and inserts bits', () => {
		const machine = run([
			'\tmovw r0, #0x5678', '\tmovt r0, #0x1234', '\tclz r1, r0', '\trev r2, r0', '\trev16 r3, r0', '\trbit r4, r0', '\trevsh r5, r0',
			'\tubfx r6, r0, #28, #4', '\tsbfx lr, r0, #4, #8', '\tmvn r8, #0', '\tbfc r8, #8, #16', '\tmov r9, #0', '\tbfi r9, r0, #16, #16',
			'\tsxtb r10, r0', '\tmov r11, #0xFF', '\tuxtab r12, r11, r0, ror #8',
		].join('\n'))
		expect(r(machine, 1)).toBe(3)
		expect(r(machine, 2)).toBe(0x78563412)
		expect(r(machine, 3)).toBe(0x34127856)
		expect(r(machine, 4)).toBe(0x1E6A2C48)
		expect(r(machine, 5)).toBe(0x00007856)
		expect(r(machine, 6)).toBe(0x1)
		expect(r(machine, 14)).toBe(0x67)
		expect(r(machine, 8)).toBe(0xFF0000FF)
		expect(r(machine, 9)).toBe(0x56780000)
		expect(r(machine, 10)).toBe(0x78)
		expect(r(machine, 12)).toBe(0xFF + 0x56)
	})

	it('moves halves with MOVW and MOVT', () => {
		const machine = run('\tmvn r0, #0\n\tmovt r0, #0x1234\n\tmovw r1, #0xABCD')
		expect(r(machine, 0)).toBe(0x1234FFFF)
		expect(r(machine, 1)).toBe(0xABCD)
	})
})

describe('AArch32 traps', () => {
	it('stops at BKPT and UDF, changing nothing', () => {
		let machine = fault('\tmov r0, #1\n\tbkpt #3')
		expect(machine.cpu.fault).toBe(FAULT_BREAKPOINT)
		expect(machine.cpu.pc).toBe(TEXT_BASE + 4)
		machine = fault('\tudf #1')
		expect(machine.cpu.fault).toBe(FAULT_UNDEFINED)
	})

	it('treats PLD and the barriers as nothing to do', () => {
		const machine = run('\tpld [sp]\n\tdmb ish\n\tdsb\n\tisb\n\tyield\n\tmov r0, #5')
		expect(r(machine, 0)).toBe(5)
	})

	it('answers brk and refuses an unknown fd and call', () => {
		let machine = run('\tmov r0, #0\n\tmov r7, #45\n\tsvc #0\n\tmov r4, r0\n\tadd r0, r0, #64\n\tsvc #0\n\tmov r5, r0\n\tmov r0, #5\n\tmov r7, #4\n\tsvc #0')
		expect(r(machine, 4)).toBe(DATA_BASE)
		expect(r(machine, 5)).toBe(DATA_BASE + 64)
		// write to fd 5: -EBADF, left in r0 as the exit status.
		expect(machine.linux.exitCode).toBe(-9 & 0xFF)
		machine = fault('\tmov r7, #99\n\tsvc #0')
		expect(faultMessage(machine.cpu.fault, machine.cpu.faultAddress, machine.cpu.faultDetail)).toBe('Unsupported system call 99 (r7) at 0x00400004')
	})
})

describe('AArch32 history', () => {
	/** Everything a step can change, as one comparable record. */
	const snapshot = (machine: A32Machine) => ({
		r: Array.from(machine.cpu.r),
		pc: machine.cpu.pc,
		cpsr: machine.cpu.cpsr,
		exclusive: machine.cpu.exclusive,
		memory: Array.from(machine.cpu.memory.subarray(DATA_BASE - TEXT_BASE, DATA_BASE - TEXT_BASE + 32)),
		stack: Array.from(machine.cpu.memory.subarray(machine.cpu.memory.length - 32)),
		output: machine.linux.output,
		depth: machine.callStack.depth,
		count: machine.instructionCount,
		programBreak: machine.linux.programBreak,
		exitCode: machine.linux.exitCode,
		halted: machine.halted,
	})

	it('steps back to exactly each state it passed through', () => {
		const code = [
			'\t.data', 'values:\t.word 1, 2', '\t.text',
			'\tldr r4, =values', '\tmov r0, #0x80000000', '\tadds r0, r0, r0', '\tstrh r0, [r4, #2]', '\tstrd r4, r5, [r4]',
			'\tldrex r1, [r4]', '\tstrex r2, r0, [r4]', '\tmsr apsr_nzcvqg, #0x08000000', '\tumull r6, r7, r4, r4',
			'\tbl f', '\tmov r7, #45', '\tmov r0, #0', '\tsvc #0', '\tadd r0, r0, #16', '\tsvc #0',
			'\tmov r0, #1', '\tadr r1, text', '\tmov r2, #2', '\tmov r7, #4', '\tsvc #0', '\tmov r0, #0', '\tb end',
			'f:\tpush {r4, lr}', '\tbfi r4, r4, #8, #8', '\tpop {r4, pc}',
			'text:\t.ascii "ok"', '\t.align 2', 'end:',
		].join('\n')
		const machine = load(code, 1000)
		const states = [snapshot(machine)]
		while (machine.step() === 0) states.push(snapshot(machine))
		expect(machine.halted).toBe(true)
		expect(machine.linux.output).toBe('ok')
		states.push(snapshot(machine))
		// Each step back lands on the state before the step it undoes.
		for (let index = states.length - 2; index >= 0; index--) {
			expect(machine.history!.stepBack()).toBe(true)
			expect(snapshot(machine), `after undoing step ${index}`).toEqual(states[index])
		}
		expect(machine.history!.stepBack()).toBe(false)
	})

	it('records nothing for a faulting step', () => {
		const machine = load('\tmov r0, #1\n\tbx r0', 100)
		expect(machine.run(10)).toBe(STEP_FAULT)
		expect(machine.history!.length).toBe(1)
	})
})
