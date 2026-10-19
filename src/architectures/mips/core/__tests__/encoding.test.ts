import { describe, expect, it } from 'vitest'
import { words } from './helpers'

/**
 * Machine-code encodings verified by hand against the MIPS32 field layout.
 * These are the oracle for the decoder, so they are written as literal words
 * rather than derived from the assembler's own tables.
 */
describe('instruction encoding', () => {
	it.each([
		['add $t0, $t1, $t2', 0x012a4020],
		['addu $t0, $t1, $t2', 0x012a4021],
		['sub $t0, $t1, $t2', 0x012a4022],
		['and $t0, $t1, $t2', 0x012a4024],
		['or $t0, $t1, $t2', 0x012a4025],
		['xor $t0, $t1, $t2', 0x012a4026],
		['nor $t0, $t1, $t2', 0x012a4027],
		['slt $t0, $t1, $t2', 0x012a402a],
		['sltu $t0, $t1, $t2', 0x012a402b],
	])('encodes %s', (source, expected) => {
		expect(words(source)[0]).toBe(expected)
	})

	it.each([
		['sll $t0, $t1, 4', 0x00094100],
		['srl $t0, $t1, 4', 0x00094102],
		['sra $t0, $t1, 4', 0x00094103],
		['sllv $t0, $t1, $t2', 0x01494004],
		['srlv $t0, $t1, $t2', 0x01494006],
		['srav $t0, $t1, $t2', 0x01494007],
	])('encodes %s', (source, expected) => {
		expect(words(source)[0]).toBe(expected)
	})

	it.each([
		['addi $t0, $t1, 100', 0x21280064],
		['addiu $t0, $t1, 100', 0x25280064],
		['slti $t0, $t1, 100', 0x29280064],
		['sltiu $t0, $t1, 100', 0x2d280064],
		['andi $t0, $t1, 0xff', 0x312800ff],
		['ori $t0, $t1, 0xff', 0x352800ff],
		['xori $t0, $t1, 0xff', 0x392800ff],
		['lui $t0, 0x1001', 0x3c081001],
	])('encodes %s', (source, expected) => {
		expect(words(source)[0]).toBe(expected)
	})

	it.each([
		['lw $t0, 4($sp)', 0x8fa80004],
		['lb $t0, 4($sp)', 0x83a80004],
		['lbu $t0, 4($sp)', 0x93a80004],
		['lh $t0, 4($sp)', 0x87a80004],
		['lhu $t0, 4($sp)', 0x97a80004],
		['sw $t0, 4($sp)', 0xafa80004],
		['sb $t0, 4($sp)', 0xa3a80004],
		['sh $t0, 4($sp)', 0xa7a80004],
	])('encodes %s', (source, expected) => {
		expect(words(source)[0]).toBe(expected)
	})

	it.each([
		['mult $t0, $t1', 0x01090018],
		['multu $t0, $t1', 0x01090019],
		['div $t0, $t1', 0x0109001a],
		['divu $t0, $t1', 0x0109001b],
		['mul $t0, $t1, $t2', 0x712a4002],
		['mfhi $t0', 0x00004010],
		['mflo $t0', 0x00004012],
		['mthi $t0', 0x01000011],
		['mtlo $t0', 0x01000013],
	])('encodes %s', (source, expected) => {
		expect(words(source)[0]).toBe(expected)
	})

	it.each([
		['jr $ra', 0x03e00008],
		['jalr $t0', 0x0100f809],
		['jalr $t1, $t0', 0x01004809],
		['syscall', 0x0000000c],
		['nop', 0x00000000],
	])('encodes %s', (source, expected) => {
		expect(words(source)[0]).toBe(expected)
	})

	it('encodes a backward branch as a negative word offset', () => {
		// beq is at 0x00400004; the target is one instruction behind it.
		expect(words('top: nop\nbeq $t0, $t1, top\n')[1]).toBe(0x1109fffe)
	})

	it('encodes a forward branch', () => {
		expect(words('bne $t0, $t1, skip\nnop\nskip: nop\n')[0]).toBe(0x15090001)
	})

	it.each([
		['bgez $t0, here\nhere: nop', 0x05010000],
		['bltz $t0, here\nhere: nop', 0x05000000],
		['blez $t0, here\nhere: nop', 0x19000000],
		['bgtz $t0, here\nhere: nop', 0x1d000000],
	])('encodes %s', (source, expected) => {
		expect(words(source)[0]).toBe(expected)
	})

	it('encodes jumps with an absolute word index', () => {
		expect(words('here: j here\n')[0]).toBe(0x08100000)
		expect(words('here: jal here\n')[0]).toBe(0x0c100000)
	})
})

describe('pseudo-instruction expansion', () => {
	it('expands a small li to a single addiu', () => {
		expect(words('li $t0, 5')).toEqual([0x24080005])
	})

	// The halves go through $at, and only the `ori` names the destination
	// (`PseudoOps.txt:237`).
	it('expands a large li to lui/ori through $at', () => {
		expect(words('li $t0, 0x12345678')).toEqual([0x3c011234, 0x34285678])
	})

	// `addu RG1, $0, RG2` (`PseudoOps.txt:190`).
	it('expands move to addu with $zero', () => {
		expect(words('move $t0, $t1')).toEqual([0x00094021])
	})

	it('expands nop to sll $zero, $zero, 0', () => {
		expect(words('nop')).toEqual([0x00000000])
	})

	// `bgez $0, LAB` (`PseudoOps.txt:195`).
	it('expands b to bgez $zero', () => {
		expect(words('here: b here')).toEqual([0x0401ffff])
	})

	it('expands blt to slt/bne through $at', () => {
		expect(words('here: blt $t0, $t1, here')).toEqual([0x0109082a, 0x1420fffe])
	})

	it('expands la to lui/ori over the label address', () => {
		const [high, low] = words('.data\nvalue: .word 7\n.text\nla $t0, value\n')
		expect(high).toBe(0x3c011001)
		expect(low).toBe(0x34280000)
	})
})

describe('label operands in loads and stores', () => {
	/**
	 * A label address does not fit an instruction's 16-bit offset field, so the
	 * assembler must route it through $at rather than truncate it.
	 */
	it('loads through $at instead of dropping the upper half of the address', () => {
		const source = '.data\n.space 0x1000\nvalue: .word 7\n.text\nlw $t0, value\n'
		const [high, load] = words(source)
		expect(high).toBe(0x3c011001)
		expect(load).toBe(0x8c281000)
	})

	it('routes floating-point loads and stores through $at too', () => {
		expect(words('.data\n.space 0x1000\nvalue: .float 1.0\n.text\nl.s $f0, value\n')).toHaveLength(2)
		expect(words('.data\n.space 0x1000\nvalue: .float 1.0\n.text\ns.s $f0, value\n')).toHaveLength(2)
	})

	it('leaves an explicit offset(base) operand as one instruction', () => {
		expect(words('lw $t0, 4($sp)')).toHaveLength(1)
		expect(words('l.s $f0, 4($sp)')).toHaveLength(1)
	})
})
