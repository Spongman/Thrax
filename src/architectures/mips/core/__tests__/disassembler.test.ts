import { describe, expect, it } from 'vitest'
import { disassemble } from '../disassembler'
import { words } from './helpers'

/** Assembles one line and reads the resulting word back as text. */
function roundTrip(source: string, address = 0x00400000): string | null {
	return disassemble(words(source)[0], address)
}

describe('disassembly', () => {
	it.each([
		'add $t0, $t1, $t2',
		'sub $t0, $t1, $t2',
		'and $t0, $t1, $t2',
		'or $t0, $t1, $t2',
		'xor $t0, $t1, $t2',
		'nor $t0, $t1, $t2',
		'slt $t0, $t1, $t2',
		'sltu $t0, $t1, $t2',
		'sll $t0, $t1, 4',
		'srl $t0, $t1, 4',
		'sra $t0, $t1, 4',
		'sllv $t0, $t1, $t2',
		'mult $t0, $t1',
		'divu $t0, $t1',
		'mfhi $t0',
		'mtlo $t0',
		'jr $ra',
		'syscall',
		'nop',
		'addi $t0, $t1, 100',
		'addiu $t0, $t1, -1',
		'slti $t0, $t1, 100',
		'lw $t0, 4($sp)',
		'sb $t0, -8($sp)',
		'mul $t0, $t1, $t2',
	])('round-trips %s', (source) => {
		expect(roundTrip(source)).toBe(source)
	})

	it('names the implied link register on jalr', () => {
		expect(roundTrip('jalr $t0')).toBe('jalr $t0')
		expect(roundTrip('jalr $t1, $t0')).toBe('jalr $t1, $t0')
	})

	it('shows logical immediates in hex', () => {
		expect(roundTrip('andi $t0, $t1, 0xff')).toBe('andi $t0, $t1, 0xFF')
		expect(roundTrip('lui $t0, 0x1001')).toBe('lui $t0, 0x1001')
	})

	it('resolves branch and jump targets against the address', () => {
		expect(disassemble(words('here: beq $t0, $t1, here')[0], 0x00400000)).toBe('beq $t0, $t1, 0x00400000')
		expect(disassemble(words('here: j here')[0], 0x00400000)).toBe('j 0x00400000')
		expect(disassemble(words('here: bgez $t0, here')[0], 0x00400000)).toBe('bgez $t0, 0x00400000')
		expect(disassemble(words('here: bltz $t0, here')[0], 0x00400000)).toBe('bltz $t0, 0x00400000')
	})

	it.each([
		'add.s $f2, $f0, $f1',
		'mul.d $f4, $f2, $f0',
		'sqrt.s $f1, $f0',
		'neg.d $f2, $f0',
		'cvt.w.s $f1, $f0',
		'cvt.d.s $f2, $f0',
		'c.lt.s $f0, $f1',
		'c.eq.d $f0, $f2',
		'mfc1 $t0, $f0',
		'mtc1 $t0, $f0',
		'lwc1 $f0, 0($sp)',
		'sdc1 $f0, 8($sp)',
	])('round-trips %s', (source) => {
		expect(roundTrip(source)).toBe(source)
	})

	it('round-trips coprocessor 0 moves', () => {
		expect(roundTrip('mfc0 $t0, $13')).toBe('mfc0 $t0, $13')
		expect(roundTrip('eret')).toBe('eret')
	})

	it('returns null for a word that is not an instruction', () => {
		expect(disassemble(0xffffffff)).toBeNull()
	})
})
