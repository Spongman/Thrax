import { Op } from '../ops'
import { describe, expect, it } from 'vitest'
import { decode } from '../decoder'
import { build, run, withExit, words } from './helpers'

/**
 * The simulator fetches and decodes words from memory, so anything that puts a
 * valid word at an executable address runs, no matter where it came from:
 * once `selfModifyingCode` allows it, which is what gates both the text write
 * and the out-of-text fetch in MARS (`Memory.java:377-388`, `:939-944`).
 */
describe('execution reads machine code', () => {
	it('runs a word the program wrote over its own text', async () => {
		// The nop is overwritten with `addi $t0, $t0, 41` before control reaches it.
		const source = withExit(`
li $t0, 1
la $t1, patch
li $t2, 0x2108
sll $t2, $t2, 16
ori $t2, $t2, 41
sw $t2, 0($t1)
patch:
nop
`)
		const simulator = build(source)
		simulator.selfModifyingCode = true
		await simulator.run()
		expect(simulator.registers.$t0).toBe(42)
	})

	it('executes words placed in the data segment', async () => {
		// `generated` holds `jr $ra` followed by a padding word.
		const source = withExit(`
.data
generated: .word 0x03e00008, 0
.text
li $t0, 5
la $t1, generated
jalr $t1
addi $t0, $t0, 1
`)
		const simulator = build(source)
		simulator.selfModifyingCode = true
		await simulator.run()
		expect(simulator.registers.$t0).toBe(6)
	})

	it('drops the cached decoding when the word changes', () => {
		const simulator = build(withExit('nop'))
		expect(simulator.decodeAt(0x00400000)?.op).toBe(Op.SLL)
		// Overwrite the nop with `addiu $t0, $zero, 7`.  A deliberate edit takes
		// the raw path, as MARS's own text editing does (`Memory.java:891-910`).
		simulator.writeMemoryRaw(0x00400000, words('addiu $t0, $zero, 7')[0], 4)
		expect(simulator.decodeAt(0x00400000)?.op).toBe(Op.ADDIU)
	})

	it('halts rather than running through untouched memory', async () => {
		const simulator = await run('li $t0, 1')
		expect(simulator.halted).toBe(true)
		expect(simulator.pc).toBe(0x00400004)
	})

	it('reports a word that decodes to no instruction', async () => {
		const simulator = build(withExit('nop'))
		simulator.writeMemoryRaw(0x00400000, 0xffffffff, 4)
		await simulator.run()
		expect(simulator.console).toContain('Undecodable instruction')
		expect(simulator.halted).toBe(true)
	})
})

describe('decoder', () => {
	it('returns null for a word that encodes no instruction', () => {
		expect(decode(0xffffffff)).toBeNull()
	})

	it('separates bgez from bltz on the rt field', () => {
		expect(decode(words('here: bgez $t0, here')[0])?.op).toBe(Op.BGEZ)
		expect(decode(words('here: bltz $t0, here')[0])?.op).toBe(Op.BLTZ)
	})

	it('reads jalr with an implied link register as writing $ra', () => {
		expect(decode(words('jalr $t0')[0])?.rd).toBe(31)
	})

	it('sign-extends and zero-extends the same immediate field', () => {
		const decoded = decode(words('addi $t0, $t1, -1')[0])
		expect(decoded?.imm).toBe(-1)
		expect(decoded?.uimm).toBe(0xffff)
	})

	it('names floating-point operations with their format', () => {
		expect(decode(words('add.d $f2, $f4, $f6')[0])?.op).toBe(Op.ADD_D)
		expect(decode(words('c.lt.s $f0, $f1')[0])?.op).toBe(Op.C_LT_S)
		expect(decode(words('cvt.w.s $f0, $f1')[0])?.op).toBe(Op.CVT_W_S)
	})

	it('places CP1 operands in ft, fs, and fd', () => {
		const decoded = decode(words('add.s $f2, $f4, $f6')[0])
		expect(decoded?.fd).toBe(2)
		expect(decoded?.fs).toBe(4)
		expect(decoded?.ft).toBe(6)
	})
})

describe('arithmetic corrected by decoding', () => {
	it('truncates signed division toward zero', async () => {
		const simulator = await run(withExit('li $t0, -7\nli $t1, 2\ndiv $t0, $t1\nmflo $t2\nmfhi $t3'))
		expect(simulator.registers.$t2).toBe(-3)
		expect(simulator.registers.$t3).toBe(-1)
	})

	it('keeps the full 64-bit product of a large multiply', async () => {
		const simulator = await run(withExit('li $t0, 0x7fffffff\nli $t1, 0x7fffffff\nmultu $t0, $t1\nmfhi $t2\nmflo $t3'))
		expect(simulator.registers.$t2 >>> 0).toBe(0x3fffffff)
		expect(simulator.registers.$t3 >>> 0).toBe(0x00000001)
	})

	it('links $ra on jalr, so the callee can return', async () => {
		const simulator = await run(withExit('la $t0, helper\njalr $t0\nj end\nhelper:\nli $t1, 1\njr $ra\nend:\nli $t2, 2'))
		expect(simulator.registers.$t1).toBe(1)
		expect(simulator.registers.$t2).toBe(2)
	})
})
