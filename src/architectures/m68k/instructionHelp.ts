import { tableInstructionHelp, type InstructionHelp, type InstructionTable } from '../../core/instructionHelp'
import { CONDITIONS } from './isa'

const REFERENCE = 'https://www.nxp.com/docs/en/reference-manual/M68000PRM.pdf'
const DOCS: InstructionTable = {
	move: ['source, destination', 'Copy a byte, word or longword; set N and Z and clear V and C.'],
	movea: ['source, An', 'Load an address register without changing flags; word sources are sign-extended.'],
	moveq: ['#imm8, Dn', 'Sign-extend an 8-bit immediate into a data register; set N and Z and clear V and C.'],
	movem: ['register-list, address | address, register-list', 'Transfer multiple registers to or from memory in architectural register order.'],
	lea: ['address, An', 'Compute an effective address without reading memory or changing flags.'],
	pea: ['address', 'Push an effective address as a longword onto the stack.'],
	add: ['source, destination', 'Add source to destination; update X, N, Z, V and C.'],
	sub: ['source, destination', 'Subtract source from destination; update X, N, Z, V and C.'],
	cmp: ['source, Dn', 'Compare by subtracting source from Dn; set N, Z, V and C without storing a result.'],
	adda: ['source, An', 'Add to an address register without changing flags; word sources are sign-extended.'],
	suba: ['source, An', 'Subtract from an address register without changing flags; word sources are sign-extended.'],
	cmpa: ['source, An', 'Compare against a 32-bit address register; word sources are sign-extended.'],
	and: ['source, destination', 'Bitwise AND; set N and Z and clear V and C.'],
	or: ['source, destination', 'Bitwise OR; set N and Z and clear V and C.'],
	eor: ['Dn, destination', 'Bitwise exclusive OR; set N and Z and clear V and C.'],
	addi: ['#immediate, destination', 'Add an immediate value, updating arithmetic flags.'],
	subi: ['#immediate, destination', 'Subtract an immediate value, updating arithmetic flags.'],
	cmpi: ['#immediate, destination', 'Compare with an immediate value; leave the destination unchanged.'],
	andi: ['#immediate, destination', 'AND an immediate value into the destination.'],
	ori: ['#immediate, destination', 'OR an immediate value into the destination.'],
	eori: ['#immediate, destination', 'Exclusive OR an immediate value into the destination.'],
	addq: ['#1..8, destination', 'Add a quick constant; address-register destinations do not change flags.'],
	subq: ['#1..8, destination', 'Subtract a quick constant; address-register destinations do not change flags.'],
	clr: ['destination', 'Clear the operand; set Z and clear N, V and C.'],
	tst: ['source', 'Set N and Z from the operand and clear V and C, without changing the operand.'],
	neg: ['destination', 'Negate the operand using two’s complement, updating arithmetic flags.'],
	not: ['destination', 'Complement every bit; set N and Z and clear V and C.'],
	swap: ['Dn', 'Exchange the upper and lower 16-bit halves; set N and Z and clear V and C.'],
	exg: ['register, register', 'Exchange two data or address registers without changing flags.'],
	ext: ['Dn', 'Sign-extend a byte to a word (.w) or a word to a longword (.l).'],
	extb: ['Dn', 'Sign-extend a byte to a longword. Requires MC68020 or later.'],
	muls: ['source, Dn', 'Multiply signed 16-bit operands into a 32-bit product.'],
	mulu: ['source, Dn', 'Multiply unsigned 16-bit operands into a 32-bit product.'],
	divs: ['source, Dn', 'Divide a signed 32-bit dividend by a signed 16-bit divisor; pack remainder above quotient.'],
	divu: ['source, Dn', 'Divide an unsigned 32-bit dividend by an unsigned 16-bit divisor; pack remainder above quotient.'],
	asl: ['count, Dn | address', 'Shift left arithmetically; update carry, extend and overflow. Memory forms shift a word once.'],
	asr: ['count, Dn | address', 'Shift right arithmetically, retaining the sign bit and updating carry and extend.'],
	lsl: ['count, Dn | address', 'Shift left logically, inserting zeros and updating carry and extend.'],
	lsr: ['count, Dn | address', 'Shift right logically, inserting zeros and updating carry and extend.'],
	rol: ['count, Dn | address', 'Rotate left within the operand; leave X unchanged.'],
	ror: ['count, Dn | address', 'Rotate right within the operand; leave X unchanged.'],
	roxl: ['count, Dn | address', 'Rotate left through the extend flag X.'],
	roxr: ['count, Dn | address', 'Rotate right through the extend flag X.'],
	btst: ['bit, destination', 'Test a bit and set Z if it was clear. Bit numbers wrap modulo 32 for registers, 8 for memory.'],
	bchg: ['bit, destination', 'Test a bit into Z, then complement that bit.'],
	bclr: ['bit, destination', 'Test a bit into Z, then clear that bit.'],
	bset: ['bit, destination', 'Test a bit into Z, then set that bit.'],
	bra: ['target', 'Branch unconditionally to target.'],
	bsr: ['target', 'Branch to a subroutine, pushing the return address.'],
	jmp: ['address', 'Jump to an effective address.'],
	jsr: ['address', 'Push the return address and jump to an effective address.'],
	rts: ['', 'Pop a longword return address from the stack into PC.'],
	rtd: ['#displacement', 'Return and release displacement bytes of stack arguments. Requires MC68010 or later.'],
	link: ['An, #displacement', 'Save An, establish a stack frame in An, then adjust SP.'],
	unlk: ['An', 'Release a stack frame and restore its saved address register.'],
	trap: ['#vector', 'Invoke a software trap; the simulator provides teaching console services through TRAP #15.'],
	nop: ['', 'Do nothing.'],
	illegal: ['', 'Execute the illegal-instruction trap opcode.'],
	bkpt: ['#number', 'Software breakpoint numbered 0–7. Requires MC68010 or later.'],
	dbra: ['Dn, target', 'Decrement the low word of Dn; branch unless it becomes 0xFFFF. Flags are unchanged.'],
}
const PREDICATES = ['always', 'never', 'unsigned higher (C = 0 and Z = 0)', 'unsigned lower or same (C = 1 or Z = 1)',
	'carry clear (C = 0)', 'carry set (C = 1)', 'not equal (Z = 0)', 'equal (Z = 1)', 'overflow clear (V = 0)',
	'overflow set (V = 1)', 'plus (N = 0)', 'minus (N = 1)', 'signed greater or equal (N = V)',
	'signed less (N ≠ V)', 'signed greater (Z = 0 and N = V)', 'signed less or equal (Z = 1 or N ≠ V)']
const conditional: InstructionTable = Object.fromEntries(CONDITIONS.flatMap((cc, index) => [
	[`b${cc}`, ['target', `Branch when ${PREDICATES[index]}.`]],
	[`db${cc}`, ['Dn, target', `If the condition (${PREDICATES[index]}) is false, decrement the low word of Dn and branch unless it becomes 0xFFFF. Flags are unchanged.`]],
	[`s${cc}`, ['destination', `Write 0xFF if the condition (${PREDICATES[index]}) is true, otherwise write 0. Flags are unchanged.`]],
]))

export function m68kInstructionHelp(mnemonic: string): InstructionHelp | null {
	const name = mnemonic.toLowerCase().replace(/\.[bwl]$/, '')
	const help = tableInstructionHelp(name, DOCS, REFERENCE) ?? tableInstructionHelp(name, conditional, REFERENCE)
	if (help) help.contents[0] = `**${mnemonic.toUpperCase()}**`
	return help
}
