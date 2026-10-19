import { describe, expect, it } from 'vitest'
import { Lexer } from '../../assembler/lexer'
import { build, buildDelayed, output, run, runDelayed, withExit } from './helpers'

/**
 * Behaviour checked against the original MARS 4.5 sources rather than against
 * intuition.  Each case names the file that defines it, so a future change can
 * be argued against the same authority.
 */

const types = (source: string) => new Lexer(source).tokenize().map((token) => token.type)

describe('mnemonics naming labels (Assembler.java:688, OperandFormat.java:122)', () => {
	it('accepts an instruction name as a label definition', async () => {
		expect(await output(withExit('j sub\nsub:\nli $a0, 1\nli $v0, 1\nsyscall'))).toBe('1')
	})

	it('accepts one as a branch target', async () => {
		expect(await output(withExit('li $t0, 0\nbeq $t0, $zero, and\nli $a0, 0\nj print\nand:\nli $a0, 7\nprint:\nli $v0, 1\nsyscall'))).toBe('7')
	})

	it('accepts one as a data address', async () => {
		const source = withExit('.data\nmul: .word 42\n.text\nlw $a0, mul\nli $v0, 1\nsyscall')
		expect(await output(source)).toBe('42')
	})

	it('keeps the source spelling, so the reference matches the definition', async () => {
		// The lexer used to upper-case mnemonics, which made `sub` and `SUB`
		// different names for the same label.
		expect(await output(withExit('j Sub\nSub:\nli $a0, 3\nli $v0, 1\nsyscall'))).toBe('3')
	})

	it('still assembles the instruction of the same name', async () => {
		const simulator = await run(withExit('li $t0, 9\nli $t1, 4\nsub $t2, $t0, $t1\nj sub\nsub:'))
		expect(simulator.registers.$t2).toBe(5)
	})
})

describe('integer literals (Binary.stringToInt via Integer.decode)', () => {
	it('reads a leading zero as octal', async () => {
		const simulator = await run(withExit('li $t0, 010\nli $t1, 0777'))
		expect(simulator.registers.$t0).toBe(8)
		expect(simulator.registers.$t1).toBe(511)
	})

	it('leaves plain zero and decimal alone', async () => {
		const simulator = await run(withExit('li $t0, 0\nli $t1, 10\nli $t2, 90'))
		expect(simulator.registers.$t0).toBe(0)
		expect(simulator.registers.$t1).toBe(10)
		expect(simulator.registers.$t2).toBe(90)
	})

	it('does not mistake a float for octal', async () => {
		const simulator = await run(withExit('li.s $f0, 0.5'))
		expect(simulator.readFpSingle(0)).toBe(0.5)
	})

	it('wraps a full-width hex constant to its signed value', async () => {
		const simulator = await run(withExit('li $t0, 0xffffffff'))
		expect(simulator.registers.$t0 | 0).toBe(-1)
	})
})

describe('character literals (Tokenizer.java:preprocessCharacterLiteral)', () => {
	it('yields the code point of a plain character', async () => {
		expect((await run(withExit("li $t0, 'A'"))).registers.$t0).toBe(65)
	})

	it('decodes the tabulated character escapes', async () => {
		const simulator = await run(withExit("li $t0, '\\n'\nli $t1, '\\t'\nli $t2, '\\0'\nli $t3, '\\\\'\nli $t4, '\\''"))
		expect(simulator.registers.$t0).toBe(10)
		expect(simulator.registers.$t1).toBe(9)
		expect(simulator.registers.$t2).toBe(0)
		expect(simulator.registers.$t3).toBe(92)
		expect(simulator.registers.$t4).toBe(39)
	})

	it('decodes a three-digit octal escape', async () => {
		const simulator = await run(withExit("li $t0, '\\377'\nli $t1, '\\101'"))
		expect(simulator.registers.$t0).toBe(255)
		expect(simulator.registers.$t1).toBe(65)
	})
})

describe('string escapes (Assembler.java:1210, octal explicitly not implemented)', () => {
	it('decodes the tabulated escapes', async () => {
		expect(await output(withExit('.data\ns: .asciiz "a\\tb\\nc"\n.text\nla $a0, s\nli $v0, 4\nsyscall'))).toBe('a\tb\nc')
	})

	it('leaves an octal escape alone inside a string, as MARS does', async () => {
		// MARS decodes ÿ in a character literal but not in a string, where the
		// backslash is dropped and the digits stay.
		expect(await output(withExit('.data\ns: .asciiz "\\377"\n.text\nla $a0, s\nli $v0, 4\nsyscall'))).toBe('377')
	})
})

describe('line structure (Tokenizer.java tokenizes one line at a time)', () => {
	it('ends the line at a comment rather than swallowing the newline', () => {
		expect(types('add # note\nsub\n')).toEqual(['INSTRUCTION', 'NEWLINE', 'INSTRUCTION', 'NEWLINE', 'EOF'])
	})

	it('keeps a trailing comment from merging an operand into the next line', async () => {
		expect(await output(withExit('li $a0, 5   # five\nli $v0, 1\nsyscall'))).toBe('5')
	})
})

describe('identifiers (TokenTypes.java:isValidIdentifier)', () => {
	it('admits $ inside a name', async () => {
		expect(await output(withExit('j my$label\nmy$label:\nli $a0, 8\nli $v0, 1\nsyscall'))).toBe('8')
	})
})

describe('immediate operand forms (PseudoOps.txt)', () => {
	it('folds a small immediate into the I-type form', async () => {
		const simulator = await run(withExit('li $t1, 10\nadd $t0, $t1, 5\nand $t2, $t1, 6\nor $t3, $t1, 1\nslt $t4, $t1, 20'))
		expect(simulator.registers.$t0).toBe(15)
		expect(simulator.registers.$t2).toBe(2)
		expect(simulator.registers.$t3).toBe(11)
		expect(simulator.registers.$t4).toBe(1)
	})

	it('routes a wide immediate through $at', async () => {
		const simulator = await run(withExit('li $t1, 1\nadd $t0, $t1, 100000\nxor $t2, $zero, 0x12345'))
		expect(simulator.registers.$t0).toBe(100001)
		expect(simulator.registers.$t2).toBe(0x12345)
	})

	it('subtracts an immediate, which has no I-type form', async () => {
		const simulator = await run(withExit('li $t1, 50\nsub $t0, $t1, 8\nsubi $t2, $t1, 100000'))
		expect(simulator.registers.$t0).toBe(42)
		expect(simulator.registers.$t2).toBe(50 - 100000)
	})

	it('accepts the two-operand form, which repeats the destination', async () => {
		const simulator = await run(withExit('li $t0, 12\nand $t0, 10\nli $t1, 5\nadd $t1, 3'))
		expect(simulator.registers.$t0).toBe(8)
		expect(simulator.registers.$t1).toBe(8)
	})

	it('compares against a constant in the set and branch pseudo-ops', async () => {
		const simulator = await run(withExit('li $t1, 7\nsge $t0, $t1, 7\nsle $t2, $t1, 3\nsgt $t3, $t1, 2\nseq $t4, $t1, 7'))
		expect(simulator.registers.$t0).toBe(1)
		expect(simulator.registers.$t2).toBe(0)
		expect(simulator.registers.$t3).toBe(1)
		expect(simulator.registers.$t4).toBe(1)
	})

	it('branches against a constant', async () => {
		const source = withExit('li $t0, 3\nblt $t0, 10, taken\nli $a0, 0\nj print\ntaken:\nli $a0, 1\nprint:\nli $v0, 1\nsyscall')
		expect(await output(source)).toBe('1')
	})

	it('divides and takes a remainder in the three-operand form', async () => {
		const simulator = await run(withExit('li $t1, 17\ndiv $t0, $t1, 5\nrem $t2, $t1, 5\ndivu $t3, $t1, 4'))
		expect(simulator.registers.$t0).toBe(3)
		expect(simulator.registers.$t2).toBe(2)
		expect(simulator.registers.$t3).toBe(4)
	})

	it('rotates by a constant and by a register', async () => {
		const simulator = await run(withExit('li $t1, 0x80000001\nrol $t0, $t1, 1\nror $t2, $t1, 1\nli $t5, 4\nrol $t3, $t1, $t5'))
		expect(simulator.registers.$t0 >>> 0).toBe(0x00000003)
		expect(simulator.registers.$t2 >>> 0).toBe(0xc0000000)
		expect(simulator.registers.$t3 >>> 0).toBe(0x00000018)
	})

	it('moves a doubleword to and from a register pair', async () => {
		const source = withExit('.data\npair: .word 0x11111111, 0x22222222\nslot: .word 0, 0\n.text\nld $t0, pair\nsd $t0, slot\nlw $t4, slot\nlw $t5, slot+4')
		const simulator = await run(source)
		expect(simulator.registers.$t0 >>> 0).toBe(0x11111111)
		expect(simulator.registers.$t1 >>> 0).toBe(0x22222222)
		expect(simulator.registers.$t4 >>> 0).toBe(0x11111111)
		expect(simulator.registers.$t5 >>> 0).toBe(0x22222222)
	})

	it('rejects a constant where only a register will do', () => {
		// `add $t0, $t1, 5` used to assemble as `add $t0, $t1, $zero`.
		expect(() => build(withExit('mult $t0, 5'))).toThrow(/Expected a register/)
	})
})

describe('unaligned and atomic transfers (InstructionSet.java:670-830)', () => {
	// Little-endian, so byte 0 of the first word is 0x00 and byte 4 is 0x04.
	const bytes = `.data
buffer: .word 0x03020100, 0x07060504
.text
`

	it('treats ll and sc as lw and sw, with sc reporting success', async () => {
		const simulator = await run(withExit(`${bytes}la $t3, buffer
ll $t0, 0($t3)
li $t1, 42
sc $t1, 4($t3)
lw $t2, 4($t3)`))
		expect(simulator.registers.$t0 >>> 0).toBe(0x03020100)
		expect(simulator.registers.$t2).toBe(42)
		// sc leaves 1 in the source register, not the stored value.
		expect(simulator.registers.$t1).toBe(1)
	})

	it('loads a word that straddles a boundary with lwl and lwr', async () => {
		const simulator = await run(withExit(`${bytes}la $t3, buffer
lwl $t0, 4($t3)
lwr $t0, 1($t3)`))
		expect(simulator.registers.$t0 >>> 0).toBe(0x04030201)
	})

	it('stores one with swl and swr', async () => {
		const simulator = await run(withExit(`${bytes}la $t3, buffer
li $t0, 0x11223344
swl $t0, 4($t3)
swr $t0, 1($t3)
lw $t1, 0($t3)
lw $t2, 4($t3)`))
		expect(simulator.registers.$t1 >>> 0).toBe(0x22334400)
		expect(simulator.registers.$t2 >>> 0).toBe(0x07060511)
	})

	it('round-trips an unaligned word through ulw and usw', async () => {
		const simulator = await run(withExit(`${bytes}la $t3, buffer
ulw $t0, 1($t3)
li $t1, 0x11223344
usw $t1, 1($t3)
ulw $t2, 1($t3)`))
		expect(simulator.registers.$t0 >>> 0).toBe(0x04030201)
		expect(simulator.registers.$t2 >>> 0).toBe(0x11223344)
	})

	it('loads an unaligned halfword signed and unsigned', async () => {
		const simulator = await run(withExit(`.data
half: .word 0x00ff8000
.text
la $t3, half
ulh $t0, 1($t3)
ulhu $t1, 1($t3)`))
		// Bytes 1 and 2 are 0x80 and 0xff, so the halfword is 0xff80.
		expect(simulator.registers.$t0 | 0).toBe(-128)
		expect(simulator.registers.$t1 >>> 0).toBe(0xff80)
	})

	it('stores an unaligned halfword and leaves the source unchanged', async () => {
		const simulator = await run(withExit(`${bytes}la $t3, buffer
li $t0, 0xbeef
ush $t0, 1($t3)
lw $t1, 0($t3)`))
		expect(simulator.registers.$t1 >>> 0).toBe(0x03beef00)
		expect(simulator.registers.$t0 >>> 0).toBe(0xbeef)
	})

	it('reaches an unaligned address named by a label', async () => {
		const simulator = await run(withExit(`${bytes}ulw $t0, buffer+1
ulh $t1, buffer+1`))
		expect(simulator.registers.$t0 >>> 0).toBe(0x04030201)
		expect(simulator.registers.$t1 >>> 0).toBe(0x0201)
	})
})

describe('mulo and mulou trap on overflow (PseudoOps.txt:219)', () => {
	it('gives the product when it fits 32 bits', async () => {
		const simulator = await run(withExit(`li $t1, 100000
li $t2, 20000
mulo $t0, $t1, $t2
mulou $t3, $t1, $t2`))
		expect(simulator.registers.$t0 | 0).toBe(2000000000)
		expect(simulator.registers.$t3 | 0).toBe(2000000000)
	})

	it('breaks when the signed product does not', async () => {
		const simulator = await run(withExit(`li $t1, 100000
li $t2, 100000
mulo $t0, $t1, $t2`))
		expect(simulator.console).toMatch(/break instruction executed/)
	})

	it('breaks when the unsigned product does not', async () => {
		const simulator = await run(withExit(`li $t1, 0x10000
li $t2, 0x10000
mulou $t0, $t1, $t2`))
		expect(simulator.console).toMatch(/break instruction executed/)
	})

	it('lets a negative product through, which the unsigned form rejects', async () => {
		const signed = await run(withExit(`li $t1, -3
li $t2, 7
mulo $t0, $t1, $t2`))
		expect(signed.registers.$t0 | 0).toBe(-21)
		const unsigned = await run(withExit(`li $t1, -3
li $t2, 7
mulou $t0, $t1, $t2`))
		expect(unsigned.console).toMatch(/break instruction executed/)
	})
})

describe('delayed branching (DelayedBranch.java, Settings.java:130)', () => {
	const skipping = withExit(`li $t1, 0
b skip
li $t1, 7
li $t1, 99
skip:
li $t2, 3`)

	it('is off by default, so the instruction after a branch is skipped', async () => {
		const simulator = await run(skipping)
		expect(simulator.registers.$t1).toBe(0)
		expect(simulator.registers.$t2).toBe(3)
	})

	it('runs the delay slot when it is on', async () => {
		const simulator = await runDelayed(skipping)
		expect(simulator.registers.$t1).toBe(7)
		expect(simulator.registers.$t2).toBe(3)
	})

	it('runs the delay slot of a jump too', async () => {
		const simulator = await runDelayed(withExit(`j over
li $t0, 4
li $t0, 99
over:
nop`))
		expect(simulator.registers.$t0).toBe(4)
	})

	it('links past the delay slot, so a call does not run it twice', async () => {
		const simulator = await runDelayed(withExit(`li $t0, 0
jal fn
addi $t0, $t0, 1
li $t1, 2
j done
nop
fn:
jr $ra
nop
done:
nop`))
		expect(simulator.registers.$t0).toBe(1)
		expect(simulator.registers.$t1).toBe(2)
	})

	it('keeps a pending branch across a step back into its delay slot', () => {
		const simulator = buildDelayed(withExit(`b skip
li $t1, 7
li $t1, 99
skip:
li $t2, 3`))
		simulator.step()
		simulator.step()
		const landed = simulator.pc
		expect(simulator.stepBack()).toBe(true)
		simulator.step()
		expect(simulator.pc).toBe(landed)
		expect(simulator.registers.$t1).toBe(7)
	})

	it('branches over its own delay slot in mulo', async () => {
		const simulator = await runDelayed(withExit(`li $t1, 100000
li $t2, 20000
mulo $t0, $t1, $t2`))
		expect(simulator.registers.$t0 | 0).toBe(2000000000)
	})

	it('still breaks on overflow with a delay slot in the way', async () => {
		const simulator = await runDelayed(withExit(`li $t1, 100000
li $t2, 100000
mulo $t0, $t1, $t2`))
		expect(simulator.console).toMatch(/break instruction executed/)
	})
})
