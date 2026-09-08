/**
 * What each mnemonic does, in one line, and how that reads as a tip.
 *
 * One entry per mnemonic rather than per form: the forms of a mnemonic differ
 * in how an operand is written, not in what it means, and `isa.ts` already
 * carries the syntax of every one of them.  A tip is the description plus that
 * table's own examples, so adding an instruction adds one line here.
 *
 * The wording follows this simulator, which is not always real MIPS32: `mul`
 * leaves hi and lo alone (`simulator.ts:1547`), a zero divisor raises nothing
 * and leaves hi and lo as they were (`simulator.ts:1650`), `sc` always
 * succeeds (`simulator.ts:1712`), and `clo`/`clz` count from the top of `rs`
 * (`simulator.ts:1641`).
 */

import { basicForms, pseudoForms } from './isa'

/** Keyed by the lower case mnemonic, as `isa.ts` spells it. */
export const INSTRUCTION_DOCS: Readonly<Record<string, string>> = {
	// Arithmetic
	nop: 'Do nothing.  The word of all zeros, which reads as `sll $zero,$zero,0`.',
	add: 'Add two registers, trapping on signed overflow.',
	addu: 'Add two registers, wrapping around on overflow.',
	addi: 'Add a sign extended 16 bit constant, trapping on signed overflow.',
	addiu: 'Add a sign extended 16 bit constant, wrapping around on overflow.',
	sub: 'Subtract the third operand from the second, trapping on signed overflow.',
	subu: 'Subtract the third operand from the second, wrapping around on overflow.',
	subi: 'Subtract a constant, trapping on signed overflow.',
	subiu: 'Subtract a constant, wrapping around on overflow.',
	mult: 'Multiply two registers as signed; the 64 bit product lands in hi and lo.',
	multu: 'Multiply two registers as unsigned; the 64 bit product lands in hi and lo.',
	mul: 'Multiply two registers and keep the low 32 bits in the destination, leaving hi and lo alone.',
	mulu: 'Multiply as unsigned and keep the low 32 bits in the destination.',
	mulo: 'Multiply as signed into the destination, trapping when the product does not fit 32 bits.',
	mulou: 'Multiply as unsigned into the destination, trapping when the product does not fit 32 bits.',
	madd: 'Multiply as signed and add the product to the 64 bit hi/lo pair.',
	maddu: 'Multiply as unsigned and add the product to the 64 bit hi/lo pair.',
	msub: 'Multiply as signed and subtract the product from the 64 bit hi/lo pair.',
	msubu: 'Multiply as unsigned and subtract the product from the 64 bit hi/lo pair.',
	div: 'Divide as signed: quotient in lo, remainder in hi.  The three operand form puts the quotient in a register.',
	divu: 'Divide as unsigned: quotient in lo, remainder in hi.  The three operand form puts the quotient in a register.',
	rem: 'Signed remainder of a division, into the destination register.',
	remu: 'Unsigned remainder of a division, into the destination register.',
	abs: 'Absolute value of a register.',
	neg: 'Negate a register, trapping on signed overflow.',
	negu: 'Negate a register, wrapping around on overflow.',
	mfhi: 'Copy hi into a register.',
	mflo: 'Copy lo into a register.',
	mthi: 'Copy a register into hi.',
	mtlo: 'Copy a register into lo.',

	// Logical and shifts
	and: 'Bitwise and of two registers.',
	andi: 'Bitwise and with a zero extended 16 bit constant.',
	or: 'Bitwise or of two registers.',
	ori: 'Bitwise or with a zero extended 16 bit constant.',
	xor: 'Bitwise exclusive or of two registers.',
	xori: 'Bitwise exclusive or with a zero extended 16 bit constant.',
	nor: 'Bitwise nor of two registers: the complement of their or.',
	not: 'Bitwise complement of a register.',
	sll: 'Shift left by a 5 bit constant, filling with zeros.',
	sllv: 'Shift left by the low 5 bits of a register, filling with zeros.',
	srl: 'Shift right by a 5 bit constant, filling with zeros.',
	srlv: 'Shift right by the low 5 bits of a register, filling with zeros.',
	sra: 'Shift right by a 5 bit constant, filling with the sign bit.',
	srav: 'Shift right by the low 5 bits of a register, filling with the sign bit.',
	rol: 'Rotate left, the bits shifted out coming back in at the bottom.',
	ror: 'Rotate right, the bits shifted out coming back in at the top.',
	clo: 'Count the leading one bits of a register, 0 to 32.',
	clz: 'Count the leading zero bits of a register, 0 to 32.',

	// Comparison
	slt: 'Set the destination to 1 when the second operand is below the third as signed, else 0.',
	sltu: 'Set the destination to 1 when the second operand is below the third as unsigned, else 0.',
	slti: 'Set the destination to 1 when the register is below a sign extended constant as signed, else 0.',
	sltiu: 'Set the destination to 1 when the register is below a sign extended constant as unsigned, else 0.',
	seq: 'Set the destination to 1 when the two operands are equal, else 0.',
	sne: 'Set the destination to 1 when the two operands differ, else 0.',
	sge: 'Set the destination to 1 when the second operand is at least the third as signed, else 0.',
	sgeu: 'Set the destination to 1 when the second operand is at least the third as unsigned, else 0.',
	sgt: 'Set the destination to 1 when the second operand is above the third as signed, else 0.',
	sgtu: 'Set the destination to 1 when the second operand is above the third as unsigned, else 0.',
	sle: 'Set the destination to 1 when the second operand is at most the third as signed, else 0.',
	sleu: 'Set the destination to 1 when the second operand is at most the third as unsigned, else 0.',

	// Loads and stores
	lw: 'Load a word from memory into a register.',
	lh: 'Load a halfword, sign extended to 32 bits.',
	lhu: 'Load a halfword, zero extended to 32 bits.',
	lb: 'Load a byte, sign extended to 32 bits.',
	lbu: 'Load a byte, zero extended to 32 bits.',
	sw: 'Store a register as a word.',
	sh: 'Store the low halfword of a register.',
	sb: 'Store the low byte of a register.',
	lui: 'Load a 16 bit constant into the high half of a register, zeroing the low half.',
	ll: 'Load a word and begin an atomic pair.  One processor is simulated, so this is `lw`.',
	sc: 'Store a word and report whether the atomic pair held.  One processor is simulated, so it always succeeds and writes 1 back.',
	lwl: 'Load the bytes from the effective address down to its word boundary into the top of the register, leaving the rest.',
	lwr: 'Load the bytes from the effective address up to the end of its word into the bottom of the register, leaving the rest.',
	swl: 'Store the top bytes of the register from the effective address down to its word boundary.',
	swr: 'Store the bottom bytes of the register from the effective address up to the end of its word.',
	ulw: 'Load a word from an address of any alignment.',
	usw: 'Store a word to an address of any alignment.',
	ulh: 'Load a halfword from an address of any alignment, sign extended.',
	ulhu: 'Load a halfword from an address of any alignment, zero extended.',
	ush: 'Store the low halfword of a register to an address of any alignment.',
	ld: 'Load two consecutive words, into a register and the one after it.',
	sd: 'Store a register and the one after it as two consecutive words.',
	li: 'Load a 32 bit constant into a register.',
	la: 'Load an address into a register.',
	move: 'Copy one register into another.',

	// Branches and jumps
	beq: 'Branch when the two operands are equal.',
	bne: 'Branch when the two operands differ.',
	beqz: 'Branch when the register is zero.',
	bnez: 'Branch when the register is not zero.',
	bgez: 'Branch when the register is at least zero.',
	bgtz: 'Branch when the register is above zero.',
	blez: 'Branch when the register is at most zero.',
	bltz: 'Branch when the register is below zero.',
	bgezal: 'Branch when the register is at least zero, leaving the return address in `$ra`.',
	bltzal: 'Branch when the register is below zero, leaving the return address in `$ra`.',
	bge: 'Branch when the second operand is at least the third as signed.',
	bgeu: 'Branch when the second operand is at least the third as unsigned.',
	bgt: 'Branch when the second operand is above the third as signed.',
	bgtu: 'Branch when the second operand is above the third as unsigned.',
	ble: 'Branch when the second operand is at most the third as signed.',
	bleu: 'Branch when the second operand is at most the third as unsigned.',
	blt: 'Branch when the second operand is below the third as signed.',
	bltu: 'Branch when the second operand is below the third as unsigned.',
	b: 'Branch unconditionally.',
	bal: 'Branch unconditionally, leaving the return address in `$ra`.',
	j: 'Jump to a label.',
	jr: 'Jump to the address held in a register.',
	jal: 'Jump to a label, leaving the return address in `$ra`.',
	jalr: 'Jump to the address held in a register, leaving the return address in `$ra` or a named register.',

	// Conditional moves
	movn: 'Copy the second register when the third is not zero.',
	movz: 'Copy the second register when the third is zero.',
	movf: 'Copy the second register when the floating point condition flag is false.',
	movt: 'Copy the second register when the floating point condition flag is true.',

	// Traps and system
	syscall: 'Call the system service selected by `$v0`.',
	break: 'Raise a breakpoint exception, with an optional code.',
	teq: 'Trap when the two operands are equal.',
	teqi: 'Trap when the register equals a constant.',
	tne: 'Trap when the two operands differ.',
	tnei: 'Trap when the register differs from a constant.',
	tge: 'Trap when the first operand is at least the second as signed.',
	tgeu: 'Trap when the first operand is at least the second as unsigned.',
	tgei: 'Trap when the register is at least a constant as signed.',
	tgeiu: 'Trap when the register is at least a constant as unsigned.',
	tlt: 'Trap when the first operand is below the second as signed.',
	tltu: 'Trap when the first operand is below the second as unsigned.',
	tlti: 'Trap when the register is below a constant as signed.',
	tltiu: 'Trap when the register is below a constant as unsigned.',
	eret: 'Return from an exception handler, to the address in the EPC register.',
	mfc0: 'Copy a coprocessor 0 register into a general register.',
	mtc0: 'Copy a general register into a coprocessor 0 register.',

	// Floating point arithmetic
	'add.s': 'Add two single precision registers.',
	'add.d': 'Add two double precision register pairs.',
	'sub.s': 'Subtract single precision.',
	'sub.d': 'Subtract double precision.',
	'mul.s': 'Multiply single precision.',
	'mul.d': 'Multiply double precision.',
	'div.s': 'Divide single precision.',
	'div.d': 'Divide double precision.',
	'sqrt.s': 'Square root, single precision.',
	'sqrt.d': 'Square root, double precision.',
	'abs.s': 'Absolute value, single precision.',
	'abs.d': 'Absolute value, double precision.',
	'neg.s': 'Negate, single precision.',
	'neg.d': 'Negate, double precision.',

	// Floating point rounding and conversion
	'round.w.s': 'Round a single to the nearest integer word.',
	'round.w.d': 'Round a double to the nearest integer word.',
	'trunc.w.s': 'Round a single toward zero to an integer word.',
	'trunc.w.d': 'Round a double toward zero to an integer word.',
	'ceil.w.s': 'Round a single up to an integer word.',
	'ceil.w.d': 'Round a double up to an integer word.',
	'floor.w.s': 'Round a single down to an integer word.',
	'floor.w.d': 'Round a double down to an integer word.',
	'cvt.s.d': 'Convert a double to single precision.',
	'cvt.s.w': 'Convert an integer word to single precision.',
	'cvt.d.s': 'Convert a single to double precision.',
	'cvt.d.w': 'Convert an integer word to double precision.',
	'cvt.w.s': 'Convert a single to an integer word.',
	'cvt.w.d': 'Convert a double to an integer word.',

	// Floating point comparison and branches
	'c.eq.s': 'Set the condition flag when two singles are equal.',
	'c.eq.d': 'Set the condition flag when two doubles are equal.',
	'c.lt.s': 'Set the condition flag when the first single is below the second.',
	'c.lt.d': 'Set the condition flag when the first double is below the second.',
	'c.le.s': 'Set the condition flag when the first single is at most the second.',
	'c.le.d': 'Set the condition flag when the first double is at most the second.',
	bc1t: 'Branch when the floating point condition flag is true.',
	bc1f: 'Branch when the floating point condition flag is false.',

	// Floating point moves and transfers
	'mov.s': 'Copy a single precision register.',
	'mov.d': 'Copy a double precision register pair.',
	'movf.s': 'Copy a single when the condition flag is false.',
	'movf.d': 'Copy a double when the condition flag is false.',
	'movt.s': 'Copy a single when the condition flag is true.',
	'movt.d': 'Copy a double when the condition flag is true.',
	'movn.s': 'Copy a single when a general register is not zero.',
	'movn.d': 'Copy a double when a general register is not zero.',
	'movz.s': 'Copy a single when a general register is zero.',
	'movz.d': 'Copy a double when a general register is zero.',
	mfc1: "Copy a floating point register's bits into a general register, unconverted.",
	mtc1: "Copy a general register's bits into a floating point register, unconverted.",
	'mfc1.d': "Copy a double pair's bits into two general registers, unconverted.",
	'mtc1.d': "Copy two general registers' bits into a double pair, unconverted.",
	lwc1: 'Load a word into a floating point register.',
	ldc1: 'Load two words into a floating point register pair.',
	swc1: 'Store a floating point register as a word.',
	sdc1: 'Store a floating point register pair as two words.',
	'l.s': 'Load a single into a floating point register.',
	'l.d': 'Load a double into a floating point register pair.',
	's.s': 'Store a single from a floating point register.',
	's.d': 'Store a double from a floating point register pair.',
	'li.s': 'Load a single precision constant into a floating point register.',
	'li.d': 'Load a double precision constant into a floating point register pair.',
}

/** What `mnemonic` does, however it is cased, or undefined when it names nothing. */
export function instructionDoc(mnemonic: string): string | undefined {
	return INSTRUCTION_DOCS[mnemonic.toLowerCase()]
}

/** The form a completion shows beside the mnemonic: the first the table gives. */
export function instructionSignature(mnemonic: string): string | undefined {
	const name = mnemonic.toLowerCase()
	return basicForms(name)[0]?.example ?? pseudoForms(name)[0]?.example
}

/** How many forms a tip lists before the shapes start repeating. */
const FORM_LIMIT = 6

/**
 * The tip for `mnemonic`, one Markdown paragraph per entry, or null when the
 * word names no instruction.
 *
 * Only `**strong**` and `` `code` `` are used: the same paragraphs are drawn by
 * the gutter's own tip, which understands those two marks and no others
 * (`SourcePane.tsx:112`).
 */
export function instructionHelp(mnemonic: string): string[] | null {
	const doc = instructionDoc(mnemonic)
	if (doc === undefined) return null
	const name = mnemonic.toLowerCase()
	const basic = basicForms(name).map((form) => form.example)
	const pseudo = pseudoForms(name).map((form) => form.example)
	const paragraphs = [`**${name}** ${basic.length > 0 ? 'basic instruction' : 'pseudo-instruction'}`, doc]
	if (basic.length > 0) paragraphs.push(formList(basic))
	// A mnemonic that is both is written as the basic one, and its pseudo forms
	// are the operand shapes the assembler widens, so they are named as such.
	if (pseudo.length > 0) paragraphs.push(basic.length > 0 ? `Pseudo forms: ${formList(pseudo)}` : formList(pseudo))
	return paragraphs
}

function formList(examples: readonly string[]): string {
	const shown = examples.slice(0, FORM_LIMIT)
	const list = shown.map((example) => `\`${example}\``).join(' ')
	const rest = examples.length - shown.length
	return rest > 0 ? `${list} and ${rest} more` : list
}
