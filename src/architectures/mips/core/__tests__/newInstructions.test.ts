import { opFor } from '../ops'
import { describe, expect, it } from 'vitest'
import { decode } from '../decoder'
import { disassemble } from '../disassembler'
import { build, buildDelayed, words } from './helpers'
import type { MipsSimulator } from '../simulator'

/**
 * Steps to completion under an instruction budget, so an instruction that fails
 * to make progress shows up as a failed assertion rather than a hung test run.
 */
function runBounded(simulator: MipsSimulator, budget = 200) {
	let steps = 0
	while (!simulator.halted && steps < budget) {
		simulator.step()
		steps++
	}
	expect(simulator.halted).toBe(true)
}

/** Assembles and runs a body that ends with a clean exit. */
function runProgram(body: string): MipsSimulator {
	const simulator = build(`${body}\nli $v0, 10\nsyscall\n`)
	runBounded(simulator)
	return simulator
}

/**
 * Opcode 1 selects on `rt`, not on nothing: the ten forms MARS defines
 * (`InstructionSet.java:896`, `:912`, `:961`, `:977`, `:2849`, `:2883`,
 * `:2937`, `:2954`, `:3012`, `:3029`) and nothing else.
 */
describe('opcode 1 decoding', () => {
	it.each([
		['bltz $t0, here', 'BLTZ'],
		['bgez $t0, here', 'BGEZ'],
		['bltzal $t0, here', 'BLTZAL'],
		['bgezal $t0, here', 'BGEZAL'],
		['tgei $t0, 5', 'TGEI'],
		['tgeiu $t0, 5', 'TGEIU'],
		['tlti $t0, 5', 'TLTI'],
		['tltiu $t0, 5', 'TLTIU'],
		['teqi $t0, 5', 'TEQI'],
		['tnei $t0, 5', 'TNEI'],
	])('decodes %s as itself', (source, op) => {
		expect(decode(words(`here: ${source}`)[0])?.op).toBe(opFor(op))
	})

	it('rejects a reserved rt rather than reading it as a branch', () => {
		// rt 3 names no form, so the word decodes to nothing at all.
		const reserved = (1 << 26) | (8 << 21) | (3 << 16)
		expect(decode(reserved)).toBeNull()
	})
})

describe('branch and link', () => {
	it('links and branches when the condition holds', () => {
		const simulator = runProgram(`
	.text
main:
	li $t0, 1
	bgezal $t0, target
	li $t1, 1
	li $v0, 10
	syscall
target:
	li $t2, 2
`)
		expect(simulator.registers.$t2).toBe(2)
		expect(simulator.registers.$t1).toBe(0)
		// The link is the instruction after the branch (`InstructionSet.java:3309-3313`).
		expect(simulator.registers.$ra).toBe(0x00400008)
	})

	it('neither links nor branches when the condition fails', () => {
		const simulator = runProgram(`
	.text
main:
	li $t0, 1
	bltzal $t0, target
	li $t1, 1
	li $v0, 10
	syscall
target:
	li $t2, 2
`)
		expect(simulator.registers.$t1).toBe(1)
		expect(simulator.registers.$t2).toBe(0)
		// MARS links only on the taken path (`InstructionSet.java:974`).
		expect(simulator.registers.$ra).toBe(0)
	})

	it('links past the delay slot when delayed branching is on', () => {
		// The link skips the delay slot, as `jal` does (`InstructionSet.java:3309-3313`).
		const simulator = buildDelayed(`
	.text
main:
	li $t0, -1
	bltzal $t0, target
	nop
	li $v0, 10
	syscall
target:
	li $t2, 2
	li $v0, 10
	syscall
`)
		runBounded(simulator)
		expect(simulator.registers.$ra).toBe(0x0040000c)
		expect(simulator.registers.$t2).toBe(2)
	})
})

describe('count leading bits and multiply-accumulate', () => {
	it('counts leading ones and zeroes', () => {
		const simulator = runProgram(`
	.text
main:
	li $t0, 0xf0000000
	clo $t1, $t0
	clz $t2, $t0
	li $t3, 0
	clo $t4, $t3
	clz $t5, $t3
`)
		expect(simulator.registers.$t1).toBe(4)
		expect(simulator.registers.$t2).toBe(0)
		expect(simulator.registers.$t4).toBe(0)
		expect(simulator.registers.$t5).toBe(32)
	})

	it('accumulates into HI and LO', () => {
		const simulator = runProgram(`
	.text
main:
	li $t0, 100
	mthi $zero
	mtlo $t0
	li $t1, 3
	li $t2, 4
	madd $t1, $t2
	mflo $t3
	msub $t1, $t2
	mflo $t4
`)
		expect(simulator.registers.$t3).toBe(112)
		expect(simulator.registers.$t4).toBe(100)
	})

	it('reads the operands unsigned for maddu and msubu', () => {
		const simulator = runProgram(`
	.text
main:
	mthi $zero
	mtlo $zero
	li $t0, -1
	li $t1, 2
	maddu $t0, $t1
	mfhi $t2
	mflo $t3
`)
		// 0xffffffff * 2 = 0x1fffffffe, so HI is 1 and LO is -2.
		expect(simulator.registers.$t2).toBe(1)
		expect(simulator.registers.$t3).toBe(-2)
	})

	it('keeps madd signed', () => {
		const simulator = runProgram(`
	.text
main:
	mthi $zero
	mtlo $zero
	li $t0, -1
	li $t1, 2
	madd $t0, $t1
	mfhi $t2
	mflo $t3
`)
		expect(simulator.registers.$t2).toBe(-1)
		expect(simulator.registers.$t3).toBe(-2)
	})
})

describe('conditional moves', () => {
	it('moves on a register being non-zero or zero', () => {
		const simulator = runProgram(`
	.text
main:
	li $t0, 5
	li $t1, 0
	li $t2, 1
	movn $t3, $t0, $t2
	movz $t4, $t0, $t2
	movn $t5, $t0, $t1
	movz $t6, $t0, $t1
`)
		expect(simulator.registers.$t3).toBe(5)
		expect(simulator.registers.$t4).toBe(0)
		expect(simulator.registers.$t5).toBe(0)
		expect(simulator.registers.$t6).toBe(5)
	})

	it('moves an FP register on a condition flag', () => {
		const simulator = runProgram(`
	.data
one:	.float 1.0
two:	.float 2.0
	.text
main:
	la $t0, one
	lwc1 $f0, 0($t0)
	lwc1 $f2, 4($t0)
	c.lt.s $f0, $f2
	movt.s $f4, $f0
	movf.s $f6, $f2
`)
		expect(simulator.fpRegisters[4]).toBe(simulator.fpRegisters[0])
		expect(simulator.fpRegisters[6]).toBe(0)
	})

	it('moves an FP register on a general register', () => {
		const simulator = runProgram(`
	.data
one:	.float 1.0
	.text
main:
	la $t0, one
	lwc1 $f0, 0($t0)
	li $t1, 1
	movn.s $f2, $f0, $t1
	movz.s $f4, $f0, $t1
	movn.s $f6, $f0, $zero
	movz.s $f8, $f0, $zero
`)
		expect(simulator.fpRegisters[2]).toBe(simulator.fpRegisters[0])
		expect(simulator.fpRegisters[4]).toBe(0)
		expect(simulator.fpRegisters[6]).toBe(0)
		expect(simulator.fpRegisters[8]).toBe(simulator.fpRegisters[0])
	})

	it('moves both words of a double', () => {
		const simulator = runProgram(`
	.data
value:	.double 2.5
	.text
main:
	la $t0, value
	ldc1 $f0, 0($t0)
	li $t1, 1
	movn.d $f2, $f0, $t1
`)
		expect(simulator.fpRegisters[2]).toBe(simulator.fpRegisters[0])
		expect(simulator.fpRegisters[3]).toBe(simulator.fpRegisters[1])
	})
})

/**
 * Every form A5 and A6 added, written, encoded, decoded and rendered again.
 * The condition code leads for `bc1t`/`bc1f`/`c.cond.fmt` and trails for the
 * conditional moves, which is MARS's own spelling (`InstructionSet.java:1986`,
 * `:2054`, `:1117`).
 */
/**
 * Every form A5 and A6 added, written, encoded, decoded and rendered again.
 * The condition code leads for `bc1t`/`bc1f`/`c.cond.fmt` and trails for the
 * conditional moves, which is MARS's own spelling (`InstructionSet.java:1986`,
 * `:2054`, `:1117`).
 */
describe('round-trips the new forms', () => {
	it.each([
		['bgezal $t0, here', 'bgezal $t0, 0x00400000'],
		['bltzal $t0, here', 'bltzal $t0, 0x00400000'],
		['bc1t here', 'bc1t 0x00400000'],
		['bc1f here', 'bc1f 0x00400000'],
		['bc1t 3, here', 'bc1t 3, 0x00400000'],
		['bc1f 3, here', 'bc1f 3, 0x00400000'],
		['clo $t0, $t1', 'clo $t0, $t1'],
		['clz $t0, $t1', 'clz $t0, $t1'],
		['madd $t0, $t1', 'madd $t0, $t1'],
		['maddu $t0, $t1', 'maddu $t0, $t1'],
		['msub $t0, $t1', 'msub $t0, $t1'],
		['msubu $t0, $t1', 'msubu $t0, $t1'],
		['movn $t0, $t1, $t2', 'movn $t0, $t1, $t2'],
		['movz $t0, $t1, $t2', 'movz $t0, $t1, $t2'],
		['movf $t0, $t1', 'movf $t0, $t1'],
		['movt $t0, $t1', 'movt $t0, $t1'],
		['movf $t0, $t1, 3', 'movf $t0, $t1, 3'],
		['movt $t0, $t1, 3', 'movt $t0, $t1, 3'],
		['movf.s $f0, $f2', 'movf.s $f0, $f2'],
		['movt.s $f0, $f2', 'movt.s $f0, $f2'],
		['movf.d $f0, $f2', 'movf.d $f0, $f2'],
		['movt.d $f0, $f2', 'movt.d $f0, $f2'],
		['movf.s $f0, $f2, 5', 'movf.s $f0, $f2, 5'],
		['movt.s $f0, $f2, 5', 'movt.s $f0, $f2, 5'],
		['movf.d $f0, $f2, 5', 'movf.d $f0, $f2, 5'],
		['movt.d $f0, $f2, 5', 'movt.d $f0, $f2, 5'],
		['movn.s $f0, $f2, $t1', 'movn.s $f0, $f2, $t1'],
		['movz.s $f0, $f2, $t1', 'movz.s $f0, $f2, $t1'],
		['movn.d $f0, $f2, $t1', 'movn.d $f0, $f2, $t1'],
		['movz.d $f0, $f2, $t1', 'movz.d $f0, $f2, $t1'],
		['teq $t0, $t1', 'teq $t0, $t1'],
		['tge $t0, $t1', 'tge $t0, $t1'],
		['tgeu $t0, $t1', 'tgeu $t0, $t1'],
		['tlt $t0, $t1', 'tlt $t0, $t1'],
		['tltu $t0, $t1', 'tltu $t0, $t1'],
		['tne $t0, $t1', 'tne $t0, $t1'],
		['teqi $t0, -5', 'teqi $t0, -5'],
		['tgei $t0, -5', 'tgei $t0, -5'],
		['tgeiu $t0, -5', 'tgeiu $t0, -5'],
		['tlti $t0, -5', 'tlti $t0, -5'],
		['tltiu $t0, -5', 'tltiu $t0, -5'],
		['tnei $t0, -5', 'tnei $t0, -5'],
		['c.eq.s $f0, $f2', 'c.eq.s $f0, $f2'],
		['c.lt.s $f0, $f2', 'c.lt.s $f0, $f2'],
		['c.le.s $f0, $f2', 'c.le.s $f0, $f2'],
		['c.eq.d $f0, $f2', 'c.eq.d $f0, $f2'],
		['c.lt.d $f0, $f2', 'c.lt.d $f0, $f2'],
		['c.le.d $f0, $f2', 'c.le.d $f0, $f2'],
		['c.eq.s 3, $f0, $f2', 'c.eq.s 3, $f0, $f2'],
		['c.lt.s 3, $f0, $f2', 'c.lt.s 3, $f0, $f2'],
		['c.le.s 3, $f0, $f2', 'c.le.s 3, $f0, $f2'],
		['c.eq.d 3, $f0, $f2', 'c.eq.d 3, $f0, $f2'],
		['c.lt.d 3, $f0, $f2', 'c.lt.d 3, $f0, $f2'],
		['c.le.d 3, $f0, $f2', 'c.le.d 3, $f0, $f2'],
	])('round-trips %s', (source, expected) => {
		expect(disassemble(words(`here: ${source}`)[0], 0x00400000)).toBe(expected)
	})
})
